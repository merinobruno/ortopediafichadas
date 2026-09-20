import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
export const send = internalAction({
  args: { id: v.id("outbox") },
  handler: async (ctx, { id }) => {
    const enabled =
      process.env.WHATSAPP_SEND_ENABLED === "true" &&
      !!process.env.WHATSAPP_ACCESS_TOKEN &&
      !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
      !!process.env.WHATSAPP_GRAPH_VERSION;
    const row = await ctx.runMutation(internal.messages.claimSend, {
      id,
      enabled,
    });
    if (!row) return;
    try {
      const response = await fetch(
        `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: row.phone,
            type: "text",
            text: { body: row.text },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const body = await response.json();
      await ctx.runMutation(internal.messages.finishSend, {
        id,
        status: response.ok && body.messages?.[0]?.id ? "sent" : "review",
        ...(body.messages?.[0]?.id
          ? { providerId: String(body.messages[0].id) }
          : {}),
      });
    } catch {
      await ctx.runMutation(internal.messages.finishSend, {
        id,
        status: "review",
      });
    }
  },
});
