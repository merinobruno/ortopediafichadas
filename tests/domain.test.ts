import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { applyAction, correctExit } from "../server/domain";
const setup = () => {
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('a','A','A',-34.6,-58.4,150),('b','B','B',-34.61,-58.41,150)",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO employees(id,name,phone,role,site_ids) VALUES('e','Employee','5491100000001','Staff','[\"a\",\"b\"]')",
    )
    .run();
  return s;
};
const input = (
  id: string,
  action = "entry",
  site = "a",
  time = "2026-09-09T12:00:00Z",
) => ({
  id,
  phone: "5491100000001",
  action,
  siteId: site,
  lat: site === "a" ? -34.6 : -34.61,
  lon: site === "a" ? -58.4 : -58.41,
  time,
  source: "simulator",
});
test("supports repeated visits and returning to the first site", () => {
  const s = setup();
  for (const [i, a, site] of [
    [0, "entry", "a"],
    [1, "exit", "a"],
    [2, "entry", "b"],
    [3, "exit", "b"],
    [4, "entry", "a"],
  ] as const)
    applyAction(s, input(String(i), a, site, `2026-09-09T${12 + i}:00:00Z`));
  assert.equal(s.all("SELECT * FROM visits").length, 3);
  assert.equal(s.all("SELECT * FROM visits WHERE status='open'").length, 1);
});
test("new site atomically creates unknown exit and alert without invented time", () => {
  const s = setup();
  applyAction(s, input("1"));
  applyAction(s, input("2", "entry", "b", "2026-09-09T13:00:00Z"));
  const old = s.one("SELECT * FROM visits WHERE site_id=?", "a");
  assert.equal(old.status, "exit_unknown");
  assert.equal(old.exit_at, null);
  assert.equal(s.all("SELECT * FROM alerts").length, 1);
});
test("duplicate delivery never repeats effects", () => {
  const s = setup();
  const first = applyAction(s, input("1"));
  assert.deepEqual(applyAction(s, input("1")), first);
  assert.equal(s.all("SELECT * FROM visits").length, 1);
});
test("invalid and unauthorized location leave current visit intact", () => {
  const s = setup();
  applyAction(s, input("1"));
  assert.throws(() => applyAction(s, { ...input("2", "entry", "b"), lat: 0 }));
  s.db.prepare("UPDATE employees SET site_ids='[\"a\"]'").run();
  assert.throws(() => applyAction(s, input("3", "entry", "b")));
  assert.equal(s.one("SELECT * FROM visits").status, "open");
});
test("same-site duplicate and wrong-site departure cannot mutate attendance", () => {
  const s = setup();
  applyAction(s, input("1"));
  assert.throws(() => applyAction(s, input("2")));
  assert.throws(() => applyAction(s, input("3", "exit", "b")));
  assert.equal(s.all("SELECT * FROM visits").length, 1);
});
test("unknown phone and delayed events rejected", () => {
  const s = setup();
  assert.throws(() => applyAction(s, { ...input("1"), phone: "999" }));
  applyAction(s, input("2"));
  assert.throws(() =>
    applyAction(s, input("3", "exit", "a", "2026-09-09T11:00:00Z")),
  );
});
test("correction requires reason, preserves original and audits actor", () => {
  const s = setup();
  applyAction(s, input("1"));
  applyAction(s, input("2", "entry", "b", "2026-09-09T13:00:00Z"));
  const v = s.one("SELECT * FROM visits WHERE status='exit_unknown'");
  assert.throws(() => correctExit(s, v.id, "2026-09-09T12:30:00Z", "", "hr"));
  correctExit(s, v.id, "2026-09-09T12:30:00Z", "Confirmed by supervisor", "hr");
  assert.equal(
    s.one("SELECT * FROM visits WHERE id=?", v.id).status,
    "corrected",
  );
  assert.equal(s.one("SELECT * FROM audit").actor, "hr");
  assert.equal(
    JSON.parse(s.one("SELECT * FROM audit").before_json).exit_at,
    null,
  );
});
