import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  issueLinkCode,
  consumeLinkCode,
  hashLinkCode,
  revokeLink,
} from "../server/telegram-links";
import { sendTelegramOutbox } from "../server/telegram";

const env = {
  TELEGRAM_BOT_TOKEN: "synthetic-token",
  TELEGRAM_WEBHOOK_SECRET: "synthetic-secret",
  TELEGRAM_SEND_ENABLED: "true",
};
function fixture() {
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO employees(id,name,role,site_ids,active) VALUES('e','Ana','Staff','[]',1)",
    )
    .run();
  const code = issueLinkCode(s, "e", "hr");
  consumeLinkCode(s, hashLinkCode(code.code), "8", "8");
  const generation = s.one(
    "SELECT generation FROM telegram_links WHERE employee_id='e'",
  ).generation;
  s.db
    .prepare(
      "INSERT INTO telegram_outbox(id,employee_id,link_generation,chat_id,text,status,created_at) VALUES('reply','e',?,'8','private reply','queued',?)",
    )
    .run(generation, new Date(0).toISOString());
  return s;
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("disabled sender makes no network call", async () => {
  const s = fixture();
  try {
    await sendTelegramOutbox(
      s,
      (() => {
        throw new Error("unexpected fetch");
      }) as typeof fetch,
      { ...env, TELEGRAM_SEND_ENABLED: "false" },
    );
    assert.equal(s.one("SELECT status FROM telegram_outbox").status, "queued");
  } finally {
    s.db.close();
  }
});

test("proved Telegram acceptance records provider message ID once", async () => {
  const s = fixture();
  try {
    let calls = 0;
    await sendTelegramOutbox(
      s,
      (async (_url, init) => {
        calls++;
        assert.deepEqual(JSON.parse(String(init?.body)), {
          chat_id: "8",
          text: "private reply",
        });
        return reply(200, { ok: true, result: { message_id: 22 } });
      }) as typeof fetch,
      env,
    );
    await sendTelegramOutbox(
      s,
      (() => {
        throw new Error("repeat");
      }) as typeof fetch,
      env,
    );
    assert.equal(calls, 1);
    assert.equal(
      s.one("SELECT status,provider_id FROM telegram_outbox").status,
      "accepted",
    );
    assert.equal(
      s.one("SELECT provider_id FROM telegram_outbox").provider_id,
      22,
    );
  } finally {
    s.db.close();
  }
});

test("explicit 429 honors retry_after before another attempt", async () => {
  const s = fixture();
  try {
    const now = Date.now();
    let calls = 0;
    await sendTelegramOutbox(
      s,
      (async () => {
        calls++;
        return reply(429, { ok: false, parameters: { retry_after: 30 } });
      }) as typeof fetch,
      env,
      () => now,
    );
    assert.equal(s.one("SELECT status FROM telegram_outbox").status, "queued");
    assert.ok(
      Date.parse(
        s.one("SELECT next_attempt_at FROM telegram_outbox").next_attempt_at,
      ) >=
        now + 30000,
    );
    await sendTelegramOutbox(
      s,
      (() => {
        calls++;
        throw new Error("early");
      }) as typeof fetch,
      env,
      () => now + 1000,
    );
    assert.equal(calls, 1);
  } finally {
    s.db.close();
  }
});

test("uncertain HTTP 5xx and malformed success never resend automatically", async () => {
  for (const response of [
    reply(500, { ok: false }),
    reply(200, { ok: true }),
  ]) {
    const s = fixture();
    try {
      await sendTelegramOutbox(s, (async () => response) as typeof fetch, env);
      assert.equal(
        s.one("SELECT status FROM telegram_outbox").status,
        "uncertain",
      );
      await sendTelegramOutbox(
        s,
        (() => {
          throw new Error("repeat");
        }) as typeof fetch,
        env,
      );
      assert.equal(
        s.one("SELECT status FROM telegram_outbox").status,
        "uncertain",
      );
    } finally {
      s.db.close();
    }
  }
});

test("revoke then relink to same chat cannot send old queued reply", async () => {
  const s = fixture();
  try {
    revokeLink(s, "e", "hr");
    const code = issueLinkCode(s, "e", "hr");
    consumeLinkCode(s, hashLinkCode(code.code), "8", "8");
    await sendTelegramOutbox(
      s,
      (() => {
        throw new Error("revoked reply sent");
      }) as typeof fetch,
      env,
    );
    assert.equal(s.one("SELECT status FROM telegram_outbox").status, "revoked");
  } finally {
    s.db.close();
  }
});
