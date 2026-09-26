import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
test("supervisor scope restricts state export mutations and revokes sessions on account edits", async () => {
  process.env.ADMIN_PASSWORD = "Admin-password-123";
  const s = new Store(":memory:");
  for (const id of ["a", "b"])
    s.db
      .prepare(
        "INSERT INTO employees(id,name,role,site_ids,active) VALUES(?,?,'Staff','[]',1)",
      )
      .run(id, id);
  const app = createApp(s);
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('site','Site','Address',0,0,100)",
    )
    .run();
  for (const employee of ["a", "b"]) {
    s.db
      .prepare(
        "INSERT INTO visits VALUES(?,?, 'site','2026-09-09T12:00:00.000Z','2026-09-09T20:00:00.000Z','complete','demo')",
      )
      .run("v" + employee, employee);
    s.db
      .prepare(
        "INSERT INTO leaves VALUES(?,?,'Vacation','2026-09-09','2026-09-10','Fixture reason','pending')",
      )
      .run("l" + employee, employee);
    s.db
      .prepare("INSERT INTO overtime VALUES(?,?,30,'Fixture reason','pending')")
      .run("o" + employee, "v" + employee);
  }
  const id = upsertUser(
    s,
    {
      email: "super@example.test",
      name: "Supervisor",
      password: "Supervisor-pass-123",
      role: "supervisor",
      active: true,
      employee_ids: ["a"],
    },
    "bootstrap",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  const login = await fetch(url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "super@example.test",
      password: "Supervisor-pass-123",
    }),
  });
  const cookie = login.headers.get("set-cookie")!;
  const request = (path: string, body?: any) =>
    fetch(url + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal(login.status, 200);
    const state = await (await request("state")).json();
    assert.deepEqual(
      state.employees.map((x: any) => x.id),
      ["a"],
    );
    assert.equal(state.user.role, "supervisor");
    assert.equal(state.visits.length, 1);
    assert.equal(state.leaves.length, 1);
    assert.equal(
      (await request("leaves/la/decision", { status: "approved" })).status,
      200,
    );
    assert.equal(
      (await request("leaves/lb/decision", { status: "approved" })).status,
      403,
    );
    assert.equal(
      (await request("hr/overtime/oa", { status: "approved" })).status,
      200,
    );
    assert.equal(
      (await request("hr/overtime/ob", { status: "approved" })).status,
      403,
    );
    assert.equal(
      s.one("SELECT actor FROM audit WHERE entity_id='oa'").actor,
      "super@example.test",
    );
    const hr = await (await request("hr")).json();
    assert.equal(hr.overtime.length, 1);
    assert.equal(hr.overtime[0].id, "oa");
    assert.equal((await request("users")).status, 403);
    assert.equal((await request("employees", { id: "b" })).status, 403);
    assert.equal((await request("simulate", { employeeId: "b" })).status, 403);
    assert.equal(
      (await request("hr/assignment", { employee: "b", shift: "unknown" }))
        .status,
      403,
    );
    assert.equal((await request("correct", { id: "unknown" })).status, 403);
    for (const [path, body] of [
      ["simulate", { employeeId: "a" }],
      ["hr/assignment", { employee: "a", shift: "unknown" }],
      ["hr/break", { employee: "a", action: "start" }],
      ["leaves", { employee_id: "a" }],
      ["hr/tag", { employee: "a", tag: "x" }],
    ] as const)
      assert.equal((await request(path, body)).status, 403);
    assert.equal(
      (await request("calendar?from=2026-09-01&to=2026-09-02&employee=b"))
        .status,
      403,
    );
    const calendar = await (
      await request("calendar?from=2026-09-01&to=2026-09-02")
    ).json();
    assert.deepEqual(
      [...new Set(calendar.map((r: any) => r.employee_id))],
      ["a"],
    );
    assert.equal(
      (await request("schedules", { employee_id: "a" })).status,
      403,
    );
    assert.equal(
      (await request("schedules/nope/cancel", { reason: "Cancel reason" }))
        .status,
      403,
    );
    const csv = await (await request("export")).text();
    for (const path of [
      "STATE",
      "state/",
      "HR",
      "hr/",
      "USERS",
      "users/",
      "%73tate",
      "%75sers",
    ]) {
      const response = await request(path);
      if (response.status === 200) {
        const body = await response.json();
        assert.ok(!JSON.stringify(body).includes("5491100000002"));
        assert.ok(!Array.isArray(body) || !body.some((r: any) => r.email));
      } else assert.ok([403, 404].includes(response.status));
    }
    assert.ok(!csv.includes('"b"'));
    assert.ok(csv.includes('"a"'));
    upsertUser(
      s,
      {
        id,
        email: "super@example.test",
        name: "Supervisor",
        role: "supervisor",
        active: false,
        employee_ids: ["a"],
      },
      "bootstrap",
    );
    assert.equal((await request("state")).status, 401);
    assert.ok(
      !s
        .one("SELECT password_hash FROM users WHERE id=?", id)
        .password_hash.includes("Supervisor-pass"),
    );
  } finally {
    server.close();
  }
});

test("account management protects final admin and never persists password in audit", () => {
  const s = new Store(":memory:");
  const id = upsertUser(
    s,
    {
      email: "admin@example.test",
      name: "Admin",
      password: "Secure-password-123",
      role: "admin",
      active: true,
    },
    "bootstrap",
  );
  assert.throws(() =>
    upsertUser(
      s,
      {
        id,
        email: "admin@example.test",
        name: "Admin",
        role: "hr",
        active: true,
      },
      "admin@example.test",
    ),
  );
  assert.throws(() =>
    upsertUser(
      s,
      {
        id,
        email: "admin@example.test",
        name: "Admin",
        role: "admin",
        active: false,
      },
      "admin@example.test",
    ),
  );
  const serialized = JSON.stringify(s.all("SELECT * FROM audit"));
  assert.ok(!serialized.includes("password"));
  assert.ok(!serialized.includes("Secure-password"));
});
