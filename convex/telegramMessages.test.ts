/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import * as core from "./core";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

async function linked() {
  const t = convexTest(schema, modules);
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  await t.run((ctx) =>
    ctx.db.insert("sites", {
      name: "Central",
      latitude: -34.6,
      longitude: -58.4,
      radius: 100,
      active: true,
    }),
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

it("drains command before equal-second location and keeps duplicate update idempotent", async () => {
  const { t, employeeId } = await linked();
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
  const attendance = await t.run((ctx) => ctx.db.query("attendance").collect());
  expect(attendance).toHaveLength(1);
  expect(attendance[0].employeeId).toBe(employeeId);
  expect(
    await t.run((ctx) => ctx.db.query("telegramOutbox").collect()),
  ).toHaveLength(2);
});

it("does not let queued updates or replies cross revoke and relink to the same ID", async () => {
  const { t, employeeId } = await linked();
  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  const id = await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      updateId: 1,
      messageId: 1,
      userId: "8",
      chatId: "8",
      timestamp,
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
  expect(
    (await t.run((ctx) => ctx.db.query("telegramInbox").first()))?.status,
  ).toBe("rejected");
  expect(
    await t.run((ctx) => ctx.db.query("telegramOutbox").collect()),
  ).toHaveLength(0);
});

it("rolls back an unexpected attendance failure without exposing its message", async () => {
  vi.useFakeTimers();
  const { t } = await linked();
  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  const command = await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      updateId: 11,
      messageId: 11,
      userId: "8",
      chatId: "8",
      timestamp,
      kind: "text",
      text: "entrada",
    },
  });
  await t.mutation(internal.telegramMessages.processTelegram, { id: command! });
  const location = await t.mutation(internal.telegramInbox.receiveTelegram, {
    event: {
      updateId: 12,
      messageId: 12,
      userId: "8",
      chatId: "8",
      timestamp: timestamp + 1000,
      kind: "location",
      latitude: -34.6,
      longitude: -58.4,
    },
  });
  expect((await t.run((ctx) => ctx.db.get(location!)))?.status).toBe("pending");
  const spy = vi.spyOn(core, "decideAttendance").mockImplementation(() => {
    throw new Error("internal-secret-marker");
  });
  try {
    await expect(
      t.mutation(internal.telegramMessages.processTelegram, { id: location! }),
    ).rejects.toThrow("internal-secret-marker");
    expect(spy).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    vi.useRealTimers();
  }
  expect((await t.run((ctx) => ctx.db.get(location!)))?.status).toBe("pending");
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(0);
  expect(
    JSON.stringify(
      await t.run((ctx) => ctx.db.query("telegramOutbox").collect()),
    ),
  ).not.toContain("internal-secret-marker");
});

it("keeps site and chronological exit rules across multiple visits", async () => {
  vi.useFakeTimers();
  try {
    const { t, employeeId } = await linked();
    await t.run((ctx) =>
      ctx.db.insert("sites", {
        name: "Other",
        latitude: 1,
        longitude: 1,
        radius: 100,
        active: true,
      }),
    );
    const baseTime = Math.floor(Date.now() / 1000) * 1000 - 10000;
    async function send(
      updateId: number,
      kind: "text" | "location",
      timestamp: number,
      extra: object,
    ) {
      const id = await t.mutation(internal.telegramInbox.receiveTelegram, {
        event: {
          updateId,
          messageId: updateId,
          userId: "8",
          chatId: "8",
          timestamp,
          kind,
          ...extra,
        },
      });
      await t.mutation(internal.telegramMessages.processTelegram, { id: id! });
    }
    await send(1, "text", baseTime, { text: "entrada" });
    await send(2, "location", baseTime + 1000, {
      latitude: -34.6,
      longitude: -58.4,
    });
    await send(3, "text", baseTime + 2000, { text: "salida" });
    await send(4, "location", baseTime + 3000, { latitude: 1, longitude: 1 });
    expect(
      await t.run((ctx) => ctx.db.query("attendance").collect()),
    ).toHaveLength(1);
    await send(5, "text", baseTime + 4000, { text: "salida" });
    await send(6, "location", baseTime + 5000, {
      latitude: -34.6,
      longitude: -58.4,
    });
    const rows = await t.run((ctx) => ctx.db.query("attendance").collect());
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.employeeId)).toEqual([employeeId, employeeId]);
    expect(rows[1].siteId).toBe(rows[0].siteId);
    await send(7, "text", baseTime, { text: "entrada" });
    await send(8, "location", baseTime + 6000, {
      latitude: -34.6,
      longitude: -58.4,
    });
    expect(
      await t.run((ctx) => ctx.db.query("attendance").collect()),
    ).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it("rejects an expired command window and location without a command", async () => {
  vi.useFakeTimers();
  try {
    const { t } = await linked();
    const now = Math.floor(Date.now() / 1000) * 1000;
    const command = await t.mutation(internal.telegramInbox.receiveTelegram, {
      event: {
        updateId: 1,
        messageId: 1,
        userId: "8",
        chatId: "8",
        timestamp: now - 360000,
        kind: "text",
        text: "entrada",
      },
    });
    await t.mutation(internal.telegramMessages.processTelegram, {
      id: command!,
    });
    const location = await t.mutation(internal.telegramInbox.receiveTelegram, {
      event: {
        updateId: 2,
        messageId: 2,
        userId: "8",
        chatId: "8",
        timestamp: now,
        kind: "location",
        latitude: -34.6,
        longitude: -58.4,
      },
    });
    await t.mutation(internal.telegramMessages.processTelegram, {
      id: location!,
    });
    expect(
      await t.run((ctx) => ctx.db.query("attendance").collect()),
    ).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(location!)))?.status).toBe(
      "rejected",
    );
  } finally {
    vi.useRealTimers();
  }
});
