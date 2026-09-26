import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { linkCodeFromText } from "./telegramUpdate";

export const storedEvent = v.object({
  updateId: v.number(),
  messageId: v.number(),
  userId: v.string(),
  chatId: v.string(),
  timestamp: v.number(),
  kind: v.union(v.literal("text"), v.literal("location")),
  text: v.optional(v.string()),
  codeHash: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

export const receiveTelegram = internalMutation({
  args: { event: storedEvent },
  handler: async (ctx, { event }) => {
    if (event.codeHash && event.text !== undefined)
      throw new Error("Code text must be removed before insertion");
    if (
      event.text &&
      (linkCodeFromText(event.text) || /^\s*\/start\b/i.test(event.text))
    )
      throw new Error("Code text must be hashed before insertion");
    if (
      await ctx.db
        .query("telegramInbox")
        .withIndex("update", (q) => q.eq("updateId", event.updateId))
        .first()
    )
      return null;
    const link = await ctx.db
      .query("telegramLinks")
      .withIndex("user", (q) => q.eq("userId", event.userId))
      .first();
    const id = await ctx.db.insert("telegramInbox", {
      ...event,
      receivedAt: Date.now(),
      status: "pending",
      ...(link ? { linkIdAtReceipt: link._id } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.telegramMessages.processTelegram, {
      id,
    });
    return id;
  },
});
