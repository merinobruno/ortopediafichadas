import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { authorize } from "./data";

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const issueLinkCode = internalAction({
  args: { hash: v.string(), employeeId: v.id("employees") },
  handler: async (ctx, args): Promise<{ code: string; expiresAt: number }> => {
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(10)),
      (b) => alphabet[b & 31],
    ).join("");
    const expiresAt = Date.now() + 900000;
    await ctx.runMutation(internal.telegramLinks.storeCode, {
      ...args,
      digest: await sha256(code),
      expiresAt,
    });
    return { code, expiresAt };
  },
});

export const storeCode = internalMutation({
  args: {
    hash: v.string(),
    employeeId: v.id("employees"),
    digest: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { hash, employeeId, digest, expiresAt }) => {
    const admin = await authorize(ctx, hash);
    const employee = await ctx.db.get(employeeId);
    if (!employee?.active) throw new Error("Inactive employee");
    if (
      await ctx.db
        .query("telegramLinks")
        .withIndex("employee", (q) => q.eq("employeeId", employeeId))
        .first()
    )
      throw new Error("Employee already linked");
    for (const code of await ctx.db
      .query("telegramCodes")
      .withIndex("employee", (q) => q.eq("employeeId", employeeId))
      .collect())
      await ctx.db.delete(code._id);
    await ctx.db.insert("telegramCodes", { employeeId, digest, expiresAt });
    await ctx.db.insert("telegramLinkAudit", {
      employeeId,
      actor: admin._id,
      action: "issue",
      at: Date.now(),
    });
  },
});

async function failedAttempt(ctx: MutationCtx, userId: string, now: number) {
  const row = await ctx.db
    .query("telegramLinkAttempts")
    .withIndex("user", (q) => q.eq("userId", userId))
    .unique();
  if (!row)
    await ctx.db.insert("telegramLinkAttempts", {
      userId,
      start: now,
      count: 1,
    });
  else if (now - row.start >= 900000)
    await ctx.db.patch(row._id, { start: now, count: 1 });
  else await ctx.db.patch(row._id, { count: row.count + 1 });
}

export async function consumeLinkCode(
  ctx: MutationCtx,
  input: { codeHash: string; userId: string; chatId: string; now: number },
): Promise<{
  employeeId: Id<"employees">;
  linkId: Id<"telegramLinks">;
} | null> {
  const { codeHash, userId, chatId, now } = input;
  if (!/^\d+$/.test(userId) || userId !== chatId) return null;
  const attempts = await ctx.db
    .query("telegramLinkAttempts")
    .withIndex("user", (q) => q.eq("userId", userId))
    .unique();
  if (attempts && now - attempts.start < 900000 && attempts.count >= 5)
    return null;
  const code = await ctx.db
    .query("telegramCodes")
    .withIndex("digest", (q) => q.eq("digest", codeHash))
    .unique();
  const employee = code && (await ctx.db.get(code.employeeId));
  if (
    !code ||
    code.expiresAt <= now ||
    !employee?.active ||
    (await ctx.db
      .query("telegramLinks")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first()) ||
    (await ctx.db
      .query("telegramLinks")
      .withIndex("employee", (q) => q.eq("employeeId", code.employeeId))
      .first())
  ) {
    await failedAttempt(ctx, userId, now);
    return null;
  }
  await ctx.db.delete(code._id);
  const linkId = await ctx.db.insert("telegramLinks", {
    employeeId: code.employeeId,
    userId,
    chatId,
    createdAt: now,
  });
  await ctx.db.insert("telegramLinkAudit", {
    employeeId: code.employeeId,
    actor: "telegram",
    action: "link",
    at: now,
  });
  return { employeeId: code.employeeId, linkId };
}

export const consumeCode = internalMutation({
  args: {
    codeHash: v.string(),
    userId: v.string(),
    chatId: v.string(),
    now: v.number(),
  },
  handler: consumeLinkCode,
});

export const revokeLink = internalMutation({
  args: { hash: v.string(), employeeId: v.id("employees") },
  handler: async (ctx, { hash, employeeId }) => {
    const admin = await authorize(ctx, hash);
    if (!(await ctx.db.get(employeeId))) throw new Error("Employee not found");
    const link = await ctx.db
      .query("telegramLinks")
      .withIndex("employee", (q) => q.eq("employeeId", employeeId))
      .first();
    if (link) await ctx.db.delete(link._id);
    for (const code of await ctx.db
      .query("telegramCodes")
      .withIndex("employee", (q) => q.eq("employeeId", employeeId))
      .collect())
      await ctx.db.delete(code._id);
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("employee", (q) => q.eq("employeeId", employeeId))
      .first();
    if (conversation)
      await ctx.db.patch(conversation._id, {
        pending: undefined,
        pendingAt: undefined,
        linkId: undefined,
      });
    await ctx.db.insert("telegramLinkAudit", {
      employeeId,
      actor: admin._id,
      action: "revoke",
      at: Date.now(),
    });
  },
});
