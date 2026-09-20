import { catalogActive } from "./catalogs";
import { enqueueExceptionWork } from "./exception-work";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { Store } from "./store";
import { scopedEmployees } from "./auth";
import { reportingDay } from "../shared/reporting";
import { civilDate as validDay } from "../shared/validation";
const DAY = 86400000;
const schema = z.object({
  employee_id: z.string().min(1),
  date_from: validDay,
  date_to: validDay,
  anchor: validDay,
  cycle: z.union([z.literal(7), z.literal(14)]),
  slots: z.array(z.string().nullable()),
  reason: z.string().trim().min(5),
});
function audit(
  s: Store,
  id: string,
  actor: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  s.db
    .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
    .run(
      randomUUID(),
      id,
      actor,
      reason,
      JSON.stringify(before),
      JSON.stringify(after),
      new Date().toISOString(),
    );
}
export function createSchedule(s: Store, input: unknown, actor: string) {
  const p = schema.parse(input);
  if (p.date_to < p.date_from || p.slots.length !== p.cycle)
    throw new Error("Revisá el rango de fechas y los días del ciclo.");
  return s.tx(() => {
    if (
      !s.one("SELECT id FROM employees WHERE id=? AND active=1", p.employee_id)
    )
      throw new Error("Elegí un empleado activo.");
    if (
      s.one(
        "SELECT id FROM schedules WHERE employee_id=? AND status='active' AND date_from<=? AND date_to>=?",
        p.employee_id,
        p.date_to,
        p.date_from,
      )
    )
      throw new Error(
        "La vigencia se superpone con una planificación existente. Finalizá primero su vigencia.",
      );
    const slots = p.slots.map((id) => {
      if (id === null) return null;
      const shift = s.one("SELECT * FROM shifts WHERE id=?", id);
      if (!shift || !catalogActive(s, "shift", id))
        throw new Error("Elegí un turno activo.");
      return {
        id: shift.id,
        name: shift.name,
        start: shift.start,
        end: shift.end,
        tolerance: shift.tolerance,
      };
    });
    const id = randomUUID();
    s.db
      .prepare("INSERT INTO schedules VALUES(?,?,?,?,?,?,?,'active')")
      .run(
        id,
        p.employee_id,
        p.date_from,
        p.date_to,
        p.anchor,
        p.cycle,
        JSON.stringify(slots),
      );
    audit(s, id, actor, p.reason, null, { ...p, id, slots });
    enqueueExceptionWork(s, p.employee_id, p.date_from, p.date_to);
    return id;
  });
}
export function cancelSchedule(
  s: Store,
  id: string,
  reason: string,
  actor: string,
  today = reportingDay(new Date().toISOString()),
) {
  if (reason.trim().length < 5)
    throw new Error("Ingresá un motivo de al menos 5 caracteres.");
  s.tx(() => {
    const before = s.one(
      "SELECT * FROM schedules WHERE id=? AND status='active'",
      id,
    );
    if (!before || before.date_to < today)
      throw new Error("Esta planificación ya finalizó.");
    if (before.date_from >= today)
      s.db
        .prepare("UPDATE schedules SET status='cancelled' WHERE id=?")
        .run(id);
    else {
      s.db
        .prepare("UPDATE schedules SET date_to=? WHERE id=?")
        .run(
          new Date(Date.parse(today + "T00:00:00Z") - DAY)
            .toISOString()
            .slice(0, 10),
          id,
        );
    }
    enqueueExceptionWork(s, before.employee_id, today, before.date_to, today);
    audit(
      s,
      id,
      actor,
      reason,
      before,
      s.one("SELECT * FROM schedules WHERE id=?", id),
    );
  });
}
export function migrateLegacySchedules(
  s: Store,
  today = reportingDay(new Date().toISOString()),
) {
  if (s.one("SELECT name FROM migrations WHERE name='effective_schedules_v1'"))
    return;
  s.tx(() => {
    for (const a of s.all(
      "SELECT a.* FROM shift_assignments a JOIN employees e ON e.id=a.employee_id WHERE e.active=1",
    )) {
      const shift = s.one("SELECT * FROM shifts WHERE id=?", a.shift_id);
      if (!shift) continue;
      const id = randomUUID();
      const snapshot = {
        id: shift.id,
        name: shift.name,
        start: shift.start,
        end: shift.end,
        tolerance: shift.tolerance,
      };
      s.db
        .prepare("INSERT INTO schedules VALUES(?,?,?,?,?,7,?,'draft')")
        .run(
          id,
          a.employee_id,
          today,
          today,
          today,
          JSON.stringify([snapshot, null, null, null, null, null, null]),
        );
      audit(
        s,
        id,
        "migration",
        "Legacy reference draft; requires explicit effective dates and cycle",
        null,
        { employee_id: a.employee_id, status: "draft", shift: snapshot },
      );
    }
    s.db
      .prepare("INSERT INTO migrations VALUES(?,?)")
      .run("effective_schedules_v1", new Date().toISOString());
  });
}
export function calendar(
  s: Store,
  employees: string[],
  from: string,
  to: string,
  now = new Date().toISOString(),
) {
  validDay.parse(from);
  validDay.parse(to);
  const count = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  if (count < 1 || count > 93 || employees.length > 500)
    throw new Error("Elegí un período de hasta 93 días y hasta 500 empleados.");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("Fecha actual inválida.");
  const rows: any[] = [];
  const plans = s.all(
    "SELECT * FROM schedules WHERE status='active' AND date_from<=? AND date_to>=?",
    to,
    from,
  );
  const holidays = s.all(
    "SELECT * FROM holidays WHERE day BETWEEN ? AND ?",
    from,
    to,
  );
  const leaves = s.all(
    "SELECT * FROM leaves WHERE status='approved' AND date_from<=? AND date_to>=?",
    to,
    from,
  );
  const visits = s.all(
    "SELECT * FROM visits WHERE entry_at>=? AND entry_at<? ORDER BY entry_at",
    from + "T03:00:00.000Z",
    new Date(Date.parse(to + "T03:00:00Z") + DAY).toISOString(),
  );
  for (const employee_id of employees)
    for (let i = 0; i < count; i++) {
      const day = new Date(Date.parse(from + "T00:00:00Z") + i * DAY)
        .toISOString()
        .slice(0, 10);
      const plan = plans.find(
        (p) =>
          p.employee_id === employee_id &&
          p.date_from <= day &&
          p.date_to >= day,
      );
      const first = visits.find(
        (v) =>
          v.employee_id === employee_id &&
          reportingDay(v.entry_at) === day &&
          Date.parse(v.entry_at) <= nowMs,
      );
      const base: any = {
        employee_id,
        day,
        status: "unscheduled",
        start: null,
        end: null,
        first_entry: first?.entry_at || null,
        shift_name: null,
      };
      const override = s.one(
        "SELECT * FROM planning_overrides WHERE employee_id=? AND day=?",
        employee_id,
        day,
      );
      const snapshot = override ? JSON.parse(override.snapshot_json) : null;
      base.override_revision = override?.revision || 0;
      base.expectation_origin =
        override && override.mode !== "inherit"
          ? "override"
          : plan
            ? "rotation"
            : "none";
      base.planned_site =
        override?.mode === "shift" ? snapshot?.site || null : null;
      if (override?.mode === "rest") {
        rows.push({ ...base, status: "rest" });
        continue;
      }
      let slot: any = null;
      if (override?.mode === "shift") slot = snapshot.shift;
      else if (plan) {
        const offset = Math.round(
          (Date.parse(day) - Date.parse(plan.anchor)) / DAY,
        );
        slot = JSON.parse(plan.slots_json)[
          ((offset % plan.cycle) + plan.cycle) % plan.cycle
        ];
      } else {
        rows.push(base);
        continue;
      }
      if (!slot) {
        rows.push({ ...base, status: "rest" });
        continue;
      }
      Object.assign(base, {
        start: slot.start,
        end: slot.end,
        shift_name: slot.name,
        tolerance: slot.tolerance,
        schedule_id: base.expectation_origin === "rotation" ? plan.id : null,
      });
      const holiday = holidays.find(
        (h) => h.day === day && catalogActive(s, "holiday", h.day),
      );
      const leave = leaves.find(
        (l) =>
          l.employee_id === employee_id &&
          l.date_from <= day &&
          l.date_to >= day,
      );
      if (holiday) {
        rows.push({ ...base, status: "holiday", note: holiday.name });
        continue;
      }
      if (leave) {
        rows.push({ ...base, status: "leave", note: leave.type });
        continue;
      }
      const start = Date.parse(day + "T" + slot.start + ":00-03:00");
      const end = Date.parse(day + "T" + slot.end + ":00-03:00");
      if (day > reportingDay(now)) {
        rows.push({ ...base, status: "upcoming" });
        continue;
      }
      if (end <= start) {
        rows.push({
          ...base,
          status: "review_required",
          note: "Turno nocturno: revisar manualmente la jornada",
        });
        continue;
      }
      if (first) {
        rows.push({
          ...base,
          first_entry: first.entry_at,
          status:
            Date.parse(first.entry_at) <= start + slot.tolerance * 60000
              ? "on_time"
              : "late",
        });
        continue;
      }
      rows.push({
        ...base,
        status:
          nowMs < start ? "upcoming" : nowMs <= end ? "awaiting" : "absent",
      });
    }
  return rows;
}
export function scheduleRoutes(app: Express, s: Store) {
  app.get("/api/schedules", (req, res) => {
    const allowed = scopedEmployees(s, res.locals.user);
    res.json(
      s
        .all("SELECT * FROM schedules ORDER BY date_from DESC")
        .filter((p) => allowed.includes(p.employee_id))
        .map((p) => ({
          ...p,
          slots: JSON.parse(p.slots_json),
          slots_json: undefined,
        })),
    );
  });
  app.post("/api/schedules", (req, res) =>
    res.json({ id: createSchedule(s, req.body, res.locals.actor) }),
  );
  app.post("/api/schedules/:id/cancel", (req, res) => {
    const p = z.object({ reason: z.string().min(5) }).parse(req.body);
    cancelSchedule(s, String(req.params.id), p.reason, res.locals.actor);
    res.json({ ok: true });
  });
  app.get("/api/calendar", (req, res) => {
    const p = z
      .object({ from: validDay, to: validDay, employee: z.string().optional() })
      .parse(req.query);
    const allowed = scopedEmployees(s, res.locals.user);
    if (p.employee && !allowed.includes(p.employee)) {
      res.status(403).json({ error: "No tenés permiso para este empleado." });
      return;
    }
    res.json(calendar(s, p.employee ? [p.employee] : allowed, p.from, p.to));
  });
}
