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
    phone: v.optional(v.string()),
    active: v.boolean(),
  }),
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
    linkId: v.optional(v.id("telegramLinks")),
    lastTimestamp: v.number(),
    lastUpdateId: v.optional(v.number()),
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
  telegramLinks: defineTable({
    employeeId: v.id("employees"),
    userId: v.string(),
    chatId: v.string(),
    createdAt: v.number(),
  })
    .index("employee", ["employeeId"])
    .index("user", ["userId"]),
  telegramCodes: defineTable({
    employeeId: v.id("employees"),
    digest: v.string(),
    expiresAt: v.number(),
  })
    .index("employee", ["employeeId"])
    .index("digest", ["digest"]),
  telegramLinkAttempts: defineTable({
    userId: v.string(),
    start: v.number(),
    count: v.number(),
  }).index("user", ["userId"]),
  telegramLinkAudit: defineTable({
    employeeId: v.id("employees"),
    actor: v.string(),
    action: v.string(),
    at: v.number(),
  }),
  telegramInbox: defineTable({
    updateId: v.number(),
    messageId: v.number(),
    userId: v.string(),
    chatId: v.string(),
    timestamp: v.number(),
    receivedAt: v.number(),
    kind: v.string(),
    text: v.optional(v.string()),
    codeHash: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    linkIdAtReceipt: v.optional(v.id("telegramLinks")),
    status: v.string(),
    reasonCode: v.optional(v.string()),
  })
    .index("update", ["updateId"])
    .index("sender", ["userId", "status"]),
  telegramOutbox: defineTable({
    employeeId: v.id("employees"),
    linkId: v.id("telegramLinks"),
    chatId: v.string(),
    text: v.string(),
    status: v.string(),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    providerMessageId: v.optional(v.number()),
    reasonCode: v.optional(v.string()),
    createdAt: v.number(),
  }),
});
