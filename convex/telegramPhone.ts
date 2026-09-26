import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { decideAttendance, distance, validCoordinates } from "./core";

const kind = v.union(v.literal("entrada"), v.literal("salida"));
const knownAttendanceErrors = new Set([
  "An entry is already open.",
  "There is no open entry.",
  "Exit must be at the entry site, inside its radius.",
  "Location is outside every active site.",
  "Stale or out-of-order message. Send a new command and location.",
]);

export const issueChallenge = internalMutation({
  args: { userId: v.string(), digest: v.string(), kind, now: v.number() },
  handler: async (ctx, { userId, digest, kind, now }) => {
    if (
      !/^\d+$/.test(userId) ||
      !/^[0-9a-f]{64}$/.test(digest) ||
      !Number.isFinite(now)
    )
      return { ok: false as const, reason: "invalid_request" };
    const link = await ctx.db
      .query("telegramLinks")
      .withIndex("user", (q) => q.eq("userId", userId))
      .unique();
    const employee = link && (await ctx.db.get(link.employeeId));
    if (!link || link.chatId !== userId || !employee?.active)
      return { ok: false as const, reason: "link_inactive" };
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("employee", (q) => q.eq("employeeId", employee._id))
      .unique();
    if (
      conversation &&
      (conversation.pending !== undefined ||
        conversation.pendingAt !== undefined)
    )
      await ctx.db.patch(conversation._id, {
        pending: undefined,
        pendingAt: undefined,
      });
    for (const previous of await ctx.db
      .query("telegramPhoneChallenges")
      .withIndex("link", (q) => q.eq("linkId", link._id))
      .collect())
      await ctx.db.delete(previous._id);
    const expiresAt = now + 60000;
    await ctx.db.insert("telegramPhoneChallenges", {
      employeeId: employee._id,
      linkId: link._id,
      userId,
      digest,
      kind,
      expiresAt,
    });
    return { ok: true as const, expiresAt, employeeName: employee.name };
  },
});

export const submitChallenge = internalMutation({
  args: {
    userId: v.string(),
    digest: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    accuracy: v.number(),
    now: v.number(),
  },
  handler: async (ctx, input) => {
    if (
      !/^\d+$/.test(input.userId) ||
      !/^[0-9a-f]{64}$/.test(input.digest) ||
      !Number.isFinite(input.now)
    )
      return { ok: false as const, reason: "invalid_request" };
    const challenge = await ctx.db
      .query("telegramPhoneChallenges")
      .withIndex("digest", (q) => q.eq("digest", input.digest))
      .unique();
    if (!challenge || challenge.userId !== input.userId)
      return { ok: false as const, reason: "challenge_invalid" };
    const link = await ctx.db.get(challenge.linkId);
    const employee = await ctx.db.get(challenge.employeeId);
    if (
      !link ||
      link.userId !== input.userId ||
      link.chatId !== input.userId ||
      link.employeeId !== challenge.employeeId ||
      !employee?.active
    )
      return { ok: false as const, reason: "link_inactive" };
    if (challenge.attendanceId) {
      const receipt = await ctx.db.get(challenge.attendanceId);
      return receipt
        ? {
            ok: true as const,
            kind: receipt.kind,
            siteName: receipt.siteName,
            timestamp: receipt.timestamp,
            receiptId: receipt._id,
          }
        : { ok: false as const, reason: "challenge_invalid" };
    }
    if (input.now >= challenge.expiresAt)
      return { ok: false as const, reason: "challenge_expired" };
    if (
      !validCoordinates(input.latitude, input.longitude) ||
      !Number.isFinite(input.accuracy) ||
      input.accuracy <= 0 ||
      input.accuracy > 100
    )
      return { ok: false as const, reason: "location_invalid" };
    const state = await ctx.db
      .query("conversations")
      .withIndex("employee", (q) => q.eq("employeeId", employee._id))
      .unique();
    const last = await ctx.db
      .query("attendance")
      .withIndex("employee", (q) => q.eq("employeeId", employee._id))
      .order("desc")
      .first();
    const sites = await ctx.db.query("sites").collect();
    let site;
    try {
      site = decideAttendance({
        kind: challenge.kind,
        latitude: input.latitude,
        longitude: input.longitude,
        timestamp: input.now,
        now: input.now,
        active: employee.active,
        lastTimestamp: last?.timestamp,
        open: state?.openSiteId ? { siteId: state.openSiteId } : null,
        sites: sites.map((s) => ({ ...s, id: s._id })),
      });
    } catch (error) {
      if (error instanceof Error && knownAttendanceErrors.has(error.message))
        return { ok: false as const, reason: "attendance_rejected" };
      throw error;
    }
    // The reported uncertainty circle must fit within the site boundary.
    if (
      distance({ latitude: input.latitude, longitude: input.longitude }, site) +
        input.accuracy >
      site.radius
    )
      return { ok: false as const, reason: "accuracy_outside_site" };
    const siteId = sites.find((candidate) => candidate._id === site.id)!._id;
    const attendanceId = await ctx.db.insert("attendance", {
      employeeId: employee._id,
      siteId,
      employeeName: employee.name,
      siteName: site.name,
      kind: challenge.kind,
      timestamp: input.now,
      latitude: input.latitude,
      longitude: input.longitude,
      messageId: `telegram-mini:${challenge._id}`,
      source: "telegram_mini_app",
      horizontalAccuracy: input.accuracy,
    });
    if (state)
      await ctx.db.patch(state._id, {
        linkId: link._id,
        openSiteId: challenge.kind === "entrada" ? siteId : undefined,
        pending: undefined,
        pendingAt: undefined,
      });
    else
      await ctx.db.insert("conversations", {
        employeeId: employee._id,
        linkId: link._id,
        lastTimestamp: 0,
        openSiteId: challenge.kind === "entrada" ? siteId : undefined,
      });
    await ctx.db.patch(challenge._id, { attendanceId });
    return {
      ok: true as const,
      kind: challenge.kind,
      siteName: site.name,
      timestamp: input.now,
      receiptId: attendanceId,
    };
  },
});
