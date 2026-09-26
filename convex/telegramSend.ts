import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const claimTelegramSend = internalMutation({
  args: { id: v.id("telegramOutbox"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    const row = await ctx.db.get(id);
    if (
      !row ||
      row.status !== "pending" ||
      (row.nextAttemptAt && Date.now() < row.nextAttemptAt)
    )
      return null;
    const link = await ctx.db.get(row.linkId);
    const employee = await ctx.db.get(row.employeeId);
    if (
      !link ||
      !employee?.active ||
      link.employeeId !== row.employeeId ||
      link.chatId !== row.chatId
    ) {
      await ctx.db.patch(id, {
        status: "revoked",
        reasonCode: "link_inactive",
      });
      return null;
    }
    if (!enabled) {
      await ctx.db.patch(id, {
        status: "disabled",
        reasonCode: "sending_disabled",
      });
      return null;
    }
    await ctx.db.patch(id, {
      status: "sending",
      attempts: row.attempts + 1,
      nextAttemptAt: undefined,
    });
    return row;
  },
});

export const finishTelegramSend = internalMutation({
  args: {
    id: v.id("telegramOutbox"),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("review"),
      v.literal("retry"),
    ),
    providerMessageId: v.optional(v.number()),
    reasonCode: v.optional(v.string()),
    retryDelayMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { id, status, providerMessageId, reasonCode, retryDelayMs },
  ) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "sending") return;
    if (status === "retry") {
      if (row.attempts >= 5) {
        await ctx.db.patch(id, {
          status: "failed",
          reasonCode: "rate_limited_exhausted",
        });
      } else {
        const delay = Math.max(
          1000 * 2 ** (row.attempts - 1),
          retryDelayMs ?? 0,
        );
        await ctx.db.patch(id, {
          status: "pending",
          reasonCode: "rate_limited",
          nextAttemptAt: Date.now() + delay,
        });
        await ctx.scheduler.runAfter(
          delay,
          internal.telegramSend.sendTelegram,
          { id },
        );
      }
      return;
    }
    await ctx.db.patch(id, {
      status,
      ...(providerMessageId !== undefined ? { providerMessageId } : {}),
      reasonCode,
    });
  },
});

export const sendTelegram = internalAction({
  args: { id: v.id("telegramOutbox") },
  handler: async (ctx, { id }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const enabled = process.env.TELEGRAM_SEND_ENABLED === "true" && !!token;
    const row = await ctx.runMutation(internal.telegramSend.claimTelegramSend, {
      id,
      enabled,
    });
    if (!row || !token) return;
    let status: "sent" | "failed" | "review" | "retry" = "review";
    let reasonCode = "uncertain_send";
    let providerMessageId: number | undefined;
    let retryDelayMs: number | undefined;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: row.chatId,
            text: row.text,
            ...(row.webAppUrl
              ? {
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "Fichar", web_app: { url: row.webAppUrl } }],
                    ],
                  },
                }
              : {}),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const body: unknown = await response.json();
      const result =
        body && typeof body === "object" ? (body as Record<string, any>) : null;
      if (
        response.ok &&
        result?.ok === true &&
        Number.isSafeInteger(result.result?.message_id)
      ) {
        status = "sent";
        reasonCode = "confirmed";
        providerMessageId = result.result.message_id;
      } else if (response.status === 429 && result?.ok === false) {
        const retryAfter = result.parameters?.retry_after;
        if (
          retryAfter === undefined ||
          (Number.isSafeInteger(retryAfter) &&
            retryAfter >= 1 &&
            retryAfter <= 3600)
        ) {
          status = "retry";
          reasonCode = "rate_limited";
          retryDelayMs =
            retryAfter === undefined ? undefined : retryAfter * 1000;
        } else {
          status = "review";
          reasonCode = "rate_limit_manual_review";
        }
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        result?.ok === false
      ) {
        status = "failed";
        reasonCode = "provider_rejected";
      } else {
        reasonCode =
          response.status >= 500
            ? "provider_uncertain"
            : "malformed_provider_response";
      }
    } catch {
      // A request may have reached Telegram before a timeout or broken response.
      status = "review";
      reasonCode = "network_uncertain";
    }
    await ctx.runMutation(internal.telegramSend.finishTelegramSend, {
      id,
      status,
      reasonCode,
      providerMessageId,
      retryDelayMs,
    });
  },
});
