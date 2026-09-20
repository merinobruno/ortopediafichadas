import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Express } from "express";
import { Store } from "./store";
import { civilDate } from "../shared/validation";
import { scopedEmployees } from "./auth";
import { calendar } from "./schedules";
import { catalogActive, listCatalog } from "./catalogs";
import { enqueueExceptionWork } from "./exception-work";
const DAY = 86400000;
const monday = civilDate.refine(
  (d) => new Date(d + "T00:00:00Z").getUTCDay() === 1,
  "Elegí el lunes de la semana.",
);
const plus = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const change = z
  .object({
    employee_id: z.string().min(1),
    day: civilDate,
    expected_revision: z.number().int().min(0),
    mode: z.enum(["inherit", "rest", "shift"]),
    shift_id: z.string().nullable().optional(),
    site_id: z.string().nullable().optional(),
  })
  .strict();
const batch = z
  .object({
    week: monday,
    reason: z.string().trim().min(5).max(1000),
    changes: z.array(change).min(1).max(350),
  })
  .strict();
class PlanningError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function saveWeek(s: Store, raw: unknown, user: any, actor: string) {
  if (!["admin", "hr"].includes(user.role))
    throw new PlanningError(
      "No tenés permiso para modificar la planificación.",
      403,
    );
  const p = batch.parse(raw);
  return s.tx(() => {
    const allowed = new Set(scopedEmployees(s, user)),
      seen = new Set<string>(),
      employees = new Set<string>();
    const prepared = p.changes.map((c) => {
      if (c.day < p.week || c.day > plus(p.week, 6))
        throw new PlanningError("Una fecha está fuera de la semana.");
      const key = c.employee_id + ":" + c.day;
      if (seen.has(key))
        throw new PlanningError("Una celda aparece más de una vez.");
      seen.add(key);
      employees.add(c.employee_id);
      if (!allowed.has(c.employee_id))
        throw new PlanningError("No tenés permiso para esta persona.", 403);
      const employee = s.one(
        "SELECT * FROM employees WHERE id=? AND active=1",
        c.employee_id,
      );
      if (!employee) throw new PlanningError("Elegí empleados activos.");
      const before = s.one(
        "SELECT * FROM planning_overrides WHERE employee_id=? AND day=?",
        c.employee_id,
        c.day,
      );
      if ((before?.revision || 0) !== c.expected_revision)
        throw new PlanningError(
          "La semana cambió. Conservamos tus cambios pendientes; descartalos y recargá para revisar la versión actual.",
          409,
        );
      let snapshot: any = null;
      if (c.mode === "shift") {
        const shift = s.one(
          "SELECT * FROM shifts WHERE id=?",
          c.shift_id || "",
        );
        if (!shift || !catalogActive(s, "shift", shift.id))
          throw new PlanningError("Elegí un turno activo.");
        let site = null;
        if (c.site_id) {
          const current = s.one(
            "SELECT id,name FROM sites WHERE id=? AND active=1",
            c.site_id,
          );
          if (!current || !JSON.parse(employee.site_ids).includes(c.site_id))
            throw new PlanningError(
              "La sede planificada debe estar activa y autorizada para esa persona.",
            );
          site = current;
        }
        snapshot = {
          shift: {
            id: shift.id,
            name: shift.name,
            start: shift.start,
            end: shift.end,
            tolerance: shift.tolerance,
          },
          site,
        };
      } else if (c.shift_id || c.site_id)
        throw new PlanningError("Descanso y heredar no admiten turno ni sede.");
      return { c, before, snapshot };
    });
    if (employees.size > 50)
      throw new PlanningError("Guardá hasta 50 empleados por vez.");
    const stamp = new Date().toISOString();
    for (const { c, before, snapshot } of prepared) {
      const revision = c.expected_revision + 1,
        json = JSON.stringify(snapshot);
      s.db
        .prepare(
          "INSERT INTO planning_overrides VALUES(?,?,?,?,?) ON CONFLICT(employee_id,day) DO UPDATE SET revision=excluded.revision,mode=excluded.mode,snapshot_json=excluded.snapshot_json",
        )
        .run(c.employee_id, c.day, revision, c.mode, json);
      s.db
        .prepare("INSERT INTO planning_revisions VALUES(?,?,?,?,?,?,?,?)")
        .run(
          c.employee_id,
          c.day,
          revision,
          c.mode,
          json,
          actor,
          p.reason,
          stamp,
        );
      s.db
        .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          c.employee_id + ":" + c.day,
          actor,
          p.reason,
          JSON.stringify(before || null),
          JSON.stringify({
            employee_id: c.employee_id,
            day: c.day,
            revision,
            mode: c.mode,
            snapshot,
          }),
          stamp,
        );
      enqueueExceptionWork(s, c.employee_id, c.day, c.day);
    }
    return { changed: prepared.length };
  });
}
const query = z
  .object({
    week: monday,
    employee: z.string().min(1).optional(),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export function planningWeek(s: Store, raw: unknown, user: any) {
  const p = query.parse(raw),
    allowed = new Set(scopedEmployees(s, user));
  if (p.employee && !allowed.has(p.employee))
    throw new PlanningError("No tenés permiso para esta persona.", 403);
  const filtered = s
    .all("SELECT id,name,active,site_ids FROM employees ORDER BY name,id")
    .filter((e) => allowed.has(e.id) && (!p.employee || e.id === p.employee));
  const people = filtered.slice(p.offset, p.offset + p.limit);
  const days = Array.from({ length: 7 }, (_, i) => plus(p.week, i)),
    expectations = calendar(
      s,
      people.map((e) => e.id),
      p.week,
      days[6],
    );
  return {
    week: p.week,
    days,
    total: filtered.length,
    offset: p.offset,
    limit: p.limit,
    rows: people.map((e) => ({
      ...e,
      site_ids: JSON.parse(e.site_ids),
      cells: days.map((day) => {
        const override = s.one(
          "SELECT * FROM planning_overrides WHERE employee_id=? AND day=?",
          e.id,
          day,
        );
        return {
          day,
          mode: override?.mode || "inherit",
          override_revision: override?.revision || 0,
          snapshot: override ? JSON.parse(override.snapshot_json) : null,
          effective: expectations.find(
            (r) => r.employee_id === e.id && r.day === day,
          ),
        };
      }),
    })),
    shifts: listCatalog(s, "shift").filter((r) => !r.archived),
    sites: s
      .all("SELECT id,name FROM sites WHERE active=1")
      .filter((site) =>
        people.some((e) => JSON.parse(e.site_ids).includes(site.id)),
      ),
  };
}
export function planningRoutes(app: Express, s: Store) {
  app.get("/api/planning/week", (req, res) =>
    res.json(planningWeek(s, req.query, res.locals.user)),
  );
  app.post("/api/planning/week", (req, res) =>
    res.json(saveWeek(s, req.body, res.locals.user, res.locals.actor)),
  );
  app.get("/api/planning/history", (req, res) => {
    const p = z
      .object({
        employee: z.string().min(1),
        day: civilDate,
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict()
      .parse(req.query);
    if (!scopedEmployees(s, res.locals.user).includes(p.employee)) {
      res.status(403).json({ error: "No tenés permiso para esta persona." });
      return;
    }
    const rows = s.all(
      "SELECT * FROM planning_revisions WHERE employee_id=? AND day=? ORDER BY revision DESC LIMIT ? OFFSET ?",
      p.employee,
      p.day,
      p.limit,
      p.offset,
    );
    res.json({
      total: s.one(
        "SELECT COUNT(*) n FROM planning_revisions WHERE employee_id=? AND day=?",
        p.employee,
        p.day,
      ).n,
      rows: rows.map((r) => ({
        ...r,
        snapshot: JSON.parse(r.snapshot_json),
        snapshot_json: undefined,
      })),
    });
  });
}
