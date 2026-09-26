/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

async function linked() {
  const t = convexTest(schema, modules);
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  const linkId = await t.run((ctx) =>
    ctx.db.insert("telegramLinks", {
      employeeId,
      userId: "8",
      chatId: "8",
      createdAt: Date.now(),
    }),
  );
  return { t, employeeId, linkId };
}

it("orders a command and manual pin without recording attendance, and deduplicates update ID", async () => {
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  const { t } = await linked();
  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  const base = { userId: "8", chatId: "8", timestamp };
  await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      ...base,
      updateId: 1,
      messageId: 1,
      kind: "text",
      text: "entrada",
    },
  });
  const location = await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      ...base,
      updateId: 2,
      messageId: 2,
      kind: "location",
      latitude: -34.6,
      longitude: -58.4,
    },
  });
  await t.mutation(internal.telegramMessages.processTelegram, {
    id: location!,
  });
  await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      ...base,
      updateId: 2,
      messageId: 2,
      kind: "location",
      latitude: -34.6,
      longitude: -58.4,
    },
  });
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(0);
  const outbox = await t.run((ctx) => ctx.db.query("telegramOutbox").collect());
  expect(outbox).toHaveLength(2);
  expect(
    outbox.every(
      (row) => row.webAppUrl === "https://attendance.example/fichar.html",
    ),
  ).toBe(true);
  expect(outbox[1].text).toContain("no registra asistencia");
  expect(
    (await t.run((ctx) => ctx.db.query("conversations").first()))?.pending,
  ).toBeUndefined();
  vi.unstubAllEnvs();
});

it("does not let queued updates or replies cross revoke and relink to the same ID", async () => {
  const { t, employeeId } = await linked();
  const id = await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      updateId: 1,
      messageId: 1,
      userId: "8",
      chatId: "8",
      timestamp: Date.now(),
      kind: "text",
      text: "entrada",
    },
  });
  await t.run(async (ctx) => {
    const prior = await ctx.db.query("telegramLinks").first();
    await ctx.db.delete(prior!._id);
    await ctx.db.insert("telegramLinks", {
      employeeId,
      userId: "8",
      chatId: "8",
      createdAt: Date.now(),
    });
  });
  await t.mutation(internal.telegramMessages.processTelegram, { id: id! });
  expect((await t.run((ctx) => ctx.db.get(id!)))?.status).toBe("rejected");
  expect(
    await t.run((ctx) => ctx.db.query("telegramOutbox").collect()),
  ).toHaveLength(0);
});

it("clears a pre-existing pending chat intent without attendance", async () => {
  const { t, employeeId, linkId } = await linked();
  await t.run((ctx) =>
    ctx.db.insert("conversations", {
      employeeId,
      linkId,
      lastTimestamp: 0,
      pending: "entrada",
      pendingAt: Date.now() - 1000,
    }),
  );
  const id = await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      updateId: 3,
      messageId: 3,
      userId: "8",
      chatId: "8",
      timestamp: Date.now(),
      kind: "location",
      latitude: -34.6,
      longitude: -58.4,
    },
  });
  await t.mutation(internal.telegramMessages.processTelegram, { id: id! });
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(0);
  expect(
    (await t.run((ctx) => ctx.db.query("conversations").first()))?.pending,
  ).toBeUndefined();
});

it("rejects stale location without opening an attendance record", async () => {
  const { t } = await linked();
  const id = await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      updateId: 4,
      messageId: 4,
      userId: "8",
      chatId: "8",
      timestamp: Date.now() - 700000,
      kind: "location",
      latitude: -34.6,
      longitude: -58.4,
    },
  });
  await t.mutation(internal.telegramMessages.processTelegram, { id: id! });
  expect((await t.run((ctx) => ctx.db.get(id!)))?.status).toBe("rejected");
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(0);
});
