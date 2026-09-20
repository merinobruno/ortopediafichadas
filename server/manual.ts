import { enqueueExceptionWork } from "./exception-work";
import { reportingDay } from "../shared/reporting";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { Store } from "./store";
import { civilDate } from "../shared/validation";
export function normalizedInstant(value: string) {
  const parsed = z.string().datetime({ offset: true }).parse(value);
  civilDate.parse(parsed.slice(0, 10));
  const ms = Date.parse(parsed);
  if (!Number.isFinite(ms)) throw new Error("Fecha y hora inválidas.");
  return new Date(ms).toISOString();
}
const manualSchema = z.object({
  employee_id: z.string().min(1),
  site_id: z.string().min(1),
  entry_at: z.string(),
  exit_at: z.string(),
  reason: z.string().trim().min(5),
});
export function recordManualVisit(
  s: Store,
  input: unknown,
  actor: string,
  now = new Date().toISOString(),
) {
  const p = manualSchema.parse(input);
  const entry = normalizedInstant(p.entry_at),
    exit = normalizedInstant(p.exit_at);
  if (!actor || entry >= exit || exit > normalizedInstant(now))
    throw new Error(
      "Confirmá una entrada anterior a la salida y una salida que no esté en el futuro.",
    );
  return s.tx(() => {
    const employee = s.one(
      "SELECT * FROM employees WHERE id=? AND active=1",
      p.employee_id,
    );
    const site = s.one(
      "SELECT * FROM sites WHERE id=? AND active=1",
      p.site_id,
    );
    if (
      !employee ||
      !site ||
      !JSON.parse(employee.site_ids).includes(p.site_id)
    )
      throw new Error(
        "El empleado y la sede deben estar activos y autorizados.",
      );
    const existing = s.all(
      "SELECT * FROM visits WHERE employee_id=? ORDER BY entry_at",
      p.employee_id,
    );
    const start = Date.parse(entry),
      end = Date.parse(exit);
    for (const v of existing) {
      const vStart = Date.parse(v.entry_at);
      let vEnd = Infinity;
      if (v.exit_at && ["complete", "corrected"].includes(v.status))
        vEnd = Date.parse(v.exit_at);
      else if (v.status === "exit_unknown") {
        const next = existing.find(
          (other) => Date.parse(other.entry_at) > vStart,
        );
        if (next) vEnd = Date.parse(next.entry_at);
      }
      if (start < vEnd && end > vStart)
        throw new Error(
          "El horario se superpone con una visita existente o con un intervalo sin cierre confirmado.",
        );
    }
    const id = randomUUID();
    s.db
      .prepare("INSERT INTO visits VALUES(?,?,?,?,?,'corrected','manual_hr')")
      .run(id, p.employee_id, p.site_id, entry, exit);
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        id,
        actor,
        p.reason,
        "null",
        JSON.stringify(s.one("SELECT * FROM visits WHERE id=?", id)),
        new Date().toISOString(),
      );
    enqueueExceptionWork(
      s,
      p.employee_id,
      reportingDay(entry),
      reportingDay(entry),
    );
    return id;
  });
}
export function correctUnknownBreak(
  s: Store,
  id: string,
  time: string,
  reason: string,
  actor: string,
  now = new Date().toISOString(),
) {
  const end = normalizedInstant(time);
  if (!actor || typeof reason !== "string" || reason.trim().length < 5)
    throw new Error("Ingresá un motivo de al menos 5 caracteres.");
  return s.tx(() => {
    const before = s.one(
      "SELECT * FROM breaks WHERE id=? AND status='end_unknown' AND ended_at IS NULL",
      id,
    );
    if (!before)
      throw new Error("La pausa no tiene un fin desconocido pendiente.");
    const visit = s.one("SELECT * FROM visits WHERE id=?", before.visit_id);
    const next = s.one(
      "SELECT entry_at FROM visits WHERE employee_id=? AND entry_at>? ORDER BY entry_at LIMIT 1",
      visit.employee_id,
      visit.entry_at,
    );
    const bounds = [visit.exit_at, next?.entry_at]
      .filter(Boolean)
      .map(Date.parse);
    if (!bounds.length)
      throw new Error(
        "Confirmá primero la salida de la visita para limitar el fin de la pausa.",
      );
    if (
      Date.parse(end) <= Date.parse(before.started_at) ||
      Date.parse(end) > Math.min(...bounds) ||
      end > normalizedInstant(now)
    )
      throw new Error(
        "El fin debe ser posterior al inicio de la pausa, dentro de la visita y fuera del futuro.",
      );
    if (
      s
        .all("SELECT * FROM breaks WHERE visit_id=? AND id<>?", visit.id, id)
        .some(
          (b) =>
            Date.parse(before.started_at) <
              (b.ended_at ? Date.parse(b.ended_at) : Infinity) &&
            Date.parse(end) > Date.parse(b.started_at),
        )
    )
      throw new Error("El horario se superpone con otra pausa.");
    s.db
      .prepare("UPDATE breaks SET ended_at=?,status='corrected' WHERE id=?")
      .run(end, id);
    s.db.prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)").run(
      randomUUID(),
      id,
      actor,
      reason.trim(),
      JSON.stringify(before),
      JSON.stringify({
        ...s.one("SELECT * FROM breaks WHERE id=?", id),
        employee_id: visit.employee_id,
      }),
      new Date().toISOString(),
    );
    return { ok: true };
  });
}
export function manualRoutes(app: Express, s: Store) {
  app.post("/api/attendance/manual", (req, res) =>
    res.json({ id: recordManualVisit(s, req.body, res.locals.actor) }),
  );
  app.post("/api/hr/break/:id/correct", (req, res) => {
    const p = z
      .object({ time: z.string(), reason: z.string().min(5) })
      .parse(req.body);
    res.json(
      correctUnknownBreak(
        s,
        String(req.params.id),
        p.time,
        p.reason,
        res.locals.actor,
      ),
    );
  });
}
