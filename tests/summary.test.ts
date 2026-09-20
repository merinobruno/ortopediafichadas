import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeVisits } from "../shared/reporting";
const v = (
  id: string,
  employee_id = "e",
  site_id = "a",
  entry_at = "2026-09-10T01:00:00Z",
  exit_at: string | null = "2026-09-10T05:00:00Z",
  status = "complete",
) => ({ id, employee_id, site_id, entry_at, exit_at, status });
test("period groups preserve site returns and distinct BA entry dates, subtract each pause once", () => {
  const visits = [
    v("1"),
    v("2", "e", "b", "2026-09-10T06:00:00Z", "2026-09-10T08:00:00Z"),
    v("3", "e", "a", "2026-09-10T09:00:00Z", "2026-09-10T10:00:00Z"),
  ];
  const sum = summarizeVisits(visits, [
    {
      visit_id: "1",
      started_at: "2026-09-10T02:00:00Z",
      ended_at: "2026-09-10T02:30:00Z",
    },
  ]);
  assert.equal(sum.overall.visits, 3);
  assert.equal(sum.overall.entryDays, 2);
  assert.equal(sum.overall.netHours, 6.5);
  assert.equal(sum.byEmployee[0].entryDays, 2);
  assert.equal(sum.bySite.find((x) => x.id === "a")?.visits, 2);
  assert.equal(sum.bySite.find((x) => x.id === "a")?.netHours, 4.5);
});
test("unknown exits open visits and closed unknown pauses are separate exclusions", () => {
  const sum = summarizeVisits(
    [
      v("1", "e", "a", undefined, null, "open"),
      v("2", "e", "a", undefined, null, "exit_unknown"),
      v("3"),
      v("4"),
    ],
    [{ visit_id: "3", started_at: "2026-09-10T02:00:00Z", ended_at: null }],
  );
  assert.equal(sum.overall.openVisits, 1);
  assert.equal(sum.overall.unknownExits, 1);
  assert.equal(sum.overall.unknownPauses, 1);
  assert.equal(sum.overall.measurableVisits, 1);
  assert.equal(sum.overall.netHours, 4);
});
test("round only after summing, empty summary has zeroes", () => {
  const sum = summarizeVisits(
    Array.from({ length: 3 }, (_, i) =>
      v(String(i), "e", "a", "2026-09-10T12:00:00Z", "2026-09-10T12:01:00Z"),
    ),
    [],
  );
  assert.equal(sum.overall.netHours.toFixed(2), "0.05");
  const empty = summarizeVisits([], []);
  assert.equal(empty.overall.netHours, 0);
  assert.deepEqual(empty.byEmployee, []);
  assert.equal(empty.overall.entryDays, 0);
});
