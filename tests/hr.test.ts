import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  recordBreak,
  assignShift,
  requestOvertime,
  decideOvertime,
} from "../server/hr";
const setup = () => {
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('a','A','A',0,0,100)",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO employees(id,name,role,site_ids) VALUES('e','Ana','Staff','[\"a\"]')",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO visits VALUES('v','e','a','2026-09-09T12:00:00.000Z',NULL,'open','simulator')",
    )
    .run();
  return s;
};
test("pauses only belong to an open visit, cannot overlap and must finish after start", () => {
  const s = setup();
  recordBreak(s, "e", "start", "2026-09-09T13:00:00Z");
  assert.throws(() => recordBreak(s, "e", "start", "2026-09-09T13:01:00Z"));
  assert.throws(() => recordBreak(s, "e", "end", "2026-09-09T12:30:00Z"));
  recordBreak(s, "e", "end", "2026-09-09T13:15:00Z");
  assert.equal(
    s.one("SELECT * FROM breaks").ended_at,
    "2026-09-09T13:15:00.000Z",
  );
});
test("shift assignment requires real employee and shift", () => {
  const s = setup();
  assert.throws(() => assignShift(s, "e", "missing"));
  s.db
    .prepare("INSERT INTO shifts VALUES('s','Morning','08:00','16:00',10)")
    .run();
  assignShift(s, "e", "s");
  assert.equal(s.one("SELECT * FROM shift_assignments").shift_id, "s");
});
test("overtime request needs completed visit and decisions are once-only audited", () => {
  const s = setup();
  assert.throws(() => requestOvertime(s, "v", 30, "Extra work"));
  s.db
    .prepare(
      "UPDATE visits SET status='complete',exit_at='2026-09-09T21:00:00.000Z'",
    )
    .run();
  const id = requestOvertime(s, "v", 30, "Extra work");
  decideOvertime(s, id, "approved", "hr");
  assert.throws(() => decideOvertime(s, id, "rejected", "hr"));
  assert.equal(s.one("SELECT * FROM audit").actor, "hr");
});
