import { Store } from "./store";
import { reportingDay } from "../shared/reporting";
export function nextDay(day: string) {
  return new Date(Date.parse(day + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function enqueueExceptionWork(
  s: Store,
  employee: string | null,
  from: string,
  to: string,
  today = reportingDay(new Date().toISOString()),
  reset = true,
) {
  const earliest = s.one(
    "SELECT MIN(day) day FROM (SELECT start_day day FROM exception_periods UNION ALL SELECT day FROM attendance_exceptions)",
  )?.day;
  if (!earliest) return;
  from = from < earliest ? earliest : from;
  to = to > today ? today : to;
  if (from > to) return;
  const id = (employee || "*") + "|" + from + "|" + to;
  s.db
    .prepare(
      `INSERT INTO exception_jobs(id,employee_id,day,date_to,employee_cursor,created_at) VALUES(?,?,?,?,'',?) ON CONFLICT(id) DO ${reset ? "UPDATE SET day=excluded.day,employee_cursor=''" : "NOTHING"}`,
    )
    .run(id, employee, from, to, new Date().toISOString());
}
