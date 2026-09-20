export const reportingDay = (value: string) =>
  new Date(value).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
export function filterVisits<
  T extends {
    entry_at: string;
    employee_id: string;
    site_id: string;
    status: string;
  },
>(rows: T[], filters: Record<string, string>, name: (id: string) => string) {
  return rows.filter(
    (v) =>
      (!filters.from || reportingDay(v.entry_at) >= filters.from) &&
      (!filters.to || reportingDay(v.entry_at) <= filters.to) &&
      (!filters.employee || v.employee_id === filters.employee) &&
      (!filters.site || v.site_id === filters.site) &&
      (!filters.status || v.status === filters.status) &&
      (!filters.search ||
        name(v.employee_id)
          .toLowerCase()
          .includes(filters.search.toLowerCase())),
  );
}
export function workedHours(
  visit: { id: string; entry_at: string; exit_at?: string | null },
  breaks: { visit_id: string; started_at: string; ended_at?: string | null }[],
): number | null {
  if (!visit.exit_at) return null;
  const own = breaks.filter((b) => b.visit_id === visit.id);
  if (own.some((b) => !b.ended_at)) return null;
  const pauseMs = own.reduce(
    (n, b) => n + Date.parse(b.ended_at!) - Date.parse(b.started_at),
    0,
  );
  return Math.max(
    0,
    (Date.parse(visit.exit_at) - Date.parse(visit.entry_at) - pauseMs) /
      3600000,
  );
}

export type ReportVisit = {
  id: string;
  employee_id: string;
  site_id: string;
  entry_at: string;
  exit_at: string | null;
  status: string;
};
export type ReportBreak = {
  visit_id: string;
  started_at: string;
  ended_at: string | null;
};
export type ReportMetrics = {
  visits: number;
  entryDays: number;
  measurableVisits: number;
  netHours: number;
  openVisits: number;
  unknownExits: number;
  unknownPauses: number;
};
export function summarizeVisits(visits: ReportVisit[], breaks: ReportBreak[]) {
  const aggregate = (set: ReportVisit[]): ReportMetrics => {
    let netHours = 0,
      measurableVisits = 0,
      openVisits = 0,
      unknownExits = 0,
      unknownPauses = 0;
    for (const visit of set) {
      if (visit.status === "open") {
        openVisits++;
        continue;
      }
      if (visit.status === "exit_unknown" || !visit.exit_at) {
        unknownExits++;
        continue;
      }
      const hours = ["complete", "corrected"].includes(visit.status)
        ? workedHours(visit, breaks)
        : null;
      if (hours === null) {
        unknownPauses++;
        continue;
      }
      netHours += hours;
      measurableVisits++;
    }
    return {
      visits: set.length,
      entryDays: new Set(set.map((v) => reportingDay(v.entry_at))).size,
      measurableVisits,
      netHours,
      openVisits,
      unknownExits,
      unknownPauses,
    };
  };
  const group = (key: "employee_id" | "site_id") =>
    [...new Set(visits.map((v) => v[key]))].map((id) => ({
      id,
      ...aggregate(visits.filter((v) => v[key] === id)),
    }));
  return {
    overall: aggregate(visits),
    byEmployee: group("employee_id"),
    bySite: group("site_id"),
  };
}
