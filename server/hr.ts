import {
  createCatalog,
  listCatalog,
  setEmployeeAssociation,
  catalogActive,
} from "./catalogs";
import { enqueueExceptionWork } from "./exception-work";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
import type { Express } from "express";
import { z } from "zod";
export function recordBreak(
  s: Store,
  employee: string,
  action: string,
  time = new Date().toISOString(),
  now = Date.now(),
) {
  return s.tx(() => {
    const t = new Date(time).toISOString();
    if (Date.parse(t) > now)
      throw new Error("La pausa no puede tener un horario futuro.");
    const visit = s.one(
      "SELECT * FROM visits WHERE employee_id=? AND status='open'",
      employee,
    );
    if (!visit)
      throw new Error("Necesitás una visita abierta para registrar una pausa.");
    if (Date.parse(t) < Date.parse(visit.entry_at))
      throw new Error("La pausa debe ser posterior a la entrada.");
    const open = s.one(
      "SELECT * FROM breaks WHERE visit_id=? AND status='open'",
      visit.id,
    );
    const latest = s.one(
      "SELECT MAX(ended_at) time FROM breaks WHERE visit_id=?",
      visit.id,
    );
    if (latest?.time && Date.parse(t) < Date.parse(latest.time))
      throw new Error("El horario es anterior a una pausa confirmada.");
    let breakId = open?.id;
    if (action === "start") {
      if (
        s.one(
          "SELECT id FROM breaks WHERE visit_id=? AND status='end_unknown'",
          visit.id,
        )
      )
        throw new Error("RRHH debe confirmar el fin de la pausa anterior.");
      breakId = randomUUID();
      if (open) throw new Error("Ya hay una pausa abierta.");
      s.db
        .prepare("INSERT INTO breaks VALUES(?,?,?,NULL,'open')")
        .run(breakId, visit.id, t);
    } else if (action === "end") {
      if (!open) throw new Error("No hay una pausa abierta.");
      if (t <= open.started_at)
        throw new Error("El fin debe ser posterior al inicio de la pausa.");
      s.db
        .prepare("UPDATE breaks SET ended_at=?,status='complete' WHERE id=?")
        .run(t, open.id);
    } else throw new Error("Acción de pausa inválida.");
    return { ok: true, break_id: breakId };
  });
}
export function assignShift(s: Store, employee: string, shift: string) {
  if (
    !s.one("SELECT id FROM employees WHERE id=?", employee) ||
    !s.one("SELECT id FROM shifts WHERE id=?", shift) ||
    !catalogActive(s, "shift", shift)
  )
    throw new Error("Empleado o turno no encontrado.");
  s.db
    .prepare(
      "INSERT INTO shift_assignments VALUES(?,?) ON CONFLICT(employee_id) DO UPDATE SET shift_id=excluded.shift_id",
    )
    .run(employee, shift);
}
export function requestOvertime(
  s: Store,
  visit: string,
  minutes: number,
  reason: string,
) {
  const v = s.one("SELECT * FROM visits WHERE id=?", visit);
  if (!v?.exit_at || !["complete", "corrected"].includes(v.status))
    throw new Error("Las horas extra requieren una visita completa.");
  if (
    !Number.isInteger(minutes) ||
    minutes <= 0 ||
    minutes >
      Math.floor((Date.parse(v.exit_at) - Date.parse(v.entry_at)) / 60000) ||
    reason.trim().length < 5
  )
    throw new Error(
      "Ingresá minutos válidos y un motivo de al menos 5 caracteres.",
    );
  const id = randomUUID();
  s.db
    .prepare("INSERT INTO overtime VALUES(?,?,?,?,'pending')")
    .run(id, visit, minutes, reason.trim());
  return id;
}
export function decideOvertime(
  s: Store,
  id: string,
  status: string,
  actor: string,
) {
  s.tx(() => {
    const before = s.one(
      "SELECT * FROM overtime WHERE id=? AND status='pending'",
      id,
    );
    if (!before || !["approved", "rejected"].includes(status))
      throw new Error("Solicitud inexistente o ya resuelta.");
    s.db.prepare("UPDATE overtime SET status=? WHERE id=?").run(status, id);
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        id,
        actor,
        "Overtime review",
        JSON.stringify(before),
        JSON.stringify({ ...before, status }),
        new Date().toISOString(),
      );
  });
}
export function hrRoutes(app: Express, s: Store) {
  const audited = (
    actor: string,
    kind: string,
    payload: unknown,
    fn: () => unknown,
  ) =>
    s.tx(() => {
      const result = fn();
      s.db
        .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          kind,
          actor,
          kind,
          "null",
          JSON.stringify(payload),
          new Date().toISOString(),
        );
      return result;
    });
  app.get("/api/hr", (_req, res) =>
    res.json({
      breaks: s.all("SELECT * FROM breaks ORDER BY started_at DESC"),
      assignments: s.all("SELECT * FROM shift_assignments"),
      overtime: s.all("SELECT * FROM overtime"),
      holidays: listCatalog(s, "holiday"),
      taxonomy: ["sector", "tag", "category"].flatMap((k) =>
        listCatalog(s, k as any),
      ),
      employeeTags: s.all("SELECT * FROM employee_tags"),
    }),
  );
  app.post("/api/hr/break", (req, res) => {
    const p = z
      .object({ employee: z.string().min(1), action: z.enum(["start", "end"]) })
      .parse(req.body);
    res.json(
      audited(res.locals.actor, "Break record", p, () =>
        recordBreak(s, p.employee, p.action),
      ),
    );
  });
  app.post("/api/hr/assignment", (req, res) => {
    res.status(410).json({
      error:
        "Usá Calendario y rotaciones para asignar turnos con fechas de vigencia.",
    });
  });
  app.post("/api/hr/overtime", (req, res) => {
    const p = z
      .object({
        visit: z.string().min(1),
        minutes: z.coerce.number().int().positive(),
        reason: z.string().min(5),
      })
      .parse(req.body);
    res.json({
      id: audited(res.locals.actor, "Overtime request", p, () =>
        requestOvertime(s, p.visit, p.minutes, p.reason),
      ),
    });
  });
  app.post("/api/hr/overtime/:id", (req, res) => {
    decideOvertime(s, String(req.params.id), req.body.status, res.locals.actor);
    res.json({ ok: true });
  });
  app.post("/api/hr/holiday", (req, res) =>
    res.json(createCatalog(s, "holiday", req.body, res.locals.actor)),
  );
  app.post("/api/hr/taxonomy", (req, res) => {
    const p = z
      .object({ kind: z.enum(["sector", "tag", "category"]), name: z.string() })
      .strict()
      .parse(req.body);
    res.json(createCatalog(s, p.kind, { name: p.name }, res.locals.actor));
  });
  app.post("/api/hr/tag", (req, res) => {
    const p = z
      .object({
        employee: z.string(),
        tag: z.string(),
        reason: z.string().min(5).optional(),
      })
      .strict()
      .parse(req.body);
    setEmployeeAssociation(
      s,
      p.employee,
      p.tag,
      true,
      p.reason || "Employee association created",
      res.locals.actor,
    );
    res.json({ ok: true });
  });
}
