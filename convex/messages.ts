import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { decideAttendance } from "./core";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
const message = v.object({
  messageId: v.string(),
  phone: v.string(),
  timestamp: v.number(),
  kind: v.string(),
  text: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});
export const receive = internalMutation({
  args: { messages: v.array(message) },
  handler: async (ctx, { messages }) => {
    for (const input of [...messages].sort(
      (a, b) => a.timestamp - b.timestamp,
    )) {
      if (
        await ctx.db
          .query("inbox")
          .withIndex("message", (q) => q.eq("messageId", input.messageId))
          .unique()
      )
        continue;
      const id = await ctx.db.insert("inbox", { ...input, status: "pending" });
      await ctx.scheduler.runAfter(0, internal.messages.process, { id });
    }
  },
});
export const process = internalMutation({
  args: { id: v.id("inbox") },
  handler: async (ctx, { id }) => {
    const trigger = await ctx.db.get(id);
    if (!trigger || trigger.status !== "pending") return;
    // Scheduler execution order is not message order. Drain this sender's
    // committed inbox in event order in one transaction before acknowledging.
    const pending = await ctx.db
      .query("inbox")
      .withIndex("pendingSender", (q) =>
        q.eq("phone", trigger.phone).eq("status", "pending"),
      )
      .take(100);
    for (const row of pending) await processOne(ctx, row._id);
  },
});
async function processOne(ctx: MutationCtx, id: Id<"inbox">) {
  const input = await ctx.db.get(id);
  if (!input || input.status !== "pending") return;
  const employee = await ctx.db
    .query("employees")
    .withIndex("phone", (q) => q.eq("phone", input.phone))
    .unique();
  if (!employee?.active) {
    await ctx.db.patch(id, {
      status: "rejected",
      result: "Unknown or inactive employee.",
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
    });
    state = (await ctx.db.get(stateId))!;
  }
  let result: string;
  let accepted = false;
  try {
    const now = Date.now();
    if (
      input.timestamp < now - 600000 ||
      input.timestamp > now + 60000 ||
      input.timestamp < state.lastTimestamp
    )
      throw new Error(
        "El mensaje venció o llegó fuera de orden. Enviá un nuevo comando y ubicación.",
      );
    await ctx.db.patch(state._id, { lastTimestamp: input.timestamp });
    if (input.kind === "text") {
      const command = input.text?.trim().toLowerCase();
      if (command !== "entrada" && command !== "salida")
        throw new Error("Enviá entrada o salida y luego tu ubicación actual.");
      await ctx.db.patch(state._id, {
        pending: command,
        pendingAt: input.timestamp,
      });
      result = `Enviá tu ubicación actual de WhatsApp para confirmar ${command}.`;
    } else {
      if (
        input.kind !== "location" ||
        !state.pending ||
        !state.pendingAt ||
        input.timestamp - state.pendingAt > 300000
      )
        throw new Error(
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
        messageId: input.messageId,
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
    result =
      error instanceof Error
        ? (translations[error.message] ?? error.message)
        : "No se pudo registrar la fichada.";
    // A rejected event consumes its command; a fresh explicit intent is required.
    await ctx.db.patch(state._id, {
      pending: undefined,
      pendingAt: undefined,
    });
  }
  await ctx.db.patch(id, {
    status: accepted ? "processed" : "rejected",
    result,
  });
  const outboxId = await ctx.db.insert("outbox", {
    phone: input.phone,
    text: result,
    status: "pending",
    // Leave a minute for provider/network transit before the 24-hour window.
    expiresAt: input.timestamp + 24 * 3600000 - 60000,
  });
  await ctx.scheduler.runAfter(0, internal.whatsapp.send, { id: outboxId });
}
export const claimSend = internalMutation({
  args: { id: v.id("outbox"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "pending") return null;
    if (row.expiresAt <= Date.now()) {
      await ctx.db.patch(id, { status: "expired" });
      return null;
    }
    await ctx.db.patch(id, { status: enabled ? "sending" : "disabled" });
    return enabled ? row : null;
  },
});
export const finishSend = internalMutation({
  args: {
    id: v.id("outbox"),
    status: v.string(),
    providerId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...data }) => {
    await ctx.db.patch(id, data);
  },
});
