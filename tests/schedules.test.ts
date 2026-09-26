import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  createSchedule,
  calendar,
  migrateLegacySchedules,
} from "../server/schedules";
function setup() {
  const s = new Store(":memory:");
  s.db
    .prepare("INSERT INTO employees VALUES('e','Employee','Staff','[]',1)")
    .run();
  s.db
    .prepare(
      "INSERT INTO shifts VALUES('morning','Morning','08:00','16:00',10),('night','Night','22:00','06:00',10)",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('site','Site','Address',0,0,100)",
    )
    .run();
  return s;
}
const input = (slots: (string | null)[] = Array(7).fill("morning")) => ({
  employee_id: "e",
  date_from: "2026-09-01",
  date_to: "2026-10-31",
  anchor: "2026-09-01",
  cycle: slots.length,
  slots,
  reason: "Initial schedule",
});
test("7 and 14 day cycles wrap and effective boundaries are inclusive", () => {
  for (const length of [7, 14]) {
    const s = setup();
    createSchedule(
      s,
      input(["morning", ...Array(length - 1).fill(null)]),
      "hr",
    );
    const rows = calendar(
      s,
      ["e"],
      "2026-09-01",
      "2026-10-31",
      "2026-12-01T12:00:00Z",
    );
    assert.equal(rows[0].status, "absent");
    assert.equal(rows[1].status, "rest");
    assert.equal(rows[length].status, "absent");
    assert.equal(
      calendar(s, ["e"], "2026-08-31", "2026-08-31")[0].status,
      "unscheduled",
    );
    assert.notEqual(rows.at(-1)?.status, "unscheduled");
  }
});
test("overlaps and invalid dates are rejected, snapshots survive catalog edits", () => {
  const s = setup();
  createSchedule(s, input(), "hr");
  assert.throws(() =>
    createSchedule(s, { ...input(), date_from: "2026-10-31" }, "hr"),
  );
  assert.throws(() =>
    createSchedule(s, { ...input(), date_from: "2026-02-30" }, "hr"),
  );
  s.db.prepare("UPDATE shifts SET start='09:00' WHERE id='morning'").run();
  assert.equal(
    calendar(s, ["e"], "2026-09-01", "2026-09-01")[0].start,
    "08:00",
  );
});
test("first site entry at tolerance is on time, later entry is late, no absence before end", () => {
  const s = setup();
  createSchedule(s, input(), "hr");
  s.db
    .prepare(
      "INSERT INTO visits VALUES('v','e','site','2026-09-01T11:10:00.000Z',NULL,'open','demo')",
    )
    .run();
  assert.equal(
    calendar(s, ["e"], "2026-09-01", "2026-09-01", "2026-09-01T20:00:00Z")[0]
      .status,
    "on_time",
  );
  s.db.prepare("UPDATE visits SET entry_at='2026-09-01T11:10:01.000Z'").run();
  assert.equal(
    calendar(s, ["e"], "2026-09-01", "2026-09-01", "2026-09-01T20:00:00Z")[0]
      .status,
    "late",
  );
  assert.equal(
    calendar(s, ["e"], "2026-09-02", "2026-09-02", "2026-09-02T18:59:00Z")[0]
      .status,
    "awaiting",
  );
  assert.equal(
    calendar(s, ["e"], "2026-09-02", "2026-09-02", "2026-09-02T19:00:01Z")[0]
      .status,
    "absent",
  );
});
test("holiday approved leave and future suppress exceptions; overnight needs review", () => {
  const s = setup();
  createSchedule(s, input(), "hr");
  s.db.prepare("INSERT INTO holidays VALUES('2026-09-01','Holiday')").run();
  s.db
    .prepare(
      "INSERT INTO leaves VALUES('l','e','Vacation','2026-09-02','2026-09-02','Reason','approved')",
    )
    .run();
  const rows = calendar(
    s,
    ["e"],
    "2026-09-01",
    "2026-09-03",
    "2026-09-02T22:00:00Z",
  );
  assert.deepEqual(
    rows.map((r) => r.status),
    ["holiday", "leave", "upcoming"],
  );
  const s2 = setup();
  createSchedule(s2, input(Array(7).fill("night")), "hr");
  assert.equal(
    calendar(s2, ["e"], "2026-09-01", "2026-09-01", "2026-09-02T22:00:00Z")[0]
      .status,
    "review_required",
  );
});
test("legacy migration starts today and cannot backfill history", () => {
  const s = setup();
  s.db.prepare("INSERT INTO shift_assignments VALUES('e','morning')").run();
  migrateLegacySchedules(s, "2026-09-15");
  migrateLegacySchedules(s, "2026-09-16");
  assert.equal(s.all("SELECT * FROM schedules").length, 1);
  assert.equal(
    calendar(s, ["e"], "2026-09-14", "2026-09-14")[0].status,
    "unscheduled",
  );
  assert.equal(
    calendar(s, ["e"], "2026-09-15", "2026-09-15")[0].status,
    "unscheduled",
  );
  assert.equal(s.one("SELECT status FROM schedules").status, "draft");
});

test("calendar validates real civil dates and ending current schedules preserves earlier days", async () => {
  const { cancelSchedule } = await import("../server/schedules");
  const s = setup();
  const id = createSchedule(s, input(), "hr");
  assert.throws(() => calendar(s, ["e"], "2026-02-30", "2026-03-01"));
  cancelSchedule(s, id, "New rotation starts", "hr", "2026-09-15");
  assert.notEqual(
    calendar(s, ["e"], "2026-09-14", "2026-09-14")[0].status,
    "unscheduled",
  );
  assert.equal(
    calendar(s, ["e"], "2026-09-15", "2026-09-15")[0].status,
    "unscheduled",
  );
  createSchedule(s, { ...input(), date_from: "2026-09-15" }, "hr");
  assert.equal(s.all("SELECT * FROM schedules").length, 2);
});

test("observed arrivals remain visible on unscheduled rest holiday and leave days", () => {
  for (const kind of ["unscheduled", "rest", "holiday", "leave"]) {
    const s = setup();
    if (kind !== "unscheduled")
      createSchedule(
        s,
        input(kind === "rest" ? Array(7).fill(null) : undefined),
        "hr",
      );
    if (kind === "holiday")
      s.db.prepare("INSERT INTO holidays VALUES('2026-09-01','Holiday')").run();
    if (kind === "leave")
      s.db
        .prepare(
          "INSERT INTO leaves VALUES('l','e','Vacation','2026-09-01','2026-09-01','Reason','approved')",
        )
        .run();
    s.db
      .prepare(
        "INSERT INTO visits VALUES('v','e','site','2026-09-01T12:00:00.000Z',NULL,'open','demo')",
      )
      .run();
    const row = calendar(
      s,
      ["e"],
      "2026-09-01",
      "2026-09-01",
      "2026-09-01T18:00:00Z",
    )[0];
    assert.equal(row.status, kind);
    assert.equal(row.first_entry, "2026-09-01T12:00:00.000Z");
  }
});
