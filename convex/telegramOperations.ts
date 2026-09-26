import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { authorize } from "./data";

export const list = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    await authorize(ctx, hash);
    const inbound = await ctx.db.query("telegramInbox").order("desc").take(25);
    const outbound = await ctx.db
      .query("telegramOutbox")
      .order("desc")
      .take(25);
    return {
      inbound: inbound.map((row) => ({
        updateId: row.updateId,
        status: row.status,
        receivedAt: row.receivedAt,
        reasonCode: row.reasonCode,
      })),
      outbound: outbound.map((row) => ({
        status: row.status,
        attempts: row.attempts,
        createdAt: row.createdAt,
        reasonCode: row.reasonCode,
      })),
    };
  },
});
