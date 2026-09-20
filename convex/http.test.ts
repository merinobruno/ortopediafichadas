/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
it("rejects unsigned Meta payloads before any durable data is written", async () => {
  vi.stubEnv("WHATSAPP_APP_SECRET", "test-secret");
  const t = convexTest(schema, modules);
  const res = await t.fetch("/webhook", { method: "POST", body: "{}" });
  expect(res.status).toBe(401);
  expect(await t.run((ctx) => ctx.db.query("inbox").collect())).toHaveLength(0);
});
it("stores signed configured-account messages and ignores other accounts", async () => {
  vi.useFakeTimers();
  vi.stubEnv("WHATSAPP_APP_SECRET", "test-secret");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "our-account");
  const t = convexTest(schema, modules);
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "our-account" },
              messages: [
                {
                  id: "meta-1",
                  from: "5491112345678",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "entrada" },
                },
              ],
            },
          },
          {
            value: {
              metadata: { phone_number_id: "other" },
              messages: [
                {
                  id: "foreign",
                  from: "5491112345678",
                  timestamp: "1",
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`;
  expect(
    (
      await t.fetch("/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body,
      })
    ).status,
  ).toBe(200);
  expect(await t.run((ctx) => ctx.db.query("inbox").collect())).toHaveLength(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
});
it("rejects direct browser API access without trusted proxy and origin", async () => {
  vi.stubEnv("PROXY_SECRET", "trusted-secret");
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  const t = convexTest(schema, modules);
  expect((await t.fetch("/api/data")).status).toBe(403);
  expect(
    (
      await t.fetch("/api/employees", {
        method: "POST",
        headers: {
          "x-proxy-secret": "trusted-secret",
          origin: "https://evil.example",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
});
it("issues an opaque secure cookie and allows cookie-authenticated reads only", async () => {
  vi.stubEnv("PROXY_SECRET", "secret");
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  const t = convexTest(schema, modules);
  const { internal } = await import("./_generated/api");
  await t.action(internal.auth.bootstrapAdmin, {
    email: "admin@example.com",
    password: "private-test-password-123",
  });
  const login = await t.fetch("/api/login", {
    method: "POST",
    headers: {
      "x-proxy-secret": "secret",
      origin: "https://attendance.example",
      "x-client-ip": "test",
    },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "private-test-password-123",
    }),
  });
  expect(login.status).toBe(200);
  expect(await login.json()).toEqual({ ok: true });
  const cookie = login.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).toContain("Max-Age=28800");
  const response = await t.fetch("/api/data", {
    headers: { "x-proxy-secret": "secret", cookie },
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ email: "admin@example.com", attendance: [] });
  expect(JSON.stringify(body)).not.toContain("passwordHash");
});
