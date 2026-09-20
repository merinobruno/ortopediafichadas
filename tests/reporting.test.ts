import { test } from "node:test";
import assert from "node:assert/strict";
import { reportingDay, filterVisits } from "../shared/reporting";
test("report date uses Buenos Aires around UTC midnight and applies every visible filter", () => {
  assert.equal(reportingDay("2026-09-10T01:00:00Z"), "2026-09-09");
  const rows = [
    {
      entry_at: "2026-09-10T01:00:00Z",
      employee_id: "e",
      site_id: "a",
      status: "complete",
    },
  ];
  assert.equal(
    filterVisits(
      rows,
      {
        from: "2026-09-09",
        to: "2026-09-09",
        site: "a",
        status: "complete",
        search: "ana",
      },
      () => "Ana",
    ).length,
    1,
  );
  assert.equal(filterVisits(rows, { site: "b" }, () => "Ana").length, 0);
});

test("net hours exclude completed breaks and unknown pauses exclude the interval", async () => {
  const { workedHours } = await import("../shared/reporting");
  const visit = {
    id: "v",
    entry_at: "2026-09-09T12:00:00Z",
    exit_at: "2026-09-09T20:00:00Z",
  };
  assert.equal(
    workedHours(visit, [
      {
        visit_id: "v",
        started_at: "2026-09-09T13:00:00Z",
        ended_at: "2026-09-09T13:30:00Z",
      },
    ]),
    7.5,
  );
  assert.equal(
    workedHours(visit, [{ visit_id: "v", started_at: "2026-09-09T13:00:00Z" }]),
    null,
  );
});
