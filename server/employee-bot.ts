import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { applyAction, distance } from "./domain";
import { recordBreak } from "./hr";
import { createLeaveRequest } from "./leaves";
export const BOT_HELP =
  "Enviá entrada o salida y luego compartí tu ubicación actual. Para registrar pausas: pausa / finpausa. Para pedir una licencia: solicitar licencia DD/MM/YYYY DD/MM/YYYY | Tipo | Motivo (al menos 5 caracteres). La solicitud queda pendiente de RRHH. Enviá cancelar para descartar sólo una fichada pendiente, o ayuda para ver estas instrucciones.";
type Source = "whatsapp" | "simulator";
export function receiveEmployeeMessage(
  s: Store,
  m: any,
  source: Source,
  now = Date.now(),
  actor?: string,
  receivedAt = new Date(now).toISOString(),
) {
  return s.tx(() => {
    const employee = s.one(
      "SELECT * FROM employees WHERE phone=? AND active=1",
      m.from,
    );
    if (!employee) throw new Error("Número no registrado. Contactá a RRHH.");
    const eventMs = Number(m.timestamp) * 1000;
    if (
      !Number.isFinite(eventMs) ||
      eventMs > now ||
      now - eventMs > 15 * 60000
    )
      throw new Error(
        "Mensaje fuera de tiempo. Contactá a RRHH para revisar el horario.",
      );
    const existing = s.one(
      "SELECT * FROM employee_bot_results WHERE id=?",
      m.id,
    );
    if (existing) {
      if (existing.employee_id !== employee.id || existing.source !== source)
        throw new Error("Identidad de mensaje inválida.");
      return existing.reply as string;
    }
    const time = new Date(eventMs).toISOString(),
      text = String(m.text?.body || "").trim(),
      word = text.toLowerCase(),
      pendingKey = source === "simulator" ? "simulator:" + m.from : m.from;
    const saved = s.one("SELECT * FROM pending WHERE phone=?", pendingKey),
      pending = saved && Date.parse(saved.expires_at) >= now ? saved : null;
    const location =
      m.type === "location"
        ? { ...m.location, eventTime: time }
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
      m.type === "text" && pending?.location_json
        ? matches.find((x) => x.name.toLowerCase() === word || x.id === word)
        : null;
    const complete = (siteId?: string) => {
      const result = applyAction(s, {
        id: m.id,
        phone: m.from,
        action: pending.action,
        siteId,
        lat: location.latitude,
        lon: location.longitude,
        time: location.eventTime,
        source,
      });
      s.db.prepare("DELETE FROM pending WHERE phone=?").run(pendingKey);
      return result.message;
    };
    let reply = BOT_HELP;
    if (exact) reply = complete(exact.id);
    else if (m.type === "text" && word === "ayuda") reply = BOT_HELP;
    else if (m.type === "text" && word === "cancelar") {
      s.db.prepare("DELETE FROM pending WHERE phone=?").run(pendingKey);
      reply =
        "Se descartó la intención de fichada pendiente. No se modificaron visitas, pausas ni licencias.";
    } else if (
      m.type === "text" &&
      (word === "pausa" ||
        word === "finpausa" ||
        word.startsWith("solicitar licencia"))
    ) {
      if (pending)
        throw new Error(
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
          throw new Error(
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
      m.type === "location" ||
      (m.type === "text" && pending?.location_json)
    ) {
      if (!pending)
        throw new Error(
          "Primero enviá entrada o salida y luego compartí tu ubicación.",
        );
      if (matches.length > 1 && !exact) {
        s.db
          .prepare("UPDATE pending SET location_json=? WHERE phone=?")
          .run(JSON.stringify(location), pendingKey);
        reply =
          "Hay varias sedes en esta ubicación. Respondé con el nombre exacto: " +
          matches.map((x) => x.name).join(", ") +
          ".";
      } else if (m.type === "text")
        reply = "Elegí el nombre exacto de la sede o enviá cancelar.";
      else reply = complete(matches[0]?.id);
    } else if (
      m.type === "text" &&
      ["presente", "entrada", "salida"].includes(word)
    ) {
      s.db
        .prepare(
          "INSERT INTO pending(phone,action,expires_at,location_json) VALUES(?,?,?,NULL) ON CONFLICT(phone) DO UPDATE SET action=excluded.action,expires_at=excluded.expires_at,location_json=NULL",
        )
        .run(
          pendingKey,
          word === "salida" ? "exit" : "entry",
          new Date(now + 5 * 60000).toISOString(),
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
        m.type === "text" ? text : "[location]",
        reply,
        receivedAt,
      );
    return reply;
  });
}
export function simulateEmployeeText(
  s: Store,
  phone: string,
  text: string,
  actor: string,
  now = Date.now(),
) {
  return simulateEmployeeMessage(
    s,
    phone,
    { type: "text", text: { body: text } },
    actor,
    now,
  );
}
export function simulateEmployeeMessage(
  s: Store,
  phone: string,
  content: {
    type: string;
    text?: { body: string };
    location?: { latitude: number; longitude: number };
  },
  actor: string,
  now = Date.now(),
) {
  const text =
    content.type === "text" ? content.text?.body || "" : "[Ubicación simulada]";
  return s.tx(() => {
    const employee = s.one(
      "SELECT id FROM employees WHERE phone=? AND active=1",
      phone,
    );
    if (!employee) throw new Error("Elegí un empleado activo.");
    const id = "simulator:" + randomUUID();
    try {
      return {
        message: receiveEmployeeMessage(
          s,
          { ...content, id, from: phone, timestamp: String(now / 1000) },
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
          employee.id,
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
