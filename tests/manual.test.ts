import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { recordManualVisit, correctUnknownBreak } from "../server/manual";
import { applyAction, correctExit } from "../server/domain";
function setup() {
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO employees VALUES('e','Employee','5491100000011','Staff','[\"a\",\"b\"]',1)",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('a','A','Address',0,0,100),('b','B','Address',1,1,100)",
    )
    .run();
  return s;
}
const input = (
  entry = "2026-09-01T12:00:00Z",
  exit = "2026-09-01T14:00:00Z",
) => ({
  employee_id: "e",
  site_id: "a",
  entry_at: entry,
  exit_at: exit,
  reason: "Confirmed by supervisor",
});
test("manual visit stores explicit audited provenance without a provider event, allows adjacency", () => {
  const s = setup();
  const id = recordManualVisit(s, input(), "hr@example.test");
  assert.equal(
    s.one("SELECT * FROM visits WHERE id=?", id).source,
    "manual_hr",
  );
  assert.equal(s.all("SELECT * FROM events").length, 0);
  assert.equal(s.one("SELECT * FROM audit").actor, "hr@example.test");
  recordManualVisit(
    s,
    input("2026-09-01T14:00:00Z", "2026-09-01T15:00:00Z"),
    "hr",
  );
  assert.throws(() =>
    recordManualVisit(
      s,
      input("2026-09-01T13:59:59Z", "2026-09-01T16:00:00Z"),
      "hr",
    ),
  );
  assert.equal(s.all("SELECT * FROM visits").length, 2);
});
test("manual validation rejects inactive unauthorized impossible or future records", () => {
  const s = setup();
  for (const p of [
    { ...input(), entry_at: "2026-02-30T12:00:00Z" },
    input("2099-01-01T12:00:00Z", "2099-01-01T14:00:00Z"),
    input("2026-09-01T15:00:00Z", "2026-09-01T14:00:00Z"),
    { ...input(), site_id: "unknown" },
  ])
    assert.throws(() => recordManualVisit(s, p, "hr"));
  s.db.prepare("UPDATE employees SET active=0").run();
  assert.throws(() => recordManualVisit(s, input(), "hr"));
  assert.equal(s.all("SELECT * FROM visits").length, 0);
});
test("unknown exits reserve until next entry and open visits reserve indefinitely", () => {
  const s = setup();
  s.db
    .prepare(
      "INSERT INTO visits VALUES('old','e','a','2026-09-01T10:00:00.000Z',NULL,'exit_unknown','demo'),('open','e','b','2026-09-01T15:00:00.000Z',NULL,'open','demo')",
    )
    .run();
  assert.throws(() => recordManualVisit(s, input(), "hr"));
  assert.throws(() =>
    recordManualVisit(
      s,
      input("2026-09-02T12:00:00Z", "2026-09-02T14:00:00Z"),
      "hr",
    ),
  );
  recordManualVisit(
    s,
    input("2026-09-01T08:00:00Z", "2026-09-01T10:00:00Z"),
    "hr",
  );
});
test("delayed live input cannot overlap manual completed visit but historical insertion adds no event watermark", () => {
  const s = setup();
  recordManualVisit(s, input(), "hr");
  const live = {
    id: "live",
    phone: "5491100000011",
    action: "entry",
    siteId: "a",
    lat: 0,
    lon: 0,
    time: "2026-09-01T13:00:00Z",
    source: "whatsapp",
  };
  assert.throws(() => applyAction(s, live));
  applyAction(s, { ...live, time: "2026-09-01T14:00:00Z" });
  assert.equal(s.all("SELECT * FROM events").length, 1);
});
test("unknown pause correction honors boundary and audits original null; exit cannot truncate pauses", () => {
  const s = setup();
  s.db
    .prepare(
      "INSERT INTO visits VALUES('old','e','a','2026-09-01T10:00:00.000Z',NULL,'exit_unknown','demo'),('next','e','b','2026-09-01T15:00:00.000Z',NULL,'open','demo')",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO breaks VALUES('pause','old','2026-09-01T12:00:00.000Z',NULL,'end_unknown')",
    )
    .run();
  assert.throws(() =>
    correctExit(s, "old", "2026-09-01T11:00:00Z", "Confirmed exit", "hr"),
  );
  assert.throws(() =>
    correctUnknownBreak(
      s,
      "pause",
      "2026-09-01T15:01:00Z",
      "Confirmed break",
      "hr",
    ),
  );
  correctUnknownBreak(
    s,
    "pause",
    "2026-09-01T12:30:00Z",
    "Confirmed break",
    "hr",
  );
  assert.equal(
    JSON.parse(
      s.one("SELECT before_json FROM audit WHERE entity_id='pause'")
        .before_json,
    ).ended_at,
    null,
  );
  assert.throws(() =>
    correctExit(s, "old", "2026-09-01T12:20:00Z", "Confirmed exit", "hr"),
  );
  correctExit(s, "old", "2026-09-01T14:00:00Z", "Confirmed exit", "hr");
});

test("historical gaps remain insertable after newer provider events", () => {
  const s = setup();
  recordManualVisit(
    s,
    input("2026-09-01T08:00:00Z", "2026-09-01T10:00:00Z"),
    "hr",
  );
  applyAction(s, {
    id: "recent",
    phone: "5491100000011",
    action: "entry",
    siteId: "b",
    lat: 1,
    lon: 1,
    time: "2026-09-01T16:00:00Z",
    source: "whatsapp",
  });
  recordManualVisit(
    s,
    input("2026-09-01T12:00:00Z", "2026-09-01T14:00:00Z"),
    "hr",
  );
  assert.equal(s.all("SELECT * FROM visits").length, 3);
  assert.equal(
    s.one("SELECT time FROM events WHERE id='recent'").time,
    "2026-09-01T16:00:00.000Z",
  );
});
test("unknown pause cannot be closed without bound, into future or across another pause", () => {
  const s = setup();
  s.db
    .prepare(
      "INSERT INTO visits VALUES('v','e','a','2026-09-01T10:00:00.000Z',NULL,'exit_unknown','demo')",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO breaks VALUES('p','v','2026-09-01T12:00:00.000Z',NULL,'end_unknown')",
    )
    .run();
  assert.throws(() =>
    correctUnknownBreak(
      s,
      "p",
      "2026-09-01T13:00:00Z",
      "Confirmed reason",
      "hr",
    ),
  );
  s.db
    .prepare(
      "UPDATE visits SET exit_at='2026-09-01T16:00:00.000Z',status='corrected'",
    )
    .run();
  assert.throws(() =>
    correctUnknownBreak(
      s,
      "p",
      "2026-09-01T13:00:00Z",
      "Confirmed reason",
      "hr",
      "2026-09-01T12:30:00Z",
    ),
  );
  s.db
    .prepare(
      "INSERT INTO breaks VALUES('p2','v','2026-09-01T13:00:00.000Z','2026-09-01T14:00:00.000Z','complete')",
    )
    .run();
  assert.throws(() =>
    correctUnknownBreak(
      s,
      "p",
      "2026-09-01T13:30:00Z",
      "Confirmed reason",
      "hr",
    ),
  );
  assert.equal(
    s.one("SELECT ended_at FROM breaks WHERE id='p'").ended_at,
    null,
  );
});
test("manual HTTP records authenticated HR actor and forbids supervisor even for assigned person", async () => {
  const { createApp } = await import("../server/app");
  const { upsertUser } = await import("../server/auth");
  process.env.ADMIN_PASSWORD = "Manual-admin-pass-123";
  const s = setup();
  const app = createApp(s);
  for (const role of ["hr", "supervisor"])
    upsertUser(
      s,
      {
        email: role + "@example.test",
        name: role === "hr" ? "HR operator" : "Supervisor",
        password: "Manual-role-pass-123",
        role,
        active: true,
        employee_ids: ["e"],
      },
      "bootstrap",
    );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  const login = async (role: string) => {
    const response = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: role + "@example.test",
        password: "Manual-role-pass-123",
      }),
    });
    return response.headers.get("set-cookie")!;
  };
  try {
    const hr = await login("hr");
    const response = await fetch(url + "/api/attendance/manual", {
      method: "POST",
      headers: { cookie: hr, "Content-Type": "application/json" },
      body: JSON.stringify({ ...input(), actor: "spoof@example.test" }),
    });
    assert.equal(response.status, 200);
    const { id } = await response.json();
    assert.equal(
      s.one("SELECT actor FROM audit WHERE entity_id=?", id).actor,
      "hr@example.test",
    );
    assert.equal(s.all("SELECT * FROM events").length, 0);
    const supervisor = await login("supervisor");
    for (const path of ["attendance/manual", "hr/break/pause/correct"]) {
      const denied = await fetch(url + "/api/" + path, {
        method: "POST",
        headers: { cookie: supervisor, "Content-Type": "application/json" },
        body: JSON.stringify(
          input("2026-09-02T12:00:00Z", "2026-09-02T14:00:00Z"),
        ),
      });
      assert.equal(denied.status, 403);
    }
  } finally {
    server.close();
  }
});
