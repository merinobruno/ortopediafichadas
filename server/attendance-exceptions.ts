import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Express } from "express";
import { Store } from "./store";
import { calendar } from "./schedules";
import { enqueueExceptionWork, nextDay } from "./exception-work";
import { reportingDay } from "../shared/reporting";
import { scopedEmployees } from "./auth";
function audit(
  s: Store,
  id: string,
  actor: string,
  reason: string,
  before: unknown,
  after: unknown,
  now: string,
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
      now,
    );
}
export function configureRule(
  s: Store,
  type: string,
  input: unknown,
  actor: string,
  now = new Date().toISOString(),
) {
  z.enum(["late", "absent"]).parse(type);
  const p = z
    .object({
      enabled: z.boolean(),
      priority: z.enum(["low", "normal", "high"]),
    })
    .strict()
    .parse(input);
  const today = reportingDay(now);
  s.tx(() => {
    const before = s.one("SELECT * FROM exception_rules WHERE type=?", type);
    if (!!before.enabled === p.enabled && before.priority === p.priority)
      return;
    s.db
      .prepare("UPDATE exception_rules SET enabled=?,priority=? WHERE type=?")
      .run(p.enabled ? 1 : 0, p.priority, type);
    if (p.enabled && !before.enabled)
      s.db
        .prepare("INSERT INTO exception_periods VALUES(?,?,?,NULL,?,?)")
        .run(randomUUID(), type, today, today, now);
    if (!p.enabled && before.enabled)
      s.db
        .prepare(
          "UPDATE exception_periods SET end_day=? WHERE type=? AND end_day IS NULL",
        )
        .run(today, type);
    audit(s, type, actor, "Attendance exception rule updated", before, p, now);
    enqueueExceptionWork(s, null, today, today, today);
  });
}
export function acknowledgeException(
  s: Store,
  id: string,
  reason: string,
  actor: string,
  now = new Date().toISOString(),
) {
  reason = z.string().trim().min(5).max(1000).parse(reason);
  s.tx(() => {
    const before = s.one("SELECT * FROM attendance_exceptions WHERE id=?", id);
    if (!before) throw new Error("Excepción no encontrada.");
    if (before.ack_at) return;
    s.db
      .prepare(
        "UPDATE attendance_exceptions SET ack_actor=?,ack_at=?,ack_reason=? WHERE id=?",
      )
      .run(actor, now, reason, id);
    audit(
      s,
      id,
      actor,
      reason,
      before,
      { ...before, ack_actor: actor, ack_at: now, ack_reason: reason },
      now,
    );
  });
}
function evaluate(s: Store, employee: any, day: string, now: string) {
  const evidence = calendar(s, [employee.id], day, day, now)[0];
  if (!employee.active) evidence.status = "inactive";
  for (const rule of s.all("SELECT * FROM exception_rules")) {
    const old = s.one(
      "SELECT * FROM attendance_exceptions WHERE employee_id=? AND day=? AND type=?",
      employee.id,
      day,
      rule.type,
    );
    const active = evidence.status === rule.type;
    const period = s.one(
      "SELECT * FROM exception_periods WHERE type=? AND start_day<=? AND (end_day IS NULL OR end_day>=?) ORDER BY created_at DESC,rowid DESC LIMIT 1",
      rule.type,
      day,
      day,
    );
    if (!old) {
      if (!active || !period || (!rule.enabled && day === reportingDay(now)))
        continue;
      const id = randomUUID(),
        json = JSON.stringify(evidence);
      s.db
        .prepare(
          "INSERT INTO attendance_exceptions VALUES(?,?,?,?,?,?,?,?, 'active',?,?,?,NULL,NULL,NULL)",
        )
        .run(
          id,
          employee.id,
          day,
          rule.type,
          period.id,
          rule.priority,
          json,
          json,
          evidence.status,
          now,
          now,
        );
      audit(
        s,
        id,
        "exception-worker",
        "Attendance exception detected",
        null,
        {
          employee_id: employee.id,
          day,
          type: rule.type,
          condition: "active",
          evidence,
        },
        now,
      );
      continue;
    }
    const condition = active ? "active" : "resolved",
      json = JSON.stringify(evidence);
    s.db
      .prepare(
        "UPDATE attendance_exceptions SET current_evidence_json=?,condition=?,condition_reason=?,last_evaluated_at=? WHERE id=?",
      )
      .run(json, condition, evidence.status, now, old.id);
    if (old.condition !== condition || old.current_evidence_json !== json)
      audit(
        s,
        old.id,
        "exception-worker",
        "Attendance exception evidence changed",
        old,
        {
          ...old,
          condition,
          condition_reason: evidence.status,
          current_evidence_json: json,
        },
        now,
      );
  }
}
export function processExceptions(
  s: Store,
  now = new Date().toISOString(),
  schedule = true,
) {
  const today = reportingDay(now);
  return s.tx(() => {
    if (schedule) {
      for (const p of s.all("SELECT * FROM exception_periods")) {
        const end =
          p.end_day && p.end_day < today
            ? p.end_day
            : new Date(Date.parse(today + "T00:00:00Z") - 86400000)
                .toISOString()
                .slice(0, 10);
        if (p.catchup_day <= end) {
          enqueueExceptionWork(s, null, p.catchup_day, end, today, false);
          s.db
            .prepare("UPDATE exception_periods SET catchup_day=? WHERE id=?")
            .run(nextDay(end), p.id);
        }
      }
      if (
        s.one("SELECT type FROM exception_rules WHERE enabled=1") ||
        s.one(
          "SELECT id FROM attendance_exceptions WHERE day=? AND condition='active'",
          today,
        )
      )
        enqueueExceptionWork(s, null, today, today, today, false);
    }
    const job = s.one("SELECT * FROM exception_jobs ORDER BY rowid LIMIT 1");
    if (!job) return { processed: 0 };
    const employees = job.employee_id
      ? s.all(
          "SELECT * FROM employees WHERE id=? AND id>?",
          job.employee_id,
          job.employee_cursor,
        )
      : s.all(
          "SELECT * FROM employees WHERE id>? ORDER BY id LIMIT 101",
          job.employee_cursor,
        );
    for (const employee of employees.slice(0, 100))
      evaluate(s, employee, job.day, now);
    if (employees.length > 100)
      s.db
        .prepare("UPDATE exception_jobs SET employee_cursor=? WHERE id=?")
        .run(employees[99].id, job.id);
    else if (job.day < job.date_to)
      s.db
        .prepare(
          "UPDATE exception_jobs SET day=?,employee_cursor='' WHERE id=?",
        )
        .run(nextDay(job.day), job.id);
    else s.db.prepare("DELETE FROM exception_jobs WHERE id=?").run(job.id);
    return { processed: Math.min(employees.length, 100), day: job.day };
  });
}
export function exceptionRoutes(app: Express, s: Store) {
  app.get("/api/attendance-exceptions", (req, res) => {
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(req.query);
    const allowed = new Set(scopedEmployees(s, res.locals.user));
    const all = s
      .all(
        "SELECT x.*,e.name employee_name FROM attendance_exceptions x JOIN employees e ON e.id=x.employee_id ORDER BY x.day DESC,x.first_evaluated_at DESC",
      )
      .filter((x) => allowed.has(x.employee_id));
    const jobs = s
      .all("SELECT * FROM exception_jobs")
      .filter((j) => !j.employee_id || allowed.has(j.employee_id));
    res.json({
      rules: s.all("SELECT * FROM exception_rules"),
      rows: all.slice(q.offset, q.offset + q.limit).map((x) => ({
        ...x,
        evidence: JSON.parse(x.evidence_json),
        current_evidence: JSON.parse(x.current_evidence_json),
        evidence_json: undefined,
        current_evidence_json: undefined,
      })),
      total: all.length,
      counts: {
        activeUnreviewed: all.filter(
          (x) => x.condition === "active" && !x.ack_at,
        ).length,
        activeReviewed: all.filter((x) => x.condition === "active" && x.ack_at)
          .length,
        resolved: all.filter((x) => x.condition === "resolved").length,
      },
      reconciliation: {
        pending: jobs.length > 0,
        nextDay: jobs[0]?.day || null,
      },
    });
  });
  app.post("/api/attendance-exceptions/rules/:type", (req, res) => {
    configureRule(s, String(req.params.type), req.body, res.locals.actor);
    res.json({ ok: true });
  });
  app.post("/api/attendance-exceptions/:id/ack", (req, res) => {
    const p = z.object({ reason: z.string() }).parse(req.body);
    acknowledgeException(s, String(req.params.id), p.reason, res.locals.actor);
    res.json({ ok: true });
  });
}
