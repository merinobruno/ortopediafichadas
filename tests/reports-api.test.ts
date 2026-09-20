import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
test("report summary and both CSV exports share validated filters and supervisor scope", async () => {
  process.env.ADMIN_PASSWORD = "Reports-admin-123";
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('a','North','Address',0,0,100),('b','South','Address',1,1,100)",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO employees VALUES('e','Alice','5491100000011','Staff','[\"a\",\"b\"]',1),('private','Private person','5491100000012','Staff','[\"a\"]',1)",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO visits VALUES('v1','e','a','2026-09-10T01:00:00.000Z','2026-09-10T05:00:00.000Z','corrected','manual_hr'),('v2','e','b','2026-09-10T06:00:00.000Z','2026-09-10T07:00:00.000Z','complete','demo'),('privatev','private','a','2026-09-10T01:00:00.000Z','2026-09-10T09:00:00.000Z','complete','demo')",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO breaks VALUES('p','v1','2026-09-10T02:00:00.000Z','2026-09-10T02:30:00.000Z','complete')",
    )
    .run();
  s.db
    .prepare("INSERT INTO overtime VALUES('o','v1',30,'Reason','approved')")
    .run();
  const app = createApp(s);
  upsertUser(
    s,
    {
      email: "reports@example.test",
      name: "Supervisor",
      password: "Reports-pass-123",
      role: "supervisor",
      active: true,
      employee_ids: ["e"],
    },
    "bootstrap",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    const login = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reports@example.test",
        password: "Reports-pass-123",
      }),
    });
    const cookie = login.headers.get("set-cookie")!;
    const get = (path: string) =>
      fetch(url + "/api/" + path, { headers: { cookie } });
    const filters =
      "from=2026-09-09&to=2026-09-09&employee=e&site=a&status=corrected&search=ali";
    const summary = await (await get("reports/summary?" + filters)).json();
    assert.equal(summary.overall.visits, 1);
    assert.equal(summary.overall.netHours, 3.5);
    assert.equal(summary.approvedOvertimeMinutes, 30);
    assert.deepEqual(
      summary.details.map((v: any) => v.id),
      ["v1"],
    );
    assert.ok(!JSON.stringify(summary).includes("Private person"));
    for (const key of ["users", "audit", "integration", "events"])
      assert.equal(summary[key], undefined);
    const detail = await (await get("export?" + filters)).text();
    assert.equal(detail.split("\r\n").length, 2);
    assert.ok(detail.includes("3.50"));
    const csv = await (await get("reports/summary.csv?" + filters)).text();
    assert.ok(csv.includes("3.50"));
    assert.ok(!csv.includes("Private person"));
    const all = await (await get("reports/summary")).json();
    assert.equal(all.overall.visits, 2);
    for (const endpoint of [
      "reports/summary",
      "reports/summary.csv",
      "export",
    ]) {
      assert.equal((await get(endpoint + "?employee=private")).status, 403);
      assert.equal((await get(endpoint + "?from=2026-02-30")).status, 400);
      assert.equal(
        (await get(endpoint + "?from=2026-09-10&to=2026-09-01")).status,
        400,
      );
      assert.equal((await get(endpoint + "?status=invalid")).status, 400);
      assert.equal(
        (await get(endpoint + "?from=2026-09-01&from=2026-09-02")).status,
        400,
      );
    }
  } finally {
    server.close();
  }
});
