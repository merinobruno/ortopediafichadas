/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { sha256 } from "./telegramLinks";
import { createHmac } from "node:crypto";
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

it("serves phone check-in without an admin cookie only for signed linked Telegram users", async () => {
  vi.stubEnv("PROXY_SECRET", "trusted");
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  const t = convexTest(schema, modules);
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  await t.run((ctx) =>
    ctx.db.insert("telegramLinks", {
      employeeId,
      userId: "8",
      chatId: "8",
      createdAt: Date.now(),
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("sites", {
      name: "Central",
      latitude: -34.6,
      longitude: -58.4,
      radius: 100,
      active: true,
    }),
  );
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: 8, first_name: "Ana" });
  const check = `auth_date=${authDate}\nuser=${user}`;
  const secret = createHmac("sha256", "WebAppData")
    .update("test-token")
    .digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const initData = `auth_date=${authDate}&user=${encodeURIComponent(user)}&hash=${hash}`;
  const headers = {
    "x-proxy-secret": "trusted",
    origin: "https://attendance.example",
  };
  const request = (path: string, body: object, requestHeaders = headers) =>
    t.fetch(path, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  expect(
    (
      await request(
        "/api/phone/challenge",
        { initData, kind: "entrada" },
        { ...headers, origin: "https://evil.example" },
      )
    ).status,
  ).toBe(403);
  const invalid = await request("/api/phone/challenge", {
    initData: initData.replace("Ana", "Eve"),
    kind: "entrada",
  });
  expect(invalid.status).toBe(401);
  expect(await invalid.json()).toEqual({ error: "telegram_auth_invalid" });
  const oldDate = authDate - 301;
  const oldCheck = `auth_date=${oldDate}\nuser=${user}`;
  const oldHash = createHmac("sha256", secret).update(oldCheck).digest("hex");
  const expired = await request("/api/phone/challenge", {
    initData: `auth_date=${oldDate}&user=${encodeURIComponent(user)}&hash=${oldHash}`,
    kind: "entrada",
  });
  expect(expired.status).toBe(401);
  expect(await expired.json()).toEqual({ error: "telegram_auth_expired" });
  const issued = await request("/api/phone/challenge", {
    initData,
    kind: "entrada",
  });
  expect(issued.status).toBe(200);
  const challenge = (await issued.json()).challenge;
  const submitted = await request("/api/phone/submit", {
    initData,
    challenge,
    latitude: -34.6,
    longitude: -58.4,
    accuracy: 12,
  });
  expect(submitted.status).toBe(200);
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(1);
});
