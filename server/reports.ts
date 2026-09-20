import { renderReportFile } from "./report-export";
import type { Express } from "express";
import { z } from "zod";
import { Store } from "./store";
import { scopedEmployees } from "./auth";
import { civilDate } from "../shared/validation";
import {
  filterVisits,
  reportingDay,
  summarizeVisits,
  workedHours,
} from "../shared/reporting";
const optional = (type: z.ZodTypeAny) =>
  z.union([z.literal(""), type]).optional();
export const reportFilters = z
  .object({
    from: optional(civilDate),
    to: optional(civilDate),
    employee: optional(z.string().max(100)),
    site: optional(z.string().max(100)),
    status: optional(z.enum(["open", "complete", "corrected", "exit_unknown"])),
    search: optional(z.string().max(100)),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      p.from &&
      p.to &&
      (p.from > p.to ||
        (Date.parse(p.to) - Date.parse(p.from)) / 86400000 > 365)
    )
      ctx.addIssue({
        code: "custom",
        message: "Elegí un rango válido de hasta 366 días.",
      });
  });
export function selectReport(s: Store, user: any, query: unknown) {
  const filters = reportFilters.parse(query) as Record<string, string>;
  const allowed = new Set(scopedEmployees(s, user));
  if (filters.employee && !allowed.has(filters.employee))
    throw Object.assign(new Error("No tenés permiso para este empleado."), {
      status: 403,
    });
  if (filters.site && !s.one("SELECT id FROM sites WHERE id=?", filters.site))
    throw new Error("Sede inexistente.");
  const scoped = s
    .all(
      "SELECT v.*,e.name AS employee_name,st.name AS site_name FROM visits v JOIN employees e ON e.id=v.employee_id JOIN sites st ON st.id=v.site_id ORDER BY v.entry_at DESC",
    )
    .filter((v) => allowed.has(v.employee_id));
  const names = new Map(scoped.map((v) => [v.employee_id, v.employee_name]));
  const visits = filterVisits(scoped, filters, (id) => names.get(id) || "");
  const ids = new Set(visits.map((v) => v.id));
  const breaks = s
    .all("SELECT * FROM breaks")
    .filter((b) => ids.has(b.visit_id));
  const approvedOvertimeMinutes = s
    .all("SELECT visit_id,minutes FROM overtime WHERE status='approved'")
    .filter((o) => ids.has(o.visit_id))
    .reduce((total, o) => total + o.minutes, 0);
  return assembleReport(filters, visits, breaks, approvedOvertimeMinutes);
}
function assembleReport(
  filters: Record<string, string>,
  visits: any[],
  breaks: any[],
  approvedOvertimeMinutes: number,
) {
  const names = new Map(
    visits.map((v: any) => [v.employee_id, v.employee_name]),
  );
  const summary = summarizeVisits(visits, breaks);
  return {
    filters,
    ...summary,
    byEmployee: summary.byEmployee.map((g) => ({
      ...g,
      name: names.get(g.id),
    })),
    bySite: summary.bySite.map((g) => ({
      ...g,
      name: visits.find((v) => v.site_id === g.id)?.site_name,
    })),
    approvedOvertimeMinutes,
    details: visits.map((v) => ({
      ...v,
      netHours: ["complete", "corrected"].includes(v.status)
        ? workedHours(v, breaks)
        : null,
    })),
    attribution: "entry_date_America/Argentina/Buenos_Aires",
  };
}
export function selectExportReport(
  s: Store,
  user: any,
  query: unknown,
  format: "xlsx" | "pdf",
) {
  const filters = reportFilters.parse(query) as Record<string, string>;
  if (!filters.from || !filters.to)
    throw new Error("Seleccioná un período con ambas fechas para exportar.");
  s.db.function("reporting_day", { deterministic: true }, (value) =>
    reportingDay(String(value)),
  );
  return s.tx(() => {
    const allowed = new Set(scopedEmployees(s, user));
    if (filters.employee && !allowed.has(filters.employee))
      throw Object.assign(new Error("No tenés permiso para este empleado."), {
        status: 403,
      });
    if (filters.site && !s.one("SELECT id FROM sites WHERE id=?", filters.site))
      throw new Error("Sede inexistente.");
    const selected = s
      .all("SELECT id,name FROM employees ORDER BY id")
      .filter(
        (e) =>
          allowed.has(e.id) &&
          (!filters.employee || e.id === filters.employee) &&
          (!filters.search ||
            e.name.toLowerCase().includes(filters.search.toLowerCase())),
      );
    const cap = format === "xlsx" ? 10000 : 2000;
    // Coarse UTC bounds retain historical IANA offsets; the shared civil-day predicate is authoritative before LIMIT.
    const since = new Date(
      Date.parse(filters.from + "T00:00:00Z") - 86400000,
    ).toISOString();
    const until = new Date(
      Date.parse(filters.to + "T00:00:00Z") + 2 * 86400000,
    ).toISOString();
    const visits = s.all(
      "SELECT v.*,e.name employee_name,st.name site_name FROM visits v JOIN employees e ON e.id=v.employee_id JOIN sites st ON st.id=v.site_id WHERE v.employee_id IN (SELECT value FROM json_each(?)) AND julianday(v.entry_at)>=julianday(?) AND julianday(v.entry_at)<julianday(?) AND reporting_day(v.entry_at)>=? AND reporting_day(v.entry_at)<=? AND (?='' OR v.site_id=?) AND (?='' OR v.status=?) ORDER BY v.entry_at DESC LIMIT ?",
      JSON.stringify(selected.map((e) => e.id)),
      since,
      until,
      filters.from,
      filters.to,
      filters.site || "",
      filters.site || "",
      filters.status || "",
      filters.status || "",
      cap + 1,
    );
    if (visits.length > cap)
      throw Object.assign(
        new Error(
          `El reporte supera ${cap} visitas. Reducí el período o los filtros; no se truncaron resultados.`,
        ),
        { status: 413 },
      );
    const ids = JSON.stringify(visits.map((v) => v.id));
    const breaks = s.all(
      "SELECT * FROM breaks WHERE visit_id IN (SELECT value FROM json_each(?))",
      ids,
    );
    const minutes = s.one(
      "SELECT COALESCE(SUM(minutes),0) n FROM overtime WHERE status='approved' AND visit_id IN (SELECT value FROM json_each(?))",
      ids,
    ).n;
    return {
      ...assembleReport(filters, visits, breaks, minutes),
      asOf: new Date().toISOString(),
      filterLabels: {
        employee: filters.employee
          ? selected.find((e) => e.id === filters.employee)?.name ||
            filters.employee
          : "Todos los empleados",
        site: filters.site
          ? s.one("SELECT name FROM sites WHERE id=?", filters.site).name
          : "Todas las sedes",
      },
    };
  });
}

function csv(rows: unknown[][]) {
  const escape = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[\s]*[=+@-]/, "'")
      .replaceAll('"', '""') +
    '"';
  return "\uFEFF" + rows.map((r) => r.map(escape).join(";")).join("\r\n");
}
export function reportRoutes(app: Express, s: Store) {
  const handle =
    (kind: "json" | "summary" | "details") =>
    (req: any, res: any, next: any) => {
      try {
        const r = selectReport(s, res.locals.user, req.query);
        if (kind === "json") {
          res.json(r);
          return;
        }
        res.type("text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="carahue-${kind}.csv"`,
        );
        if (kind === "details") {
          res.send(
            csv([
              [
                "Empleado",
                "Sede",
                "Entrada UTC",
                "Salida UTC",
                "Estado",
                "Horas netas conocidas",
                "Origen",
              ],
              ...r.details.map((v) => [
                v.employee_name,
                v.site_name,
                v.entry_at,
                v.exit_at,
                v.status,
                v.netHours?.toFixed(2) ?? "",
                v.source,
              ]),
            ]),
          );
        } else {
          const metrics = (m: any) => [
            m.visits,
            m.entryDays,
            m.measurableVisits,
            m.netHours.toFixed(2),
            m.openVisits,
            m.unknownExits,
            m.unknownPauses,
          ];
          res.send(
            csv([
              [
                "Grupo",
                "Nombre",
                "Visitas",
                "Días de entrada BA",
                "Visitas medibles",
                "Horas netas conocidas",
                "Visitas abiertas",
                "Salidas desconocidas",
                "Visitas cerradas con pausa sin fin",
              ],
              ["Total", "Organización filtrada", ...metrics(r.overall)],
              ...r.byEmployee.map((g) => ["Empleado", g.name, ...metrics(g)]),
              ...r.bySite.map((g) => ["Sede", g.name, ...metrics(g)]),
              [],
              [
                "Minutos extra aprobados (separados)",
                r.approvedOvertimeMinutes,
              ],
              [
                "Atribución",
                "Fecha de entrada Buenos Aires; sin división por jornada ni liquidación",
              ],
            ]),
          );
        }
      } catch (e) {
        if ((e as any).status === 403)
          res.status(403).json({ error: (e as Error).message });
        else next(e);
      }
    };
  for (const format of ["xlsx", "pdf"] as const)
    app.get("/api/reports/summary." + format, async (req, res, next) => {
      const abort = new AbortController();
      const disconnect = () => {
        if (!res.writableEnded) abort.abort();
      };
      res.on("close", disconnect);
      try {
        const snapshot = selectExportReport(
          s,
          res.locals.user,
          req.query,
          format,
        );
        const bytes = await renderReportFile(
          snapshot,
          format,
          res.locals.user.id,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader(
          "Content-Type",
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="carahue-reporte-${snapshot.filters.from}-${snapshot.filters.to}.${format}"`,
        );
        res.send(bytes);
      } catch (error) {
        if (!abort.signal.aborted) next(error);
      } finally {
        res.off("close", disconnect);
      }
    });
  app.get("/api/reports/summary", handle("json"));
  app.get("/api/reports/summary.csv", handle("summary"));
  app.get("/api/export", handle("details"));
}
