import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { receiveEmployeeMessage } from "./employee-bot";
import {
  consumeLinkCode,
  hashLinkCode,
  linkedEmployee,
} from "./telegram-links";
import { linkCodeFromText, type TelegramEvent } from "./telegram-update";
import { DomainRejection } from "./domain-rejection";

export function receiveTelegramUpdate(
  s: Store,
  event: TelegramEvent,
  receivedAt = Date.now(),
) {
  const code =
    event.kind === "text" ? linkCodeFromText(event.text ?? "") : null;
  const text =
    code || /^\s*\/start\b/i.test(event.text ?? "")
      ? null
      : (event.text ?? null);
  const link = linkedEmployee(s, event.userId);
  return (
    s.db
      .prepare(
        `INSERT OR IGNORE INTO telegram_inbox
    (update_id,message_id,user_id,chat_id,event_at,received_at,kind,text,code_hash,latitude,longitude,link_generation,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`,
      )
      .run(
        event.updateId,
        event.messageId,
        event.userId,
        event.chatId,
        event.timestamp,
        new Date(receivedAt).toISOString(),
        event.kind,
        text,
        code ? hashLinkCode(code) : null,
        event.latitude ?? null,
        event.longitude ?? null,
        link?.generation ?? null,
      ).changes === 1
  );
}

function queueReply(
  s: Store,
  row: any,
  employeeId: string,
  generation: string,
  text: string,
  now: number,
) {
  s.db
    .prepare(
      `INSERT INTO telegram_outbox
    (id,update_id,employee_id,link_generation,chat_id,text,status,created_at)
    VALUES(?,?,?,?,?,?,'queued',?)`,
    )
    .run(
      randomUUID(),
      row.update_id,
      employeeId,
      generation,
      row.chat_id,
      text,
      new Date(now).toISOString(),
    );
}

function processOne(s: Store, row: any, now: number) {
  if (row.code_hash) {
    if (row.link_generation) {
      s.db
        .prepare(
          "UPDATE telegram_inbox SET status='rejected',reason_code='already_linked_at_receipt' WHERE update_id=?",
        )
        .run(row.update_id);
      return;
    }
    const result = consumeLinkCode(
      s,
      row.code_hash,
      row.user_id,
      row.chat_id,
      now,
    );
    if (!result) {
      s.db
        .prepare(
          "UPDATE telegram_inbox SET status='rejected',reason_code='invalid_code' WHERE update_id=?",
        )
        .run(row.update_id);
      return;
    }
    const name = s.one(
      "SELECT name FROM employees WHERE id=?",
      result.employeeId,
    ).name;
    queueReply(
      s,
      row,
      result.employeeId,
      result.generation,
      `Telegram vinculado a ${name}. Enviá entrada o salida para fichar.`,
      now,
    );
    s.db
      .prepare("UPDATE telegram_inbox SET status='processed' WHERE update_id=?")
      .run(row.update_id);
    return;
  }
  const linked = linkedEmployee(s, row.user_id);
  if (
    !linked ||
    !row.link_generation ||
    linked.generation !== row.link_generation ||
    linked.chat_id !== row.chat_id
  ) {
    s.db
      .prepare(
        "UPDATE telegram_inbox SET status='rejected',reason_code='link_inactive' WHERE update_id=?",
      )
      .run(row.update_id);
    return;
  }
  const state = s.one(
    "SELECT * FROM telegram_sender_state WHERE user_id=?",
    row.user_id,
  );
  if (
    state &&
    (row.event_at < state.last_event_at ||
      (row.event_at === state.last_event_at &&
        row.update_id <= state.last_update_id))
  ) {
    s.db
      .prepare(
        "UPDATE telegram_inbox SET status='rejected',reason_code='reordered' WHERE update_id=?",
      )
      .run(row.update_id);
    return;
  }
  let reply: string;
  let status = "processed";
  let reason: string | null = null;
  try {
    reply = receiveEmployeeMessage(
      s,
      {
        id: "telegram:" + row.update_id,
        employeeId: linked.id,
        timestamp: row.event_at,
        kind: row.kind,
        ...(row.kind === "text"
          ? { text: row.text ?? "" }
          : { latitude: row.latitude, longitude: row.longitude }),
      },
      "telegram",
      now,
      "employee:" + linked.id,
      row.received_at,
    );
  } catch (error) {
    if (!(error instanceof DomainRejection)) throw error;
    reply = error.message;
    status = "rejected";
    reason = "domain_rejected";
    if (row.kind === "location")
      s.db
        .prepare("DELETE FROM bot_pending WHERE key=?")
        .run("telegram:" + linked.id);
    s.db
      .prepare(
        "INSERT INTO employee_bot_results VALUES(?,?,?,?,?,?,'rejected',?)",
      )
      .run(
        "telegram:" + row.update_id,
        linked.id,
        new Date(row.event_at).toISOString(),
        "telegram",
        row.kind === "text" ? (row.text ?? "") : "[location]",
        reply,
        row.received_at,
      );
  }
  s.db
    .prepare(
      "INSERT INTO telegram_sender_state VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_event_at=excluded.last_event_at,last_update_id=excluded.last_update_id",
    )
    .run(row.user_id, row.event_at, row.update_id);
  queueReply(s, row, linked.id, linked.generation, reply, now);
  s.db
    .prepare(
      "UPDATE telegram_inbox SET status=?,reason_code=? WHERE update_id=?",
    )
    .run(status, reason, row.update_id);
}

export function processTelegramInbox(s: Store, clock: () => number = Date.now) {
  const rows = s.all(
    "SELECT * FROM telegram_inbox WHERE status='pending' ORDER BY user_id,event_at,update_id,message_id LIMIT 100",
  );
  for (const userId of [...new Set(rows.map((row) => row.user_id as string))]) {
    s.tx(() => {
      for (const row of rows.filter(
        (candidate) => candidate.user_id === userId,
      ))
        processOne(s, row, clock());
    });
  }
}

export async function sendTelegramOutbox(
  s: Store,
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  clock: () => number = Date.now,
  stopping: () => boolean = () => false,
) {
  if (
    env.TELEGRAM_SEND_ENABLED !== "true" ||
    !env.TELEGRAM_BOT_TOKEN ||
    !env.TELEGRAM_WEBHOOK_SECRET ||
    stopping()
  )
    return;
  const rows = s.all(
    "SELECT * FROM telegram_outbox WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,id LIMIT 20",
    new Date(clock()).toISOString(),
  );
  for (const row of rows) {
    if (stopping()) return;
    const claimed = s.tx(() => {
      const current = s.one(
        "SELECT * FROM telegram_outbox WHERE id=? AND status='queued'",
        row.id,
      );
      if (!current) return false;
      const link = s.one(
        "SELECT l.generation,l.chat_id FROM telegram_links l JOIN employees e ON e.id=l.employee_id WHERE l.employee_id=? AND e.active=1",
        current.employee_id,
      );
      if (
        !link ||
        link.generation !== current.link_generation ||
        link.chat_id !== current.chat_id
      ) {
        s.db
          .prepare(
            "UPDATE telegram_outbox SET status='revoked',reason_code='link_inactive' WHERE id=?",
          )
          .run(row.id);
        return false;
      }
      s.db
        .prepare(
          "UPDATE telegram_outbox SET status='sending',attempts=attempts+1 WHERE id=?",
        )
        .run(row.id);
      return true;
    });
    if (!claimed) continue;
    try {
      const response = await fetcher(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: row.chat_id, text: row.text }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const body: any = await response.json();
      if (
        response.ok &&
        body?.ok === true &&
        Number.isSafeInteger(body.result?.message_id)
      ) {
        s.db
          .prepare(
            "UPDATE telegram_outbox SET status='accepted',provider_id=?,reason_code=NULL WHERE id=?",
          )
          .run(body.result.message_id, row.id);
      } else if (response.status === 429 && body?.ok === false) {
        const retryAfter = body.parameters?.retry_after;
        if (
          retryAfter !== undefined &&
          (!Number.isSafeInteger(retryAfter) ||
            retryAfter < 1 ||
            retryAfter > 3600)
        ) {
          s.db
            .prepare(
              "UPDATE telegram_outbox SET status='uncertain',reason_code='rate_limit_manual_review' WHERE id=?",
            )
            .run(row.id);
        } else if (row.attempts + 1 >= 5) {
          s.db
            .prepare(
              "UPDATE telegram_outbox SET status='failed',reason_code='rate_limited_exhausted' WHERE id=?",
            )
            .run(row.id);
        } else {
          const delay = Math.max(
            1000 * 2 ** row.attempts,
            (retryAfter ?? 0) * 1000,
          );
          s.db
            .prepare(
              "UPDATE telegram_outbox SET status='queued',next_attempt_at=?,reason_code='rate_limited' WHERE id=?",
            )
            .run(new Date(clock() + delay).toISOString(), row.id);
        }
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        body?.ok === false
      ) {
        s.db
          .prepare(
            "UPDATE telegram_outbox SET status='failed',reason_code='provider_rejected' WHERE id=?",
          )
          .run(row.id);
      } else {
        s.db
          .prepare(
            "UPDATE telegram_outbox SET status='uncertain',reason_code='provider_uncertain' WHERE id=?",
          )
          .run(row.id);
      }
    } catch {
      s.db
        .prepare(
          "UPDATE telegram_outbox SET status='uncertain',reason_code='network_uncertain' WHERE id=?",
        )
        .run(row.id);
    }
  }
}
