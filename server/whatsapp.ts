import { Store } from "./store";
import { receiveEmployeeMessage } from "./employee-bot";
function queue(s: Store, m: any, text: string) {
  s.db
    .prepare(
      "INSERT OR IGNORE INTO outbox(id,phone,text,status,created_at,window_until) VALUES(?,?,?,'queued',?,?)",
    )
    .run(
      m.id,
      m.from,
      text,
      new Date().toISOString(),
      new Date(Number(m.timestamp) * 1000 + 24 * 3600000).toISOString(),
    );
}
export function processInbox(s: Store, clock: () => number = Date.now) {
  for (const item of s.all(
    "SELECT * FROM inbox WHERE status='pending' ORDER BY created_at,rowid LIMIT 100",
  )) {
    try {
      s.tx(() => {
        const m = JSON.parse(item.payload);
        let reply =
          "Enviá entrada o salida y luego compartí tu ubicación actual.";
        try {
          reply = receiveEmployeeMessage(
            s,
            m,
            "whatsapp",
            clock(),
            undefined,
            item.created_at,
          );
          s.db
            .prepare(
              "UPDATE inbox SET status='processed',error=NULL WHERE id=?",
            )
            .run(item.id);
        } catch (error) {
          if ((error as { code?: string }).code?.startsWith("ERR_SQLITE"))
            throw error;
          reply = (error as Error).message;
          s.db
            .prepare("UPDATE inbox SET status='rejected',error=? WHERE id=?")
            .run(reply, item.id);
        }
        queue(s, m, reply);
      });
    } catch {
      /* Persistence errors leave the whole message pending for a later worker tick. */
    }
  }
}
export async function sendOutbox(
  s: Store,
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  clock: () => number = Date.now,
  stopping: () => boolean = () => false,
) {
  if (
    env.WHATSAPP_SEND_ENABLED !== "true" ||
    !env.WHATSAPP_ACCESS_TOKEN ||
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION || "")
  )
    return;
  const now = new Date(clock()).toISOString();
  for (const row of s.all(
    "SELECT * FROM outbox WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at LIMIT 20",
    now,
  )) {
    if (stopping()) break;
    if (
      stopping() ||
      !row.window_until ||
      row.window_until <= new Date(clock()).toISOString()
    ) {
      s.db
        .prepare(
          "UPDATE outbox SET status='expired',error='24-hour reply window expired; human review required' WHERE id=?",
        )
        .run(row.id);
      continue;
    }
    s.db
      .prepare(
        "UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=?",
      )
      .run(row.id);
    try {
      const response = await fetcher(
        `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: row.phone,
            type: "text",
            text: { body: row.text },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const payload = (await response.json()) as any;
      if (response.ok && payload.messages?.[0]?.id) {
        s.db
          .prepare(
            "UPDATE outbox SET status='accepted',provider_id=?,error=NULL WHERE id=?",
          )
          .run(payload.messages[0].id, row.id);
      } else if (response.status === 429 || response.status >= 500) {
        s.db
          .prepare(
            "UPDATE outbox SET status=?,next_attempt_at=?,error=? WHERE id=?",
          )
          .run(
            row.attempts + 1 >= 5 ? "failed" : "queued",
            new Date(
              clock() + Math.min(3600000, 30000 * 2 ** row.attempts),
            ).toISOString(),
            `Provider HTTP ${response.status}`,
            row.id,
          );
      } else {
        s.db
          .prepare("UPDATE outbox SET status='failed',error=? WHERE id=?")
          .run(`Provider HTTP ${response.status}`, row.id);
      }
    } catch {
      s.db
        .prepare(
          "UPDATE outbox SET status='uncertain',error='Network outcome unknown; inspect provider before retrying' WHERE id=?",
        )
        .run(row.id);
    }
  }
}
