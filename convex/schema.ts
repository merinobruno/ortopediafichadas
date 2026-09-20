import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  admins: defineTable({
    email: v.string(),
    passwordHash: v.string(),
    active: v.boolean(),
  }).index("email", ["email"]),
  sessions: defineTable({
    hash: v.string(),
    adminId: v.id("admins"),
    expires: v.number(),
  }).index("hash", ["hash"]),
  limits: defineTable({
    key: v.string(),
    start: v.number(),
    count: v.number(),
  }).index("key", ["key"]),
  employees: defineTable({
    name: v.string(),
    phone: v.string(),
    active: v.boolean(),
  }).index("phone", ["phone"]),
  sites: defineTable({
    name: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    radius: v.number(),
    active: v.boolean(),
  }),
  attendance: defineTable({
    employeeId: v.id("employees"),
    siteId: v.id("sites"),
    employeeName: v.string(),
    siteName: v.string(),
    kind: v.union(v.literal("entrada"), v.literal("salida")),
    timestamp: v.number(),
    latitude: v.number(),
    longitude: v.number(),
    messageId: v.string(),
  }).index("employee", ["employeeId", "timestamp"]),
  conversations: defineTable({
    employeeId: v.id("employees"),
    lastTimestamp: v.number(),
    pending: v.optional(v.union(v.literal("entrada"), v.literal("salida"))),
    pendingAt: v.optional(v.number()),
    openSiteId: v.optional(v.id("sites")),
  }).index("employee", ["employeeId"]),
  inbox: defineTable({
    messageId: v.string(),
    phone: v.string(),
    timestamp: v.number(),
    kind: v.string(),
    text: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    status: v.string(),
    result: v.optional(v.string()),
  })
    .index("message", ["messageId"])
    .index("pendingSender", ["phone", "status", "timestamp"]),
  outbox: defineTable({
    phone: v.string(),
    text: v.string(),
    status: v.string(),
    expiresAt: v.number(),
    providerId: v.optional(v.string()),
  }),
});
