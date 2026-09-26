import { DomainRejection } from "./domain-rejection";
import { enqueueExceptionWork } from "./exception-work";
import { reportingDay } from "../shared/reporting";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
export type Action = {
  id: string;
  employeeId: string;
  action: string;
  siteId?: string;
  lat: number;
  lon: number;
  time: string;
  source: string;
};
export const distance = (a: number, b: number, c: number, d: number) => {
  const rad = Math.PI / 180;
  const q =
    Math.sin(((c - a) * rad) / 2) ** 2 +
    Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
};
export function applyAction(s: Store, input: Action) {
  if (!Number.isFinite(Date.parse(input.time)))
    throw new DomainRejection("Fecha no válida.");
  input = { ...input, time: new Date(input.time).toISOString() };
  return s.tx(() => {
    const existing = s.one("SELECT result FROM events WHERE id=?", input.id);
    if (existing) return JSON.parse(existing.result);
    const employee = s.one(
      "SELECT * FROM employees WHERE id=? AND active=1",
      input.employeeId,
    );
    if (!employee)
      throw new DomainRejection(
        "Empleado no registrado o inactivo. Contactá a RRHH.",
      );
    if (!["entry", "exit"].includes(input.action))
      throw new DomainRejection("Indicá si querés registrar entrada o salida.");
    if (
      !Number.isFinite(input.lat) ||
      !Number.isFinite(input.lon) ||
      Math.abs(input.lat) > 90 ||
      Math.abs(input.lon) > 180
    )
      throw new DomainRejection(
        "La ubicación no es válida. Volvé a compartirla.",
      );
    if (!Number.isFinite(Date.parse(input.time)))
      throw new DomainRejection("Fecha no válida.");
    const authorized: string[] = JSON.parse(employee.site_ids);
    const matches = s
      .all("SELECT * FROM sites WHERE active=1")
      .filter(
        (site) =>
          authorized.includes(site.id) &&
          distance(input.lat, input.lon, site.lat, site.lon) <= site.radius,
      );
    const site = input.siteId
      ? matches.find((x) => x.id === input.siteId)
      : matches.length === 1
        ? matches[0]
        : undefined;
    if (!site)
      throw new DomainRejection(
        matches.length > 1
          ? "Hay varias sedes en esa ubicación. Seleccioná una sede."
          : "Ubicación fuera de una sede autorizada. Acercate a la sede y compartí tu ubicación.",
      );
    const latest = s.one(
      "SELECT time FROM events WHERE employee_id=? ORDER BY time DESC LIMIT 1",
      employee.id,
    );
    if (latest && input.time <= latest.time)
      throw new DomainRejection(
        "Mensaje anterior a la última fichada. RRHH debe revisar el horario.",
      );
    const completed = s.one(
      "SELECT MAX(exit_at) AS latest_exit FROM visits WHERE employee_id=? AND status IN ('complete','corrected')",
      employee.id,
    );
    if (
      completed?.latest_exit &&
      Date.parse(input.time) < Date.parse(completed.latest_exit)
    )
      throw new DomainRejection(
        "El mensaje es anterior a una salida confirmada. RRHH debe revisar el horario.",
      );
    const open = s.one(
      "SELECT * FROM visits WHERE employee_id=? AND status='open'",
      employee.id,
    );
    if (open && Date.parse(input.time) < Date.parse(open.entry_at))
      throw new DomainRejection(
        "El mensaje es anterior a la entrada abierta. RRHH debe revisar el horario.",
      );
    if (open) {
      const pause = s.one(
        "SELECT MAX(boundary) time FROM (SELECT started_at boundary FROM breaks WHERE visit_id=? UNION ALL SELECT ended_at boundary FROM breaks WHERE visit_id=? AND ended_at IS NOT NULL)",
        open.id,
        open.id,
      );
      if (pause?.time && Date.parse(input.time) < Date.parse(pause.time))
        throw new DomainRejection(
          "El mensaje es anterior a una pausa registrada. RRHH debe revisar el horario.",
        );
    }
    let visitId: string;
    if (input.action === "entry") {
      if (open?.site_id === site.id)
        throw new DomainRejection(
          "Ya tenés una entrada abierta en esta sede. Indicá salida para cerrarla.",
        );
      if (open) {
        s.db
          .prepare(
            "UPDATE breaks SET status='end_unknown' WHERE visit_id=? AND status='open'",
          )
          .run(open.id);
        s.db
          .prepare("UPDATE visits SET status='exit_unknown' WHERE id=?")
          .run(open.id);
        s.db
          .prepare("INSERT INTO alerts VALUES(?,?,?,?,?,NULL)")
          .run(randomUUID(), open.id, employee.id, "exit_unknown", input.time);
      }
      visitId = randomUUID();
      s.db
        .prepare("INSERT INTO visits VALUES(?,?,?,?,NULL,'open',?)")
        .run(visitId, employee.id, site.id, input.time, input.source);
    } else {
      if (!open)
        throw new DomainRejection(
          "No tenés una entrada abierta. Contactá a RRHH.",
        );
      if (open.site_id !== site.id)
        throw new DomainRejection(
          "La salida debe registrarse en la sede de tu entrada.",
        );
      if (
        s.one(
          "SELECT id FROM breaks WHERE visit_id=? AND status='open'",
          open.id,
        )
      )
        throw new DomainRejection(
          "Finalizá la pausa antes de registrar la salida.",
        );
      visitId = open.id;
      s.db
        .prepare("UPDATE visits SET status='complete',exit_at=? WHERE id=?")
        .run(input.time, open.id);
    }
    const result = {
      visitId,
      message: `${input.action === "entry" ? "Entrada" : "Salida"} registrada en ${site.name}, ${new Date(input.time).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })}.${open && input.action === "entry" ? " Dejamos una alerta para RRHH por la salida anterior desconocida." : ""}`,
      unknownExit: !!open && input.action === "entry",
    };
    s.db
      .prepare(
        "INSERT INTO events(id,employee_id,time,result,source,input_json,received_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        employee.id,
        input.time,
        JSON.stringify(result),
        input.source,
        JSON.stringify({
          action: input.action,
          siteId: site.id,
          lat: input.lat,
          lon: input.lon,
        }),
        new Date().toISOString(),
      );
    enqueueExceptionWork(
      s,
      employee.id,
      reportingDay(input.time),
      reportingDay(input.time),
    );
    return result;
  });
}
export function correctExit(
  s: Store,
  id: string,
  time: string,
  reason: string,
  actor: string,
) {
  if (!Number.isFinite(Date.parse(time)))
    throw new DomainRejection("Fecha no válida.");
  time = new Date(time).toISOString();
  return s.tx(() => {
    const before = s.one("SELECT * FROM visits WHERE id=?", id);
    if (!before || before.status !== "exit_unknown")
      throw new DomainRejection("Esta visita no tiene una salida pendiente.");
    if (reason.trim().length < 5 || !actor)
      throw new DomainRejection("Ingresá un motivo de al menos 5 caracteres.");
    const next = s.one(
      "SELECT entry_at FROM visits WHERE employee_id=? AND entry_at>? ORDER BY entry_at LIMIT 1",
      before.employee_id,
      before.entry_at,
    );
    if (
      !Number.isFinite(Date.parse(time)) ||
      time <= before.entry_at ||
      time > new Date().toISOString() ||
      (next && time > next.entry_at)
    )
      throw new DomainRejection(
        "La salida debe ser posterior a la entrada y anterior a la siguiente visita.",
      );
    if (
      s
        .all("SELECT * FROM breaks WHERE visit_id=?", id)
        .some(
          (b) =>
            Date.parse(time) < Date.parse(b.started_at) ||
            (b.ended_at && Date.parse(time) < Date.parse(b.ended_at)),
        )
    )
      throw new DomainRejection(
        "La salida no puede ser anterior al inicio o fin confirmado de una pausa.",
      );
    s.db
      .prepare("UPDATE visits SET exit_at=?,status='corrected' WHERE id=?")
      .run(time, id);
    s.db
      .prepare("UPDATE alerts SET resolved_at=? WHERE visit_id=?")
      .run(new Date().toISOString(), id);
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        id,
        actor,
        reason.trim(),
        JSON.stringify(before),
        JSON.stringify(s.one("SELECT * FROM visits WHERE id=?", id)),
        new Date().toISOString(),
      );
    return { ok: true };
  });
}
