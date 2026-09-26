import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Run privately, one bounded table batch per call. Attendance and IDs are untouched.
export const clearLegacyTransport = internalMutation({
  args: {
    limit: v.number(),
    phase: v.union(
      v.literal("inbox"),
      v.literal("outbox"),
      v.literal("employees"),
      v.literal("conversations"),
    ),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { limit, phase, cursor }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid batch limit");
    if (phase === "inbox" || phase === "outbox") {
      const rows =
        phase === "inbox"
          ? await ctx.db.query("inbox").take(limit)
          : await ctx.db.query("outbox").take(limit);
      for (const row of rows) await ctx.db.delete(row._id);
      return {
        scanned: rows.length,
        changed: rows.length,
        cursor: null,
        done: rows.length < limit,
      };
    }
    if (phase === "employees") {
      const page = await ctx.db
        .query("employees")
        .paginate({ numItems: limit, cursor: cursor ?? null });
      let changed = 0;
      for (const row of page.page)
        if (row.phone !== undefined) {
          await ctx.db.patch(row._id, { phone: undefined });
          changed++;
        }
      return {
        scanned: page.page.length,
        changed,
        cursor: page.isDone ? null : page.continueCursor,
        done: page.isDone,
      };
    }
    const page = await ctx.db
      .query("conversations")
      .paginate({ numItems: limit, cursor: cursor ?? null });
    let changed = 0;
    for (const row of page.page)
      if (
        row.linkId === undefined &&
        (row.pending !== undefined ||
          row.pendingAt !== undefined ||
          row.lastTimestamp !== 0)
      ) {
        await ctx.db.patch(row._id, {
          pending: undefined,
          pendingAt: undefined,
          lastTimestamp: 0,
          lastUpdateId: undefined,
        });
        changed++;
      }
    return {
      scanned: page.page.length,
      changed,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});
