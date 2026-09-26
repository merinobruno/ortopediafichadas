/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
async function prepared() {
  const t = convexTest(schema, modules);
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  const linkId = await t.run((ctx) =>
    ctx.db.insert("telegramLinks", {
      employeeId,
      userId: "8",
      chatId: "8",
      createdAt: Date.now(),
    }),
  );
  const id = await t.run((ctx) =>
    ctx.db.insert("telegramOutbox", {
      employeeId,
      linkId,
      chatId: "8",
      text: "Confirmado",
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    }),
  );
  return { t, id, linkId };
}
it("records a confirmed Telegram provider message id", async () => {
  const { t, id } = await prepared();
  vi.stubEnv("TELEGRAM_SEND_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true, result: { message_id: 23 } })),
  );
  await t.action(internal.telegramSend.sendTelegram, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    status: "sent",
    providerMessageId: 23,
  });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("keeps malformed success and network uncertainty for review without a second send", async () => {
  const { t, id } = await prepared();
  vi.stubEnv("TELEGRAM_SEND_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  const send = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", send);
  await t.action(internal.telegramSend.sendTelegram, { id });
  await t.action(internal.telegramSend.sendTelegram, { id });
  expect(send).toHaveBeenCalledTimes(1);
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("review");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("blocks replies from a revoked binding, even after relinking the same chat", async () => {
  const { t, id, linkId } = await prepared();
  await t.run(async (ctx) => {
    const old = await ctx.db.get(linkId);
    await ctx.db.delete(linkId);
    await ctx.db.insert("telegramLinks", {
      employeeId: old!.employeeId,
      userId: "8",
      chatId: "8",
      createdAt: Date.now(),
    });
  });
  expect(
    await t.mutation(internal.telegramSend.claimTelegramSend, {
      id,
      enabled: true,
    }),
  ).toBeNull();
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("revoked");
});
it("waits at least Telegram's retry_after after an explicit unsent 429", async () => {
  const { t, id } = await prepared();
  vi.stubEnv("TELEGRAM_SEND_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { ok: false, parameters: { retry_after: 30 } },
        { status: 429 },
      ),
    ),
  );
  const before = Date.now();
  await t.action(internal.telegramSend.sendTelegram, { id });
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.status).toBe("pending");
  expect(row?.nextAttemptAt).toBeGreaterThanOrEqual(before + 30000);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each([
  [503, { ok: false }, "review"],
  [400, { ok: false }, "failed"],
] as const)(
  "classifies HTTP %i without an unsafe retry",
  async (status, body, expected) => {
    const { t, id } = await prepared();
    vi.stubEnv("TELEGRAM_SEND_ENABLED", "true");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status })),
    );
    await t.action(internal.telegramSend.sendTelegram, { id });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe(expected);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  },
);

it("does not resend a persisted sending row", async () => {
  const { t, id } = await prepared();
  await t.run((ctx) => ctx.db.patch(id, { status: "sending", attempts: 1 }));
  expect(
    await t.mutation(internal.telegramSend.claimTelegramSend, {
      id,
      enabled: true,
    }),
  ).toBeNull();
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("sending");
});
