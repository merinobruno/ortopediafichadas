/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const update = {
  update_id: 41,
  message: {
    message_id: 7,
    date: 1790000000,
    from: { id: 8 },
    chat: { id: 8, type: "private" },
    text: "entrada",
  },
};
it("verifies the secret before writing and durably deduplicates accepted updates", async () => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  expect(
    (
      await t.fetch("/webhook/telegram", {
        method: "POST",
        body: JSON.stringify(update),
      })
    ).status,
  ).toBe(401);
  const post = () =>
    t.fetch("/webhook/telegram", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
      body: JSON.stringify(update),
    });
  expect((await post()).status).toBe(200);
  expect((await post()).status).toBe(200);
  expect(
    await t.run((ctx) => ctx.db.query("telegramInbox").collect()),
  ).toHaveLength(1);
  vi.unstubAllEnvs();
});
