import { DomainRejection } from "./domain-rejection";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { applyAction, distance } from "./domain";
import { recordBreak } from "./hr";
import { createLeaveRequest } from "./leaves";
export const BOT_HELP =
  "Enviá entrada o salida y luego compartí tu ubicación actual. Para registrar pausas: pausa / finpausa. Para pedir una licencia: solicitar licencia DD/MM/YYYY DD/MM/YYYY | Tipo | Motivo (al menos 5 caracteres). La solicitud queda pendiente de RRHH. Enviá cancelar para descartar sólo una fichada pendiente, o ayuda para ver estas instrucciones.";
type Source = "telegram" | "simulator";
export type BotMessage = {
  id: string;
  employeeId: string;
  timestamp: number;
  kind: "text" | "location";
  text?: string;
  latitude?: number;
  longitude?: number;
};
export type BotContent =
  | { kind: "text"; text: string }
  | { kind: "location"; latitude: number; longitude: number };
export function receiveEmployeeMessage(
  s: Store,
  m: BotMessage,
  source: Source,
  now = Date.now(),
  actor?: string,
  receivedAt = new Date(now).toISOString(),
) {
  return s.tx(() => {
    const employee = s.one(
      "SELECT * FROM employees WHERE id=? AND active=1",
      m.employeeId,
    );
    if (!employee)
      throw new DomainRejection(
        "Empleado no registrado o inactivo. Contactá a RRHH.",
      );
    const eventMs = m.timestamp;
    if (
      !Number.isFinite(eventMs) ||
      eventMs > now ||
      now - eventMs > 15 * 60000
    )
      throw new DomainRejection(
        "Mensaje fuera de tiempo. Contactá a RRHH para revisar el horario.",
      );
    const existing = s.one(
      "SELECT * FROM employee_bot_results WHERE id=?",
      m.id,
    );
    if (existing) {
      if (existing.employee_id !== employee.id || existing.source !== source)
        throw new DomainRejection("Identidad de mensaje inválida.");
      return existing.reply as string;
    }
    const time = new Date(eventMs).toISOString(),
      text = String(m.text || "").trim(),
      word = text.toLowerCase(),
      pendingKey = source + ":" + employee.id;
    if (source === "telegram")
      s.db.prepare("DELETE FROM bot_pending WHERE key=?").run(pendingKey);
    if (
      source === "telegram" &&
      (m.kind === "location" ||
        [
          "entrada",
          "salida",
          "presente",
          "fichar",
          "ayuda",
          "/fichar",
          "/ayuda",
        ].includes(word))
    ) {
      const reply =
        m.kind === "location"
          ? "La ubicación enviada por chat no registra asistencia. Consultá a RRHH para fichar desde tu teléfono."
          : "La fichada por chat está deshabilitada. Consultá a RRHH para fichar desde tu teléfono.";
      s.db
        .prepare(
          "INSERT INTO employee_bot_results VALUES(?,?,?,?,?,?,'processed',?)",
        )
        .run(
          m.id,
          employee.id,
          time,
          source,
          m.kind === "text" ? text : "[location]",
          reply,
          receivedAt,
        );
      return reply;
    }
    const saved = s.one("SELECT * FROM bot_pending WHERE key=?", pendingKey),
      pending =
        saved &&
        Date.parse(saved.expires_at) >= eventMs &&
        eventMs >= Date.parse(saved.expires_at) - 300000
          ? saved
          : null;
    const location =
      m.kind === "location"
        ? { latitude: m.latitude, longitude: m.longitude, eventTime: time }
        : pending?.location_json
          ? JSON.parse(pending.location_json)
          : null;
    const authorized: string[] = JSON.parse(employee.site_ids);
    const matches = location
      ? s
          .all("SELECT * FROM sites WHERE active=1")
          .filter(
            (x) =>
              authorized.includes(x.id) &&
              distance(location.latitude, location.longitude, x.lat, x.lon) <=
                x.radius,
          )
      : [];
    const exact =
      m.kind === "text" && pending?.location_json
        ? matches.find((x) => x.name.toLowerCase() === word || x.id === word)
        : null;
    const complete = (siteId?: string) => {
      const result = applyAction(s, {
        id: m.id,
        employeeId: employee.id,
        action: pending.action,
        siteId,
        lat: location.latitude,
        lon: location.longitude,
        time: location.eventTime,
        source,
      });
      s.db.prepare("DELETE FROM bot_pending WHERE key=?").run(pendingKey);
      return result.message;
    };
    let reply =
      source === "telegram"
        ? "La fichada por chat está deshabilitada. Consultá a RRHH para fichar desde tu teléfono. Para pausas, enviá pausa o finpausa. Para licencias, enviá solicitar licencia DD/MM/YYYY DD/MM/YYYY | Tipo | Motivo."
        : BOT_HELP;
    if (exact) reply = complete(exact.id);
    else if (m.kind === "text" && word === "ayuda") reply = BOT_HELP;
    else if (m.kind === "text" && word === "cancelar") {
      s.db.prepare("DELETE FROM bot_pending WHERE key=?").run(pendingKey);
      reply =
        "Se descartó la intención de fichada pendiente. No se modificaron visitas, pausas ni licencias.";
    } else if (
      m.kind === "text" &&
      (word === "pausa" ||
        word === "finpausa" ||
        word.startsWith("solicitar licencia"))
    ) {
      if (pending)
        throw new DomainRejection(
          "Primero completá la fichada pendiente con tu ubicación o elegí la sede. Enviá cancelar para descartarla.",
        );
      if (word === "pausa" || word === "finpausa") {
        const result = recordBreak(
          s,
          employee.id,
          word === "pausa" ? "start" : "end",
          time,
          now,
        );
        s.db.prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)").run(
          randomUUID(),
          result.break_id,
          actor || "employee:" + employee.id,
          "Employee bot pause",
          "null",
          JSON.stringify({
            employee_id: employee.id,
            source,
            message_id: m.id,
            action: word,
            time,
            break_id: result.break_id,
          }),
          new Date(now).toISOString(),
        );
        reply =
          word === "pausa"
            ? "Inicio de pausa registrado. Enviá finpausa cuando retomes."
            : "Fin de pausa registrado.";
      } else {
        const parts =
          /^solicitar licencia (\d{2})\/(\d{2})\/(\d{4}) (\d{2})\/(\d{2})\/(\d{4})\s*\|\s*([^|]+)\s*\|\s*([^|]+)$/i.exec(
            text,
          );
        if (!parts)
          throw new DomainRejection(
            "Usá: solicitar licencia DD/MM/YYYY DD/MM/YYYY | Tipo | Motivo.",
          );
        createLeaveRequest(
          s,
          {
            employee_id: employee.id,
            date_from: `${parts[3]}-${parts[2]}-${parts[1]}`,
            date_to: `${parts[6]}-${parts[5]}-${parts[4]}`,
            type: parts[7].trim(),
            reason: parts[8].trim(),
          },
          actor || "employee:" + employee.id,
          source,
          m.id,
        );
        reply =
          "Solicitud de licencia registrada como pendiente. RRHH debe revisarla; todavía no está aprobada.";
      }
    } else if (
      m.kind === "location" ||
      (m.kind === "text" && pending?.location_json)
    ) {
      if (!pending)
        throw new DomainRejection(
          "Primero enviá entrada o salida y luego compartí tu ubicación.",
        );
      if (matches.length > 1 && !exact) {
        s.db
          .prepare("UPDATE bot_pending SET location_json=? WHERE key=?")
          .run(JSON.stringify(location), pendingKey);
        reply =
          "Hay varias sedes en esta ubicación. Respondé con el nombre exacto: " +
          matches.map((x) => x.name).join(", ") +
          ".";
      } else if (m.kind === "text")
        reply = "Elegí el nombre exacto de la sede o enviá cancelar.";
      else reply = complete(matches[0]?.id);
    } else if (
      m.kind === "text" &&
      ["presente", "entrada", "salida"].includes(word)
    ) {
      s.db
        .prepare(
          "INSERT INTO bot_pending(key,employee_id,action,expires_at,location_json) VALUES(?,?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET action=excluded.action,expires_at=excluded.expires_at,location_json=NULL",
        )
        .run(
          pendingKey,
          employee.id,
          word === "salida" ? "exit" : "entry",
          new Date(eventMs + 5 * 60000).toISOString(),
        );
      reply =
        "Compartí tu ubicación actual para confirmar la fichada. Tenés 5 minutos.";
    }
    s.db
      .prepare(
        "INSERT INTO employee_bot_results VALUES(?,?,?,?,?,?,'processed',?)",
      )
      .run(
        m.id,
        employee.id,
        time,
        source,
        m.kind === "text" ? text : "[location]",
        reply,
        receivedAt,
      );
    return reply;
  });
}
export function simulateEmployeeText(
  s: Store,
  employeeId: string,
  text: string,
  actor: string,
  now = Date.now(),
) {
  return simulateEmployeeMessage(
    s,
    employeeId,
    { kind: "text", text },
    actor,
    now,
  );
}

export function simulateEmployeeMessage(
  s: Store,
  employeeId: string,
  content: BotContent,
  actor: string,
  now = Date.now(),
) {
  const employee = s.one(
    "SELECT id FROM employees WHERE id=? AND active=1",
    employeeId,
  );
  if (!employee) throw new DomainRejection("Elegí un empleado activo.");
  const id = "simulator:" + randomUUID();
  const text = content.kind === "text" ? content.text : "[Ubicación simulada]";
  return s.tx(() => {
    try {
      return {
        message: receiveEmployeeMessage(
          s,
          { ...content, id, employeeId, timestamp: now },
          "simulator",
          now,
          actor,
        ),
        source: "simulator",
      };
    } catch (error) {
      if ((error as any).code?.startsWith("ERR_SQLITE")) throw error;
      const reply = (error as Error).message;
      s.db
        .prepare(
          "INSERT INTO employee_bot_results VALUES(?,?,?,?,?,?,'rejected',?)",
        )
        .run(
          id,
          employeeId,
          new Date(now).toISOString(),
          "simulator",
          text,
          reply,
          new Date(now).toISOString(),
        );
      return { message: reply, source: "simulator" };
    }
  });
}
