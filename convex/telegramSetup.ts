import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const allowedUpdates = ["message"];
const timeoutMs = 8000;

type SetupResult =
  | { ok: false; code: string; webhookMatches?: boolean }
  | {
      ok: true;
      code: "status" | "registered";
      webhookMatches: boolean;
      pendingUpdateCount?: number;
    };

function configuration(
  expectedUsername: string,
):
  | { ok: true; token: string; secret: string; endpoint: string }
  | { ok: false; code: string } {
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(expectedUsername))
    return { ok: false, code: "invalid_expected_username" };
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, code: "missing_bot_token" };
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret))
    return { ok: false, code: "invalid_webhook_secret" };

  let site: URL;
  try {
    site = new URL(process.env.CONVEX_SITE_URL ?? "");
  } catch {
    return { ok: false, code: "invalid_site_url" };
  }
  if (
    site.protocol !== "https:" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.convex\.site$/.test(site.hostname) ||
    site.username ||
    site.password ||
    site.port ||
    site.pathname !== "/" ||
    site.search ||
    site.hash
  )
    return { ok: false, code: "invalid_site_url" };

  return {
    ok: true,
    token,
    secret,
    endpoint: `${site.origin}/webhook/telegram`,
  };
}

async function telegramCall(
  token: string,
  method: "getMe" | "getWebhookInfo" | "setWebhook",
  body?: Record<string, unknown>,
): Promise<Record<string, any> | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        ...(body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return value && typeof value === "object"
      ? (value as Record<string, any>)
      : null;
  } catch {
    // Telegram may have applied setWebhook even if its reply did not arrive.
    return null;
  }
}

async function verifyIdentity(token: string, expectedUsername: string) {
  const answer = await telegramCall(token, "getMe");
  if (
    answer?.ok !== true ||
    !answer.result ||
    typeof answer.result !== "object"
  )
    return "identity_unavailable";
  return answer.result.is_bot === true &&
    typeof answer.result.username === "string" &&
    answer.result.username.toLowerCase() === expectedUsername.toLowerCase()
    ? null
    : "identity_mismatch";
}

async function readWebhook(token: string, endpoint: string) {
  const answer = await telegramCall(token, "getWebhookInfo");
  const info = answer?.result;
  if (answer?.ok !== true || !info || typeof info !== "object") return null;
  const webhookMatches =
    info.url === endpoint &&
    Array.isArray(info.allowed_updates) &&
    info.allowed_updates.length === allowedUpdates.length &&
    info.allowed_updates[0] === allowedUpdates[0];
  return {
    webhookMatches,
    ...(Number.isSafeInteger(info.pending_update_count) &&
    info.pending_update_count >= 0
      ? { pendingUpdateCount: info.pending_update_count as number }
      : {}),
  };
}

export const webhookStatus = internalAction({
  args: { expectedUsername: v.string() },
  handler: async (_ctx, { expectedUsername }): Promise<SetupResult> => {
    const config = configuration(expectedUsername);
    if (!config.ok) return config;
    const identityFailure = await verifyIdentity(
      config.token,
      expectedUsername,
    );
    if (identityFailure) return { ok: false, code: identityFailure };
    const status = await readWebhook(config.token, config.endpoint);
    if (!status) return { ok: false, code: "status_unavailable" };
    return { ok: true, code: "status", ...status };
  },
});

export const registerWebhook = internalAction({
  args: { expectedUsername: v.string() },
  handler: async (_ctx, { expectedUsername }): Promise<SetupResult> => {
    const config = configuration(expectedUsername);
    if (!config.ok) return config;
    const identityFailure = await verifyIdentity(
      config.token,
      expectedUsername,
    );
    if (identityFailure) return { ok: false, code: identityFailure };

    const registration = await telegramCall(config.token, "setWebhook", {
      url: config.endpoint,
      secret_token: config.secret,
      allowed_updates: allowedUpdates,
      drop_pending_updates: false,
    });
    const status = await readWebhook(config.token, config.endpoint);
    if (registration?.ok === true && registration.result === true) {
      if (!status) return { ok: false, code: "verification_unavailable" };
      if (!status.webhookMatches)
        return { ok: false, code: "verification_mismatch", ...status };
      return { ok: true, code: "registered", ...status };
    }
    // Readback can confirm the URL but cannot reveal Telegram's secret_token.
    return {
      ok: false,
      code: "registration_unconfirmed",
      ...(status ? { webhookMatches: status.webhookMatches } : {}),
    };
  },
});
