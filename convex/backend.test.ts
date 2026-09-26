/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

async function authorized() {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: "a@b.c",
      passwordHash: "private",
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
  return t;
}

it("requires an active administrator session for data access", async () => {
  const t = await authorized();
  await expect(
    t.mutation(internal.data.list, { hash: "bad" }),
  ).rejects.toThrow();
  const session = await t.run((ctx) => ctx.db.query("sessions").first());
  await t.run((ctx) => ctx.db.patch(session!._id, { expires: Date.now() - 1 }));
  await expect(
    t.mutation(internal.data.list, { hash: "session" }),
  ).rejects.toThrow();
});

it("saves employees without phones and exposes only their link status", async () => {
  const t = await authorized();
  await t.mutation(internal.data.saveEmployee, {
    hash: "session",
    name: " Ana ",
    active: true,
  });
  const employee = (
    await t.run((ctx) => ctx.db.query("employees").collect())
  )[0];
  expect(employee.name).toBe("Ana");
  expect(employee.phone).toBeUndefined();
  const before = await t.mutation(internal.data.list, { hash: "session" });
  expect(before.employees[0].telegramLinked).toBe(false);
  await t.run((ctx) =>
    ctx.db.insert("telegramLinks", {
      employeeId: employee._id,
      userId: "8",
      chatId: "8",
      createdAt: Date.now(),
    }),
  );
  const after = await t.mutation(internal.data.list, { hash: "session" });
  expect(after.employees[0].telegramLinked).toBe(true);
  expect(JSON.stringify(after)).not.toContain("chatId");
  expect(JSON.stringify(after)).not.toContain("phone");
});

it("preserves existing employee, site, and attendance identities during private bounded cleanup", async () => {
  const t = await authorized();
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", {
      name: "Ana",
      phone: "5491112345678",
      active: true,
    }),
  );
  const siteId = await t.run((ctx) =>
    ctx.db.insert("sites", {
      name: "Central",
      latitude: 0,
      longitude: 0,
      radius: 100,
      active: true,
    }),
  );
  const attendanceId = await t.run((ctx) =>
    ctx.db.insert("attendance", {
      employeeId,
      siteId,
      employeeName: "Ana",
      siteName: "Central",
      kind: "entrada",
      timestamp: 1000,
      latitude: 0,
      longitude: 0,
      messageId: "old",
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("inbox", {
      messageId: "old",
      phone: "5491112345678",
      timestamp: 1000,
      kind: "text",
      status: "pending",
    }),
  );
  await t.mutation(internal.telegramCleanup.clearLegacyTransport, {
    limit: 10,
    phase: "inbox",
  });
  await t.mutation(internal.telegramCleanup.clearLegacyTransport, {
    limit: 10,
    phase: "employees",
  });
  expect((await t.run((ctx) => ctx.db.get(employeeId)))?.phone).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.get(siteId))).toBeTruthy();
  expect(await t.run((ctx) => ctx.db.get(attendanceId))).toBeTruthy();
  expect(await t.run((ctx) => ctx.db.query("inbox").collect())).toHaveLength(0);
});

it("keeps login throttling durable", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 5; i++)
    expect(
      await t.mutation(internal.data.loginAttempt, { email: "x@y.z" }),
    ).toBe(true);
  expect(await t.mutation(internal.data.loginAttempt, { email: "x@y.z" })).toBe(
    false,
  );
});

it("deactivation invalidates links, codes and pending intent", async () => {
  const t = await authorized();
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("telegramLinks", {
      employeeId,
      userId: "8",
      chatId: "8",
      createdAt: Date.now(),
    });
    await ctx.db.insert("telegramCodes", {
      employeeId,
      digest: "hash",
      expiresAt: Date.now() + 900000,
    });
    await ctx.db.insert("conversations", {
      employeeId,
      lastTimestamp: Date.now(),
      pending: "entrada",
      pendingAt: Date.now(),
    });
  });
  await t.mutation(internal.data.saveEmployee, {
    hash: "session",
    id: employeeId,
    name: "Ana",
    active: false,
  });
  expect(
    await t.run((ctx) => ctx.db.query("telegramLinks").collect()),
  ).toHaveLength(0);
  expect(
    await t.run((ctx) => ctx.db.query("telegramCodes").collect()),
  ).toHaveLength(0);
  expect(
    (await t.run((ctx) => ctx.db.query("conversations").first()))?.pending,
  ).toBeUndefined();
});
