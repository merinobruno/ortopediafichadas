/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { sha256 } from "./telegramLinks";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());
const update = {
  update_id: 41,
  message: {
    message_id: 7,
    date: Math.floor(Date.now() / 1000),
    from: { id: 8 },
    chat: { id: 8, type: "private" },
    text: "entrada",
  },
};
const post = (
  t: ReturnType<typeof convexTest>,
  payload: unknown,
  secret = "test-secret",
) =>
  t.fetch("/webhook/telegram", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify(payload),
  });

it("rejects missing/wrong secret, oversized and malformed updates before durable insertion", async () => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  expect(
    (await t.fetch("/webhook/telegram", { method: "POST", body: "{}" })).status,
  ).toBe(401);
  expect((await post(t, update, "wrong")).status).toBe(401);
  expect(
    (await post(t, { update_id: "bad", message: update.message })).status,
  ).toBe(400);
  expect(
    (
      await t.fetch("/webhook/telegram", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
        body: "x".repeat(1000001),
      })
    ).status,
  ).toBe(413);
  expect(
    await t.run((ctx) => ctx.db.query("telegramInbox").collect()),
  ).toHaveLength(0);
});

it("accepts only original private messages and hashes code before durable insertion", async () => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  expect(
    (
      await post(t, {
        ...update,
        message: { ...update.message, chat: { id: -8, type: "group" } },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post(t, {
        ...update,
        message: { ...update.message, forward_origin: {} },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post(t, {
        ...update,
        edited_message: update.message,
        message: undefined,
      })
    ).status,
  ).toBe(200);
  expect(
    await t.run((ctx) => ctx.db.query("telegramInbox").collect()),
  ).toHaveLength(0);
  const code = "ABCDEFG234";
  expect(
    (
      await post(t, {
        ...update,
        message: { ...update.message, text: "/start " + code },
      })
    ).status,
  ).toBe(200);
  const row = await t.run((ctx) => ctx.db.query("telegramInbox").first());
  expect(row?.codeHash).toBe(await sha256(code));
  expect(row?.text).toBeUndefined();
  expect(JSON.stringify(row)).not.toContain(code);
});

it("requires trusted proxy, origin and a session for HR link routes", async () => {
  vi.stubEnv("PROXY_SECRET", "trusted");
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  const t = convexTest(schema, modules);
  expect((await t.fetch("/api/data")).status).toBe(403);
  expect(
    (
      await t.fetch("/api/employees/link-code", {
        method: "POST",
        headers: {
          "x-proxy-secret": "trusted",
          origin: "https://evil.example",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await t.fetch("/api/employees/revoke-link", {
        method: "POST",
        headers: {
          "x-proxy-secret": "trusted",
          origin: "https://attendance.example",
        },
        body: "{}",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await t.fetch("/api/telegram-operations", {
        headers: { "x-proxy-secret": "trusted" },
      })
    ).status,
  ).toBe(401);
});

it("keeps secure cookie login and authenticated reads", async () => {
  vi.stubEnv("PROXY_SECRET", "trusted");
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  const t = convexTest(schema, modules);
  await t.action(internal.auth.bootstrapAdmin, {
    email: "admin@example.com",
    password: "private-test-password-123",
  });
  const login = await t.fetch("/api/login", {
    method: "POST",
    headers: {
      "x-proxy-secret": "trusted",
      origin: "https://attendance.example",
    },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "private-test-password-123",
    }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Strict");
  const data = await t.fetch("/api/data", {
    headers: { "x-proxy-secret": "trusted", cookie },
  });
  expect(data.status).toBe(200);
  expect(JSON.stringify(await data.json())).not.toContain("passwordHash");
});
