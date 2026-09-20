import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone, validCoordinates } from "./core";
import type { MutationCtx } from "./_generated/server";
async function authorize(ctx: MutationCtx, hash: string) {
  const session = await ctx.db
    .query("sessions")
    .withIndex("hash", (q) => q.eq("hash", hash))
    .unique();
  if (!session || session.expires <= Date.now())
    throw new Error("Unauthorized");
  const admin = await ctx.db.get(session.adminId);
  if (!admin?.active) throw new Error("Unauthorized");
  return admin;
}
export const loginAttempt = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const key = `login:${email}`;
    const row = await ctx.db
      .query("limits")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("limits", { key, count: 1, start: now });
      return true;
    }
    if (now - row.start >= 900000) {
      await ctx.db.patch(row._id, { count: 1, start: now });
      return true;
    }
    if (row.count >= 5) return false;
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return true;
  },
});
export const adminByEmail = internalQuery({
  args: { email: v.string() },
  handler: (ctx, { email }) =>
    ctx.db
      .query("admins")
      .withIndex("email", (q) => q.eq("email", email))
      .unique(),
});
export const provision = internalMutation({
  args: { email: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    if (await ctx.db.query("admins").first())
      throw new Error("First administrator already exists.");
    return ctx.db.insert("admins", { ...args, active: true });
  },
});
export const createSession = internalMutation({
  args: { adminId: v.id("admins"), hash: v.string() },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.adminId))?.active)
      throw new Error("Unauthorized");
    await ctx.db.insert("sessions", {
      ...args,
      expires: Date.now() + 8 * 3600000,
    });
  },
});
export const logout = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("hash", (q) => q.eq("hash", hash))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});
export const list = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const admin = await authorize(ctx, hash);
    return {
      email: admin.email,
      employees: await ctx.db.query("employees").collect(),
      sites: await ctx.db.query("sites").collect(),
      attendance: await ctx.db.query("attendance").order("desc").take(1000),
    };
  },
});
export const saveEmployee = internalMutation({
  args: {
    hash: v.string(),
    id: v.optional(v.id("employees")),
    name: v.string(),
    phone: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, { hash, id, ...input }) => {
    await authorize(ctx, hash);
    const name = input.name.trim();
    const phone = normalizePhone(input.phone);
    if (!name || name.length > 100)
      throw new Error("Name must contain 1–100 characters.");
    const duplicate = await ctx.db
      .query("employees")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .unique();
    if (duplicate && duplicate._id !== id)
      throw new Error("Phone is already registered.");
    const data = { name, phone, active: input.active };
    if (id) {
      if (!(await ctx.db.get(id))) throw new Error("Employee not found");
      await ctx.db.patch(id, data);
    } else await ctx.db.insert("employees", data);
  },
});
export const saveSite = internalMutation({
  args: {
    hash: v.string(),
    id: v.optional(v.id("sites")),
    name: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    radius: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, { hash, id, ...data }) => {
    await authorize(ctx, hash);
    data.name = data.name.trim();
    if (
      !data.name ||
      data.name.length > 100 ||
      !validCoordinates(data.latitude, data.longitude) ||
      !Number.isFinite(data.radius) ||
      data.radius < 1 ||
      data.radius > 10000
    )
      throw new Error("Invalid site. Radius must be 1–10000 meters.");
    if (id) {
      if (!(await ctx.db.get(id))) throw new Error("Site not found");
      await ctx.db.patch(id, data);
    } else await ctx.db.insert("sites", data);
  },
});
