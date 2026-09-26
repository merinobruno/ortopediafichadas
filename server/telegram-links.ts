import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Store } from "./store";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const hashLinkCode = (code: string) =>
  createHash("sha256").update(code.toUpperCase()).digest("hex");

export function issueLinkCode(
  s: Store,
  employeeId: string,
  actor: string,
  now = Date.now(),
) {
  const code = Array.from(randomBytes(10), (b) => alphabet[b & 31]).join("");
  const expiresAt = new Date(now + 900000).toISOString();
  s.tx(() => {
    const employee = s.one(
      "SELECT id,active FROM employees WHERE id=?",
      employeeId,
    );
    if (!employee?.active) throw new Error("Elegí un empleado activo.");
    if (s.one("SELECT 1 FROM telegram_links WHERE employee_id=?", employeeId))
      throw new Error("El empleado ya está vinculado.");
    s.db
      .prepare("DELETE FROM telegram_codes WHERE employee_id=?")
      .run(employeeId);
    s.db
      .prepare("INSERT INTO telegram_codes VALUES(?,?,?,?,?)")
      .run(
        employeeId,
        hashLinkCode(code),
        expiresAt,
        actor,
        new Date(now).toISOString(),
      );
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        employeeId,
        actor,
        "Telegram code issued",
        "null",
        JSON.stringify({ employee_id: employeeId, expires_at: expiresAt }),
        new Date(now).toISOString(),
      );
  });
  return { code, expiresAt };
}

function failAttempt(s: Store, userId: string, now: number) {
  const row = s.one(
    "SELECT * FROM telegram_link_attempts WHERE user_id=?",
    userId,
  );
  if (!row)
    s.db
      .prepare("INSERT INTO telegram_link_attempts VALUES(?,?,1)")
      .run(userId, new Date(now).toISOString());
  else if (now - Date.parse(row.window_start) >= 900000)
    s.db
      .prepare(
        "UPDATE telegram_link_attempts SET window_start=?,count=1 WHERE user_id=?",
      )
      .run(new Date(now).toISOString(), userId);
  else
    s.db
      .prepare(
        "UPDATE telegram_link_attempts SET count=count+1 WHERE user_id=?",
      )
      .run(userId);
}

export function consumeLinkCode(
  s: Store,
  codeHash: string,
  userId: string,
  chatId: string,
  now = Date.now(),
): { employeeId: string; generation: string } | null {
  if (
    !/^\d+$/.test(userId) ||
    userId !== chatId ||
    !/^[a-f0-9]{64}$/.test(codeHash)
  )
    return null;
  return s.tx(() => {
    const attempts = s.one(
      "SELECT * FROM telegram_link_attempts WHERE user_id=?",
      userId,
    );
    if (
      attempts &&
      now - Date.parse(attempts.window_start) < 900000 &&
      attempts.count >= 5
    )
      return null;
    const code = s.one("SELECT * FROM telegram_codes WHERE digest=?", codeHash);
    const employee =
      code &&
      s.one(
        "SELECT id,active,name FROM employees WHERE id=?",
        code.employee_id,
      );
    const existingUser = s.one(
      "SELECT 1 FROM telegram_links WHERE user_id=?",
      userId,
    );
    const existingEmployee =
      code &&
      s.one(
        "SELECT 1 FROM telegram_links WHERE employee_id=?",
        code.employee_id,
      );
    const matches =
      code &&
      timingSafeEqual(
        Buffer.from(code.digest, "hex"),
        Buffer.from(codeHash, "hex"),
      );
    if (
      !matches ||
      Date.parse(code.expires_at) <= now ||
      !employee?.active ||
      existingUser ||
      existingEmployee
    ) {
      failAttempt(s, userId, now);
      return null;
    }
    const generation = randomUUID();
    s.db
      .prepare("DELETE FROM telegram_codes WHERE employee_id=?")
      .run(code.employee_id);
    s.db
      .prepare("INSERT INTO telegram_links VALUES(?,?,?,?,?)")
      .run(
        code.employee_id,
        userId,
        chatId,
        generation,
        new Date(now).toISOString(),
      );
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        code.employee_id,
        "telegram",
        "Telegram linked",
        "null",
        JSON.stringify({ employee_id: code.employee_id, generation }),
        new Date(now).toISOString(),
      );
    return { employeeId: code.employee_id as string, generation };
  });
}

export function revokeLink(
  s: Store,
  employeeId: string,
  actor: string,
  now = Date.now(),
) {
  s.tx(() => {
    if (!s.one("SELECT 1 FROM employees WHERE id=?", employeeId))
      throw new Error("Empleado inexistente.");
    s.db
      .prepare("DELETE FROM telegram_links WHERE employee_id=?")
      .run(employeeId);
    s.db
      .prepare("DELETE FROM telegram_codes WHERE employee_id=?")
      .run(employeeId);
    s.db
      .prepare("DELETE FROM bot_pending WHERE key=?")
      .run("telegram:" + employeeId);
    s.db
      .prepare(
        "UPDATE telegram_outbox SET status='revoked',reason_code='link_revoked' WHERE employee_id=? AND status='queued'",
      )
      .run(employeeId);
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        employeeId,
        actor,
        "Telegram revoked",
        "null",
        JSON.stringify({ employee_id: employeeId }),
        new Date(now).toISOString(),
      );
  });
}

export function linkedEmployee(
  s: Store,
  userId: string,
): { id: string; chat_id: string; generation: string } | null {
  return (
    s.one(
      "SELECT e.id,l.chat_id,l.generation FROM telegram_links l JOIN employees e ON e.id=l.employee_id WHERE l.user_id=? AND e.active=1",
      userId,
    ) || null
  );
}
