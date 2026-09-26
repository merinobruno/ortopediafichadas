/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
it("returns bounded redacted metadata only to an authenticated administrator", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: "a@b.c",
      passwordHash: "x",
      active: true,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("sessions", {
      hash: "session",
      adminId,
      expires: Date.now() + 100000,
    }),
  );
  await t.run(async (ctx) => {
    for (let i = 0; i < 30; i++)
      await ctx.db.insert("telegramInbox", {
        updateId: i,
        messageId: i,
        userId: "8",
        chatId: "8",
        timestamp: Date.now(),
        receivedAt: Date.now(),
        kind: "text",
        text: "private",
        status: "rejected",
        reasonCode: "test",
      });
  });
  await expect(
    t.mutation(internal.telegramOperations.list, { hash: "bad" }),
  ).rejects.toThrow();
  const rows = await t.mutation(internal.telegramOperations.list, {
    hash: "session",
  });
  expect(rows.inbound).toHaveLength(25);
  expect(JSON.stringify(rows)).not.toContain("private");
  expect(JSON.stringify(rows)).not.toContain("chatId");
});
