import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  configureRule,
  processExceptions,
  acknowledgeException,
} from "../server/attendance-exceptions";
import { enqueueExceptionWork } from "../server/exception-work";
function setup() {
  const s = new Store(":memory:");
  s.db.exec(
    "INSERT INTO employees(id,name,phone) VALUES('e','Employee','123'); INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('s','Site','Address',0,0,100)",
  );
  const slots = Array(7).fill({
    name: "Morning",
    start: "09:00",
    end: "17:00",
    tolerance: 10,
  });
  s.db
    .prepare(
      "INSERT INTO schedules VALUES('plan','e','2026-01-01','2027-12-31','2026-01-01',7,?,'active')",
    )
    .run(JSON.stringify(slots));
  return s;
}
const now = "2026-09-15T21:00:00.000Z";
function drain(s: Store, time = now) {
  for (
    let i = 0;
    i < 500 && s.one("SELECT id FROM exception_jobs LIMIT 1");
    i++
  )
    processExceptions(s, time, false);
}
test("activation today avoids retroactive creation; absence reviewed is not resolved and repeated scan does not duplicate audit", () => {
  const s = setup();
  configureRule(s, "absent", { enabled: true, priority: "high" }, "hr", now);
  drain(s);
  const e = s.one("SELECT * FROM attendance_exceptions");
  assert.equal(e.day, "2026-09-15");
  assert.equal(e.condition, "active");
  assert.equal(e.priority, "high");
  acknowledgeException(s, e.id, "Reviewed with manager", "hr");
  const count = s.one("SELECT COUNT(*) n FROM audit").n;
  acknowledgeException(s, e.id, "Second acknowledgement", "other");
  enqueueExceptionWork(s, "e", "2026-09-14", "2026-09-15");
  drain(s);
  assert.equal(s.one("SELECT COUNT(*) n FROM attendance_exceptions").n, 1);
  assert.equal(s.one("SELECT COUNT(*) n FROM audit").n, count);
  assert.equal(
    s.one("SELECT ack_actor FROM attendance_exceptions").ack_actor,
    "hr",
  );
  s.db.close();
});
test("manual arrival resolves absence and creates independent late identity; holiday resolves while rule off", () => {
  const s = setup();
  for (const type of ["late", "absent"])
    configureRule(s, type, { enabled: true, priority: "normal" }, "hr", now);
  drain(s);
  s.db.exec(
    "INSERT INTO visits VALUES('v','e','s','2026-09-15T13:00:00Z','2026-09-15T14:00:00Z','corrected','manual_hr')",
  );
  enqueueExceptionWork(s, "e", "2026-09-15", "2026-09-15");
  drain(s);
  assert.equal(
    s.one("SELECT condition FROM attendance_exceptions WHERE type='absent'")
      .condition,
    "resolved",
  );
  assert.equal(
    s.one("SELECT condition FROM attendance_exceptions WHERE type='late'")
      .condition,
    "active",
  );
  configureRule(s, "late", { enabled: false, priority: "normal" }, "hr", now);
  s.db.exec("INSERT INTO holidays VALUES('2026-09-15','Holiday')");
  enqueueExceptionWork(s, null, "2026-09-15", "2026-09-15");
  drain(s);
  assert.equal(
    s.one(
      "SELECT condition_reason FROM attendance_exceptions WHERE type='late'",
    ).condition_reason,
    "holiday",
  );
  s.db.close();
});
test("catchup advances beyond 93 days and per-day batches cap 100 employees with durable cursor", () => {
  const s = setup();
  configureRule(
    s,
    "absent",
    { enabled: true, priority: "normal" },
    "hr",
    "2026-05-01T21:00:00Z",
  );
  drain(s, "2026-05-01T21:00:00Z");
  processExceptions(s, now);
  assert.ok(s.one("SELECT * FROM exception_jobs"));
  for (let i = 0; i < 180; i++) processExceptions(s, now);
  assert.ok(
    s.one("SELECT id FROM attendance_exceptions WHERE day='2026-09-14'"),
  );
  for (let i = 0; i < 105; i++)
    s.db
      .prepare("INSERT INTO employees(id,name,phone) VALUES(?,?,?)")
      .run("z" + i, "Synthetic", String(1000 + i));
  enqueueExceptionWork(s, null, "2026-09-15", "2026-09-15");
  processExceptions(s, now, false);
  assert.ok(
    s.one("SELECT employee_cursor FROM exception_jobs")?.employee_cursor,
  );
  s.db.close();
});

test("exact tolerance is on time; absence only after end and inactive drafts overnight rest future suppress detection", () => {
  for (const variant of [
    "boundary",
    "end",
    "draft",
    "night",
    "rest",
    "future",
  ]) {
    const s = setup();
    configureRule(s, "late", { enabled: true, priority: "normal" }, "hr", now);
    configureRule(
      s,
      "absent",
      { enabled: true, priority: "normal" },
      "hr",
      now,
    );
    if (variant === "boundary")
      s.db.exec(
        "INSERT INTO visits VALUES('v','e','s','2026-09-15T12:10:00.000Z',NULL,'open','simulator')",
      );
    if (variant === "draft") s.db.exec("UPDATE schedules SET status='draft'");
    if (variant === "night" || variant === "rest")
      s.db.prepare("UPDATE schedules SET slots_json=?").run(
        JSON.stringify(
          Array(7).fill(
            variant === "rest"
              ? null
              : {
                  name: "Night",
                  start: "22:00",
                  end: "06:00",
                  tolerance: 10,
                },
          ),
        ),
      );
    drain(
      s,
      variant === "end"
        ? "2026-09-15T20:00:00.000Z"
        : variant === "future"
          ? "2026-09-14T20:00:00.000Z"
          : now,
    );
    assert.equal(
      s.one("SELECT COUNT(*) n FROM attendance_exceptions").n,
      0,
      variant,
    );
    s.db.close();
  }
});
test("disable and reenable retain activation gaps and first priority snapshot", () => {
  const s = setup();
  configureRule(
    s,
    "absent",
    { enabled: true, priority: "high" },
    "hr",
    "2026-09-10T21:00:00Z",
  );
  drain(s, "2026-09-10T21:00:00Z");
  configureRule(
    s,
    "absent",
    { enabled: false, priority: "normal" },
    "hr",
    "2026-09-10T22:00:00Z",
  );
  configureRule(s, "absent", { enabled: true, priority: "low" }, "hr", now);
  enqueueExceptionWork(s, "e", "2026-09-01", "2026-09-15", "2026-09-15");
  drain(s);
  assert.equal(
    s.one(
      "SELECT COUNT(*) n FROM attendance_exceptions WHERE day BETWEEN '2026-09-11' AND '2026-09-14'",
    ).n,
    0,
  );
  assert.equal(
    s.one("SELECT priority FROM attendance_exceptions WHERE day='2026-09-10'")
      .priority,
    "high",
  );
  assert.equal(
    s.one("SELECT priority FROM attendance_exceptions WHERE day='2026-09-15'")
      .priority,
    "low",
  );
  s.db.close();
});
test("batch exception writes audit and cursor roll back together and retry is idempotent", () => {
  const s = setup();
  configureRule(s, "absent", { enabled: true, priority: "normal" }, "hr", now);
  const before = s.one("SELECT * FROM exception_jobs");
  s.db.exec(
    "CREATE TRIGGER fail_exception_audit BEFORE INSERT ON audit WHEN NEW.actor='exception-worker' BEGIN SELECT RAISE(ABORT,'forced'); END",
  );
  assert.throws(() => processExceptions(s, now, false));
  assert.equal(s.one("SELECT COUNT(*) n FROM attendance_exceptions").n, 0);
  assert.deepEqual(s.one("SELECT * FROM exception_jobs"), before);
  s.db.exec("DROP TRIGGER fail_exception_audit");
  processExceptions(s, now, false);
  const count = s.one("SELECT COUNT(*) n FROM audit").n;
  enqueueExceptionWork(s, "e", "2026-09-15", "2026-09-15");
  enqueueExceptionWork(s, "e", "2026-09-15", "2026-09-15");
  assert.equal(s.one("SELECT COUNT(*) n FROM exception_jobs").n, 1);
  drain(s);
  assert.equal(s.one("SELECT COUNT(*) n FROM audit").n, count);
  s.db.close();
});
import { recordManualVisit } from "../server/manual";
test("manual mutation and reconciliation job are atomic including rejection", () => {
  const s = setup();
  s.db.exec(`UPDATE employees SET site_ids='["s"]'`);
  configureRule(
    s,
    "absent",
    { enabled: true, priority: "normal" },
    "hr",
    "2026-09-01T21:00:00Z",
  );
  drain(s, "2026-09-01T21:00:00Z");
  const p = {
    employee_id: "e",
    site_id: "s",
    entry_at: "2026-09-01T13:00:00Z",
    exit_at: "2026-09-01T14:00:00Z",
    reason: "Confirmed historical interval",
  };
  s.db.exec(
    "CREATE TRIGGER fail_job BEFORE INSERT ON exception_jobs BEGIN SELECT RAISE(ABORT,'forced'); END",
  );
  assert.throws(() => recordManualVisit(s, p, "hr"));
  assert.equal(s.one("SELECT COUNT(*) n FROM visits").n, 0);
  s.db.exec("DROP TRIGGER fail_job");
  recordManualVisit(s, p, "hr");
  assert.equal(s.one("SELECT day FROM exception_jobs").day, "2026-09-01");
  drain(s);
  assert.equal(
    s.one("SELECT condition FROM attendance_exceptions WHERE day='2026-09-01'")
      .condition,
    "resolved",
  );
  assert.throws(() => recordManualVisit(s, p, "hr"));
  assert.equal(s.one("SELECT COUNT(*) n FROM exception_jobs").n, 0);
  s.db.close();
});
import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
test("supervisor list counts pagination and audit are scoped and rule/ack mutations forbidden", async () => {
  process.env.ADMIN_PASSWORD = "Exceptions-admin-123";
  const s = setup();
  s.db.exec(
    "INSERT INTO employees(id,name,phone) VALUES('private','Private Person','999'); INSERT INTO schedules SELECT 'privateplan','private',date_from,date_to,anchor,cycle,slots_json,status FROM schedules LIMIT 1",
  );
  configureRule(s, "absent", { enabled: true, priority: "normal" }, "hr", now);
  drain(s);
  const app = createApp(s);
  upsertUser(
    s,
    {
      email: "scope@example.test",
      name: "Supervisor",
      password: "Supervisor-pass-123",
      role: "supervisor",
      active: true,
      employee_ids: ["e"],
    },
    "hr",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    const login = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "scope@example.test",
        password: "Supervisor-pass-123",
      }),
    });
    const cookie = login.headers.get("set-cookie")!;
    const response = await fetch(url + "/api/attendance-exceptions?limit=1", {
      headers: { cookie },
    });
    const body = await response.json();
    assert.equal(body.total, 1);
    assert.equal(body.counts.activeUnreviewed, 1);
    assert.equal(body.rows[0].employee_id, "e");
    assert.ok(!JSON.stringify(body).includes("Private Person"));
    const state = await (
      await fetch(url + "/api/state", { headers: { cookie } })
    ).json();
    assert.ok(
      state.audit.every(
        (a: any) => JSON.parse(a.after_json).employee_id === "e",
      ),
    );
    for (const path of ["rules/absent", body.rows[0].id + "/ack"])
      assert.equal(
        (
          await fetch(url + "/api/attendance-exceptions/" + path, {
            method: "POST",
            headers: { cookie, "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: false,
              priority: "normal",
              reason: "Reviewed today",
            }),
          })
        ).status,
        403,
      );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("employee cursor survives database reopen and completes remaining rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "carahue-exceptions-"));
  const path = join(dir, "test.sqlite");
  let s = new Store(path);
  try {
    for (let i = 0; i < 105; i++)
      s.db
        .prepare("INSERT INTO employees(id,name,phone) VALUES(?,?,?)")
        .run(String(i).padStart(3, "0"), "Synthetic", String(i + 1000));
    configureRule(
      s,
      "absent",
      { enabled: true, priority: "normal" },
      "hr",
      now,
    );
    const first = processExceptions(s, now, false);
    assert.equal(first.processed, 100);
    const cursor = s.one(
      "SELECT employee_cursor FROM exception_jobs",
    ).employee_cursor;
    assert.equal(cursor, "099");
    s.db.close();
    s = new Store(path);
    const last = processExceptions(s, now, false);
    assert.equal(last.processed, 5);
    assert.equal(s.one("SELECT COUNT(*) n FROM exception_jobs").n, 0);
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("employee endpoint deactivation and reactivation recheck historical identities while rule is disabled", async () => {
  process.env.ADMIN_PASSWORD = "Exceptions-admin-123";
  const s = setup();
  configureRule(
    s,
    "absent",
    { enabled: true, priority: "normal" },
    "hr",
    "2026-09-01T21:00:00Z",
  );
  drain(s, "2026-09-01T21:00:00Z");
  const original = s.one(
    "SELECT * FROM attendance_exceptions WHERE day='2026-09-01'",
  );
  configureRule(
    s,
    "absent",
    { enabled: false, priority: "normal" },
    "hr",
    "2026-09-01T22:00:00Z",
  );
  drain(s);
  const app = createApp(s),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    const login = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@carahue.local",
        password: "Exceptions-admin-123",
      }),
    });
    const cookie = login.headers.get("set-cookie")!;
    const mutate = (active: number, phone = "5491100000011") =>
      fetch(url + "/api/employees", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "e",
          name: "Employee",
          phone,
          role: "Staff",
          site_ids: ["s"],
          active,
        }),
      });
    assert.equal((await mutate(0)).status, 200);
    drain(s);
    assert.equal(
      s.one(
        "SELECT condition_reason FROM attendance_exceptions WHERE id=?",
        original.id,
      ).condition_reason,
      "inactive",
    );
    assert.equal((await mutate(1)).status, 200);
    drain(s);
    const after = s.one(
      "SELECT * FROM attendance_exceptions WHERE id=?",
      original.id,
    );
    assert.equal(after.condition, "active");
    assert.equal(after.condition_reason, "absent");
    assert.equal(after.first_evaluated_at, original.first_evaluated_at);
    assert.equal(s.one("SELECT COUNT(*) n FROM attendance_exceptions").n, 1);
    s.db.exec(
      "CREATE TRIGGER fail_activation_job BEFORE INSERT ON exception_jobs BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    const auditCount = s.one("SELECT COUNT(*) n FROM audit").n;
    assert.equal((await mutate(0)).status, 400);
    assert.equal(s.one("SELECT active FROM employees WHERE id='e'").active, 1);
    assert.equal(s.one("SELECT COUNT(*) n FROM exception_jobs").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM audit").n, auditCount);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});
