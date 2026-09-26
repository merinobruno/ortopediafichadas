import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTelegramUpdate } from "../server/telegram-update";
import { Store } from "../server/store";
import { createApp } from "../server/app";

const update = {
  update_id: 1,
  message: {
    message_id: 2,
    date: Math.floor(Date.now() / 1000),
    from: { id: 8 },
    chat: { id: 8, type: "private" },
    text: "entrada",
  },
};
test("only original private Telegram messages normalize", () => {
  assert.equal(parseTelegramUpdate(update)?.userId, "8");
  assert.equal(
    parseTelegramUpdate({
      ...update,
      message: { ...update.message, chat: { id: -8, type: "group" } },
    }),
    null,
  );
  assert.equal(
    parseTelegramUpdate({
      ...update,
      message: { ...update.message, chat: { id: 9, type: "private" } },
    }),
    null,
  );
  assert.equal(
    parseTelegramUpdate({
      ...update,
      message: { ...update.message, forward_date: 1 },
    }),
    null,
  );
  assert.equal(
    parseTelegramUpdate({
      ...update,
      message: { ...update.message, contact: { phone_number: "secret" } },
    }),
    null,
  );
  assert.equal(
    parseTelegramUpdate({ ...update, edited_message: update.message }),
    null,
  );
  assert.throws(() =>
    parseTelegramUpdate({
      ...update,
      message: { ...update.message, message_id: "invalid" },
    }),
  );
  assert.throws(() =>
    parseTelegramUpdate({
      ...update,
      message: {
        ...update.message,
        text: undefined,
        location: { latitude: 91, longitude: 0 },
      },
    }),
  );
});
test("webhook secret precedes parsing and oversized body is rejected without writes", async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  const s = new Store(":memory:");
  const server = createApp(s).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/webhook/telegram`;
  try {
    const post = (body: string, secret?: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}),
        },
        body,
      });
    assert.equal((await post("{", "wrong")).status, 401);
    assert.equal((await post("{", "test-secret")).status, 400);
    assert.equal(
      (
        await post(
          JSON.stringify({
            ...update,
            message: { ...update.message, text: "x".repeat(1024 * 1024 + 1) },
          }),
          "test-secret",
        )
      ).status,
      413,
    );
    assert.equal(s.all("SELECT * FROM telegram_inbox").length, 0);
  } finally {
    server.close();
    s.db.close();
  }
});
