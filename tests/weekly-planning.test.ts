import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { saveWeek, planningWeek } from "../server/weekly-planning";
import { calendar, createSchedule } from "../server/schedules";
function setup() {
  const s = new Store(":memory:");
  s.db.exec(
    `INSERT INTO employees VALUES('e','Synthetic','Staff','["a","b"]',1);INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('a','Site A','Address',0,0,100),('b','Site B','Address',1,1,100);INSERT INTO shifts VALUES('m','Morning','09:00','17:00',10),('n','Night','22:00','06:00',5)`,
  );
  return s;
}
const user = { role: "hr" };
const batch = (changes: any[]) => ({
  week: "2026-09-14",
  reason: "Confirmed synthetic week",
  changes,
});
const cell = (mode: string, revision = 0, extras = {}) => ({
  employee_id: "e",
  day: "2026-09-15",
  mode,
  expected_revision: revision,
  ...extras,
});
test("date override establishes expectation outside cycles and inherit tombstones preserve revision against stale ABA", () => {
  const s = setup();
  try {
    saveWeek(
      s,
      batch([cell("shift", 0, { shift_id: "m", site_id: "a" })]),
      user,
      "hr",
    );
    let c = calendar(
      s,
      ["e"],
      "2026-09-15",
      "2026-09-16",
      "2026-09-16T23:00:00Z",
    );
    assert.equal(c[0].status, "absent");
    assert.equal(c[0].expectation_origin, "override");
    assert.equal(c[0].planned_site.id, "a");
    assert.equal(c[1].status, "unscheduled");
    saveWeek(s, batch([cell("rest", 1)]), user, "hr");
    assert.equal(
      calendar(s, ["e"], "2026-09-15", "2026-09-15")[0].status,
      "rest",
    );
    saveWeek(s, batch([cell("inherit", 2)]), user, "hr");
    assert.equal(
      calendar(s, ["e"], "2026-09-15", "2026-09-15")[0].status,
      "unscheduled",
    );
    assert.equal(s.one("SELECT revision FROM planning_overrides").revision, 3);
    assert.throws(
      () =>
        saveWeek(s, batch([cell("shift", 0, { shift_id: "m" })]), user, "hr"),
      (e: any) => e.status === 409,
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM planning_revisions").n, 3);
  } finally {
    s.db.close();
  }
});
test("one stale or invalid cell rejects entire batch including audits and reconciliation work", () => {
  const s = setup();
  try {
    saveWeek(s, batch([cell("rest")]), user, "hr");
    s.db.exec("DELETE FROM exception_jobs");
    const audit = s.one("SELECT COUNT(*) n FROM audit").n;
    assert.throws(() =>
      saveWeek(
        s,
        batch([{ ...cell("rest"), day: "2026-09-16" }, cell("inherit", 0)]),
        user,
        "hr",
      ),
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM planning_overrides").n, 1);
    assert.equal(s.one("SELECT COUNT(*) n FROM exception_jobs").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM audit").n, audit);
    for (const changes of [
      [cell("rest", 1), cell("rest", 1)],
      [{ ...cell("rest"), day: "2026-09-21" }],
      [cell("shift", 1, { shift_id: "m", site_id: "unauthorized" })],
      [cell("rest", 1, { site_id: "a" })],
    ])
      assert.throws(() => saveWeek(s, batch(changes), user, "hr"));
    assert.throws(() =>
      saveWeek(
        s,
        { ...batch([cell("rest", 1)]), week: "2026-09-15" },
        user,
        "hr",
      ),
    );
  } finally {
    s.db.close();
  }
});
import { editCatalog, createCatalog } from "../server/catalogs";
import { applyAction } from "../server/domain";
import {
  configureRule,
  processExceptions,
} from "../server/attendance-exceptions";
test("rest and inherit override only one cycle date and snapshots survive catalog edits and archive", () => {
  const s = setup();
  try {
    createSchedule(
      s,
      {
        employee_id: "e",
        date_from: "2026-09-14",
        date_to: "2026-09-20",
        anchor: "2026-09-14",
        cycle: 7,
        slots: Array(7).fill("m"),
        reason: "Original rotation",
      },
      "hr",
    );
    saveWeek(s, batch([cell("rest")]), user, "hr");
    let rows = calendar(
      s,
      ["e"],
      "2026-09-14",
      "2026-09-16",
      "2026-09-16T23:00:00Z",
    );
    assert.equal(rows[0].expectation_origin, "rotation");
    assert.equal(rows[1].status, "rest");
    assert.equal(rows[2].expectation_origin, "rotation");
    saveWeek(s, batch([cell("inherit", 1)]), user, "hr");
    assert.equal(
      calendar(s, ["e"], "2026-09-15", "2026-09-15")[0].shift_name,
      "Morning",
    );
    saveWeek(
      s,
      batch([cell("shift", 2, { shift_id: "m", site_id: "a" })]),
      user,
      "hr",
    );
    const original = s.one(
      "SELECT snapshot_json FROM planning_overrides",
    ).snapshot_json;
    editCatalog(
      s,
      "shift",
      "m",
      {
        expected_revision: 1,
        name: "Later",
        start: "10:00",
        end: "18:00",
        tolerance: 30,
        reason: "Change reference only",
      },
      "hr",
    );
    editCatalog(
      s,
      "shift",
      "m",
      { expected_revision: 2, archive: true, reason: "Archive reference only" },
      "hr",
    );
    s.db
      .prepare("UPDATE sites SET name=?,active=0 WHERE id=?")
      .run("Renamed site", "a");
    assert.equal(
      s.one("SELECT snapshot_json FROM planning_overrides").snapshot_json,
      original,
    );
    const c = calendar(s, ["e"], "2026-09-15", "2026-09-15")[0];
    assert.equal(c.start, "09:00");
    assert.equal(c.planned_site.name, "Site A");
    assert.throws(() =>
      saveWeek(
        s,
        batch([{ ...cell("shift", 0, { shift_id: "m" }), day: "2026-09-16" }]),
        user,
        "hr",
      ),
    );
    saveWeek(s, batch([{ ...cell("rest"), day: "2026-09-16" }]), user, "hr");
    assert.equal(
      s.one(
        "SELECT snapshot_json FROM planning_overrides WHERE day='2026-09-15'",
      ).snapshot_json,
      original,
    );
  } finally {
    s.db.close();
  }
});
test("planned site is expectation only and all authorized actual sites still work without measured-record mutation", () => {
  const s = setup();
  try {
    saveWeek(
      s,
      batch([cell("shift", 0, { shift_id: "m", site_id: "a" })]),
      user,
      "hr",
    );
    applyAction(s, {
      id: "arrival-b",
      employeeId: "e",
      action: "entry",
      siteId: "b",
      lat: 1,
      lon: 1,
      time: "2026-09-15T12:10:00Z",
      source: "simulator",
    });
    const tables = ["visits", "events", "breaks"];
    const before = tables.map((t) =>
      JSON.stringify(s.all("SELECT * FROM " + t)),
    );
    assert.equal(
      calendar(s, ["e"], "2026-09-15", "2026-09-15", "2026-09-15T23:00:00Z")[0]
        .status,
      "on_time",
    );
    saveWeek(s, batch([cell("rest", 1)]), user, "hr");
    assert.deepEqual(
      tables.map((t) => JSON.stringify(s.all("SELECT * FROM " + t))),
      before,
    );
    s.db.exec(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('c','Unauthorized','Address',2,2,100)",
    );
    assert.throws(() =>
      saveWeek(
        s,
        batch([cell("shift", 2, { shift_id: "m", site_id: "c" })]),
        user,
        "hr",
      ),
    );
  } finally {
    s.db.close();
  }
});
test("weekly expectations retain holiday leave future and overnight handling and reconcile exceptions", () => {
  const s = setup();
  try {
    const now = "2026-09-15T23:00:00Z";
    configureRule(
      s,
      "absent",
      { enabled: true, priority: "normal" },
      "hr",
      now,
    );
    const drain = () => {
      for (let i = 0; i < 30 && s.one("SELECT id FROM exception_jobs"); i++)
        processExceptions(s, now, false);
    };
    saveWeek(s, batch([cell("shift", 0, { shift_id: "m" })]), user, "hr");
    drain();
    assert.equal(
      s.one("SELECT condition FROM attendance_exceptions").condition,
      "active",
    );
    saveWeek(s, batch([cell("rest", 1)]), user, "hr");
    drain();
    assert.equal(
      s.one("SELECT condition FROM attendance_exceptions").condition,
      "resolved",
    );
    saveWeek(s, batch([cell("shift", 2, { shift_id: "n" })]), user, "hr");
    assert.equal(
      calendar(s, ["e"], "2026-09-15", "2026-09-15", now)[0].status,
      "review_required",
    );
    createCatalog(
      s,
      "holiday",
      { day: "2026-09-15", name: "Synthetic holiday" },
      "hr",
    );
    assert.equal(
      calendar(s, ["e"], "2026-09-15", "2026-09-15", now)[0].status,
      "holiday",
    );
    saveWeek(
      s,
      batch([{ ...cell("shift", 0, { shift_id: "m" }), day: "2026-09-16" }]),
      user,
      "hr",
    );
    assert.equal(
      calendar(s, ["e"], "2026-09-16", "2026-09-16", now)[0].status,
      "upcoming",
    );
    s.db.exec(
      "INSERT INTO leaves VALUES('leave','e','Vacation','2026-09-16','2026-09-16','Synthetic reason','approved')",
    );
    assert.equal(
      calendar(s, ["e"], "2026-09-16", "2026-09-16", now)[0].status,
      "leave",
    );
  } finally {
    s.db.close();
  }
});
test("forced audit failure rolls back entire weekly batch and no client snapshot or inactive selection is accepted", () => {
  const s = setup();
  try {
    s.db.exec(
      "CREATE TRIGGER fail_week BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    assert.throws(() =>
      saveWeek(
        s,
        batch([cell("rest"), { ...cell("rest"), day: "2026-09-16" }]),
        user,
        "hr",
      ),
    );
    for (const table of [
      "planning_overrides",
      "planning_revisions",
      "exception_jobs",
    ])
      assert.equal(s.one("SELECT COUNT(*) n FROM " + table).n, 0);
    s.db.exec("DROP TRIGGER fail_week");
    assert.throws(() =>
      saveWeek(
        s,
        batch([
          cell("shift", 0, { shift_id: "m", snapshot: { start: "00:00" } }),
        ]),
        user,
        "hr",
      ),
    );
    s.db.exec("UPDATE employees SET active=0 WHERE id='e'");
    assert.throws(() => saveWeek(s, batch([cell("rest")]), user, "hr"));
  } finally {
    s.db.close();
  }
});

import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
test("weekly HTTP scopes pagination and history before disclosure and all supervisor writes are forbidden", async () => {
  process.env.ADMIN_PASSWORD = "Weekly-admin-test-2026";
  const s = setup();
  s.db.exec(
    "INSERT INTO employees(id,name,role) VALUES('other','Hidden employee','5491100000022')",
  );
  saveWeek(
    s,
    batch([cell("rest"), { ...cell("rest"), employee_id: "other" }]),
    user,
    "hr",
  );
  const app = createApp(s);
  upsertUser(
    s,
    {
      email: "weekly-supervisor@example.test",
      name: "Supervisor",
      role: "supervisor",
      active: true,
      employee_ids: ["e"],
      password: "Weekly-supervisor-2026",
    },
    "admin",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const login = async (body: any) =>
    (
      await fetch(base + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).headers.get("set-cookie")!;
  try {
    const sup = await login({
        email: "weekly-supervisor@example.test",
        password: "Weekly-supervisor-2026",
      }),
      admin = await login({ password: "Weekly-admin-test-2026" });
    const get = (path: string) =>
      fetch(base + path, { headers: { cookie: sup } });
    const first = await (
      await get("/api/planning/week?week=2026-09-14&limit=1")
    ).json();
    assert.equal(first.total, 1);
    assert.deepEqual(
      first.rows.map((r: any) => r.id),
      ["e"],
    );
    assert.equal(first.rows[0].cells.length, 7);
    const empty = await (
      await get("/api/planning/week?week=2026-09-14&limit=1&offset=1")
    ).json();
    assert.equal(empty.total, 1);
    assert.equal(empty.rows.length, 0);
    assert.equal(
      (await get("/api/planning/week?week=2026-09-14&employee=other")).status,
      403,
    );
    assert.equal(
      (await get("/api/planning/history?employee=other&day=2026-09-15")).status,
      403,
    );
    const history = await (
      await get("/api/planning/history?employee=e&day=2026-09-15")
    ).json();
    assert.equal(history.total, 1);
    assert.equal(history.rows[0].employee_id, "e");
    const post = (cookie: string, body: any) =>
      fetch(base + "/api/planning/week", {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await post(sup, batch([cell("inherit", 1)]))).status, 403);
    assert.equal((await post(admin, batch([cell("inherit", 0)]))).status, 409);
    assert.equal(
      (await post(admin, { ...batch([cell("inherit", 1)]), actor: "spoof" }))
        .status,
      400,
    );
    assert.equal((await post(admin, batch([cell("inherit", 1)]))).status, 200);
    assert.equal(
      s.one(
        "SELECT actor FROM planning_revisions WHERE employee_id='e' AND revision=2",
      ).actor,
      "admin@carahue.local",
    );
    assert.equal(
      (await get("/api/planning/week?week=2026-09-14&limit=51")).status,
      400,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});
test("week batch employee and cell caps reject atomically and pagination includes only requested slice", () => {
  const s = setup();
  try {
    const changes: any[] = [];
    for (let i = 0; i < 51; i++) {
      const id = "person-" + i;
      s.db
        .prepare("INSERT INTO employees(id,name,role) VALUES(?,?,?)")
        .run(id, "Synthetic " + String(i).padStart(2, "0"), "5000" + i);
      changes.push({ ...cell("rest"), employee_id: id });
    }
    assert.throws(() => saveWeek(s, batch(changes), user, "hr"));
    assert.throws(() =>
      saveWeek(s, batch(Array(351).fill(cell("rest"))), user, "hr"),
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM planning_revisions").n, 0);
    const page = planningWeek(
      s,
      { week: "2026-09-14", limit: 5, offset: 5 },
      user,
    );
    assert.equal(page.total, 52);
    assert.equal(page.rows.length, 5);
    assert.equal(new Set(page.rows.map((r) => r.id)).size, 5);
  } finally {
    s.db.close();
  }
});
