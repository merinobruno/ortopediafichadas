/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const site = "https://amicable-bat-774.convex.site";
const endpoint = `${site}/webhook/telegram`;
const expectedUsername = "OrtopediaFichadas_bot";

function configure() {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "private-test-token");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "private_test-secret");
  vi.stubEnv("CONVEX_SITE_URL", site);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("refuses a mismatched bot before changing its webhook", async () => {
  configure();
  const fetchMock = vi.fn(async (_url: string) =>
    Response.json({
      ok: true,
      result: { is_bot: true, username: "Other_bot" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);

  const result = await t.action(internal.telegramSetup.registerWebhook, {
    expectedUsername,
  });

  expect(result).toEqual({ ok: false, code: "identity_mismatch" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toContain("/getMe");
});

it("registers only the deployment endpoint and confirms Telegram status", async () => {
  configure();
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/getMe"))
      return Response.json({
        ok: true,
        result: { is_bot: true, username: "ortopediafichadas_bot" },
      });
    if (url.endsWith("/setWebhook")) {
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toEqual({
        url: endpoint,
        secret_token: "private_test-secret",
        allowed_updates: ["message"],
        drop_pending_updates: false,
      });
      return Response.json({ ok: true, result: true });
    }
    return Response.json({
      ok: true,
      result: {
        url: endpoint,
        allowed_updates: ["message"],
        pending_update_count: 2,
        last_error_message: "private provider detail",
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);

  const result = await t.action(internal.telegramSetup.registerWebhook, {
    expectedUsername,
  });

  expect(result).toEqual({
    ok: true,
    code: "registered",
    webhookMatches: true,
    pendingUpdateCount: 2,
  });
  expect(
    fetchMock.mock.calls.map(([url]) => String(url).split("/").at(-1)),
  ).toEqual(["getMe", "setWebhook", "getWebhookInfo"]);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(JSON.stringify(result)).not.toContain(site);
});

it("redacts failures and reads back an ambiguous registration without retrying", async () => {
  configure();
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/getMe"))
      return Response.json({
        ok: true,
        result: { is_bot: true, username: expectedUsername },
      });
    if (url.endsWith("/setWebhook"))
      throw new Error(
        `token private-test-token secret private_test-secret ${site}`,
      );
    return Response.json({
      ok: true,
      result: { url: endpoint, allowed_updates: ["message"] },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);

  const result = await t.action(internal.telegramSetup.registerWebhook, {
    expectedUsername,
  });

  expect(result).toEqual({
    ok: false,
    code: "registration_unconfirmed",
    webhookMatches: true,
  });
  expect(fetchMock.mock.calls).toHaveLength(3);
  expect(JSON.stringify(result)).not.toMatch(/private|amicable|convex\.site/);
});

it("reports a read-only webhook mismatch without exposing its URL", async () => {
  configure();
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/getMe")
      ? Response.json({
          ok: true,
          result: { is_bot: true, username: expectedUsername },
        })
      : Response.json({
          ok: true,
          result: {
            url: "https://private-other.convex.site/webhook/telegram",
            allowed_updates: ["message"],
            pending_update_count: 1,
          },
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);

  const result = await t.action(internal.telegramSetup.webhookStatus, {
    expectedUsername,
  });

  expect(result).toEqual({
    ok: true,
    code: "status",
    webhookMatches: false,
    pendingUpdateCount: 1,
  });
  expect(fetchMock.mock.calls).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("private-other");
});

it("rejects unsafe deployment URLs and secrets before network access", async () => {
  configure();
  vi.stubEnv(
    "CONVEX_SITE_URL",
    "https://amicable-bat-774.convex.site.evil.test",
  );
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);
  expect(
    await t.action(internal.telegramSetup.webhookStatus, { expectedUsername }),
  ).toEqual({ ok: false, code: "invalid_site_url" });
  vi.stubEnv("CONVEX_SITE_URL", site);
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "bad secret");
  expect(
    await t.action(internal.telegramSetup.registerWebhook, {
      expectedUsername,
    }),
  ).toEqual({ ok: false, code: "invalid_webhook_secret" });
  expect(fetchMock).not.toHaveBeenCalled();
});
