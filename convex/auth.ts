"use node";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export const bootstrapAdmin = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    email = email.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      password.length < 14 ||
      password.length > 128
    )
      throw new Error("Use a valid email and a password of 14–128 characters.");
    await ctx.runMutation(internal.data.provision, {
      email,
      passwordHash: passwordHash(password),
    });
    return { created: true };
  },
});
export const login = internalAction({
  args: { email: v.string(), password: v.string(), clientKey: v.string() },
  handler: async (
    ctx,
    { email, password, clientKey },
  ): Promise<{ token: string } | null> => {
    email = email.trim().toLowerCase();
    if (email.length > 254 || password.length > 128) return null;
    const ipAllowed = await ctx.runMutation(internal.data.loginAttempt, {
      email: `ip:${clientKey}`,
    });
    if (!ipAllowed) return null;
    const accountAllowed = await ctx.runMutation(internal.data.loginAttempt, {
      email,
    });
    if (!accountAllowed) return null;
    const admin = await ctx.runQuery(internal.data.adminByEmail, { email });
    // Use the same expensive derivation for unknown users.
    const [salt, stored] = (
      admin?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`
    ).split(":");
    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(stored, "hex");
    if (
      expected.length !== computed.length ||
      !timingSafeEqual(computed, expected) ||
      !admin?.active
    )
      return null;
    const token = randomBytes(32).toString("hex");
    await ctx.runMutation(internal.data.createSession, {
      adminId: admin._id,
      hash: createHash("sha256").update(token).digest("hex"),
    });
    return { token };
  },
});
