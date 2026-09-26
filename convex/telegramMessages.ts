import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { decideAttendance } from "./core";
import { consumeLinkCode } from "./telegramLinks";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const translations: Record<string, string> = {
  "Employee is not active.": "El empleado no está activo.",
  "Invalid location.": "La ubicación no es válida.",
  "Stale or out-of-order message. Send a new command and location.":
    "El mensaje venció o llegó fuera de orden. Enviá un nuevo comando y ubicación.",
  "An entry is already open.": "Ya tenés una entrada abierta.",
  "There is no open entry.": "No tenés una entrada abierta.",
  "Exit must be at the entry site, inside its radius.":
    "La salida debe ser en la misma sede de entrada y dentro del radio.",
  "Location is outside every active site.":
    "Estás fuera del radio de las sedes activas.",
};
class AttendanceRejection extends Error {}

export const processTelegram = internalMutation({
  args: { id: v.id("telegramInbox") },
  handler: async (ctx, { id }) => {
    const trigger = await ctx.db.get(id);
    if (!trigger || trigger.status !== "pending") return;
    const pending = await ctx.db
      .query("telegramInbox")
      .withIndex("sender", (q) =>
        q.eq("userId", trigger.userId).eq("status", "pending"),
      )
      .take(100);
    pending.sort(
      (a, b) =>
        a.timestamp - b.timestamp ||
        a.updateId - b.updateId ||
        a.messageId - b.messageId,
    );
    for (const row of pending) await processOne(ctx, row);
  },
});

async function reply(
  ctx: MutationCtx,
  employeeId: Id<"employees">,
  linkId: Id<"telegramLinks">,
  chatId: string,
  text: string,
) {
  const id = await ctx.db.insert("telegramOutbox", {
    employeeId,
    linkId,
    chatId,
    text,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.telegramSend.sendTelegram, { id });
}

async function processOne(ctx: MutationCtx, input: Doc<"telegramInbox">) {
  if (input.status !== "pending") return;
  if (input.codeHash) {
    // An unlinked onboarding update may be processed after code issuance. A previously
    // linked update must not gain authority across revocation and relinking.
    if (input.linkIdAtReceipt) {
      await ctx.db.patch(input._id, {
        status: "rejected",
        reasonCode: "already_linked_at_receipt",
      });
      return;
    }
    const linked = await consumeLinkCode(ctx, {
      codeHash: input.codeHash,
      userId: input.userId,
      chatId: input.chatId,
      now: Date.now(),
    });
    if (!linked) {
      await ctx.db.patch(input._id, {
        status: "rejected",
        reasonCode: "invalid_code",
      });
      return;
    }
    const employee = await ctx.db.get(linked.employeeId);
    await ctx.db.patch(input._id, { status: "processed" });
    await reply(
      ctx,
      linked.employeeId,
      linked.linkId,
      input.chatId,
      `Telegram vinculado a ${employee!.name}. Enviá entrada o salida para fichar.`,
    );
    return;
  }
  const link = await ctx.db
    .query("telegramLinks")
    .withIndex("user", (q) => q.eq("userId", input.userId))
    .first();
  const employee = link && (await ctx.db.get(link.employeeId));
  if (
    !link ||
    link._id !== input.linkIdAtReceipt ||
    link.chatId !== input.chatId ||
    !employee?.active
  ) {
    await ctx.db.patch(input._id, {
      status: "rejected",
      reasonCode: "link_inactive",
    });
    return;
  }
  let state = await ctx.db
    .query("conversations")
    .withIndex("employee", (q) => q.eq("employeeId", employee._id))
    .unique();
  if (!state) {
    const stateId = await ctx.db.insert("conversations", {
      employeeId: employee._id,
      lastTimestamp: 0,
      linkId: link._id,
    });
    state = (await ctx.db.get(stateId))!;
  } else if (state.linkId !== link._id) {
    await ctx.db.patch(state._id, {
      linkId: link._id,
      pending: undefined,
      pendingAt: undefined,
    });
    state = (await ctx.db.get(state._id))!;
  }
  let result = "";
  let accepted = false;
  let reasonCode: string | undefined;
  try {
    const now = Date.now();
    if (
      input.timestamp < now - 600000 ||
      input.timestamp > now + 60000 ||
      input.timestamp < state.lastTimestamp ||
      (input.timestamp === state.lastTimestamp &&
        input.updateId <= (state.lastUpdateId ?? -1))
    )
      throw new AttendanceRejection(
        "El mensaje venció o llegó fuera de orden. Enviá un nuevo comando y ubicación.",
      );
    await ctx.db.patch(state._id, {
      lastTimestamp: input.timestamp,
      lastUpdateId: input.updateId,
    });
    if (input.kind === "text") {
      const command = input.text?.trim().toLowerCase();
      if (command !== "entrada" && command !== "salida")
        throw new AttendanceRejection(
          "Enviá entrada o salida y luego tu ubicación actual.",
        );
      await ctx.db.patch(state._id, {
        pending: command,
        pendingAt: input.timestamp,
      });
      result = `Enviá tu ubicación actual de Telegram para confirmar ${command}.`;
    } else {
      if (
        input.kind !== "location" ||
        !state.pending ||
        state.pendingAt === undefined ||
        input.timestamp < state.pendingAt ||
        input.timestamp - state.pendingAt > 300000
      )
        throw new AttendanceRejection(
          "Enviá entrada o salida antes de compartir tu ubicación.",
        );
      const sites = await ctx.db.query("sites").collect();
      const last = await ctx.db
        .query("attendance")
        .withIndex("employee", (q) => q.eq("employeeId", employee._id))
        .order("desc")
        .first();
      const site = decideAttendance({
        kind: state.pending,
        latitude: input.latitude!,
        longitude: input.longitude!,
        timestamp: input.timestamp,
        now,
        active: employee.active,
        lastTimestamp: last?.timestamp,
        open: state.openSiteId ? { siteId: state.openSiteId } : null,
        sites: sites.map((s) => ({ ...s, id: s._id })),
      });
      const siteId = sites.find((s) => s._id === site.id)!._id;
      await ctx.db.insert("attendance", {
        employeeId: employee._id,
        siteId,
        employeeName: employee.name,
        siteName: site.name,
        kind: state.pending,
        timestamp: input.timestamp,
        latitude: input.latitude!,
        longitude: input.longitude!,
        messageId: `${input.chatId}:${input.messageId}`,
      });
      await ctx.db.patch(state._id, {
        openSiteId: state.pending === "entrada" ? siteId : undefined,
        pending: undefined,
        pendingAt: undefined,
      });
      result = `${state.pending === "entrada" ? "Entrada" : "Salida"} registrada en ${site.name}.`;
    }
    accepted = true;
  } catch (error) {
    const translated =
      error instanceof Error ? translations[error.message] : undefined;
    if (!(error instanceof AttendanceRejection) && translated === undefined)
      throw error;
    reasonCode = "attendance_rejected";
    result = error instanceof AttendanceRejection ? error.message : translated!;
    await ctx.db.patch(state._id, { pending: undefined, pendingAt: undefined });
  }
  await ctx.db.patch(input._id, {
    status: accepted ? "processed" : "rejected",
    reasonCode,
  });
  await reply(ctx, employee._id, link._id, link.chatId, result);
}
