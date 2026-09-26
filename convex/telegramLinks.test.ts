/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

it("consumes a code once, binds one account, and rejects re-use", async () => {
  const t = convexTest(schema, modules);
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
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
  await t.mutation(internal.telegramLinks.storeCode, {
    hash: "session",
    employeeId,
    digest: "digest",
    expiresAt: Date.now() + 900000,
  });
  const first = await t.mutation(internal.telegramLinks.consumeCode, {
    codeHash: "digest",
    userId: "8",
    chatId: "8",
    now: Date.now(),
  });
  expect(first?.employeeId).toBe(employeeId);
  expect(
    await t.mutation(internal.telegramLinks.consumeCode, {
      codeHash: "digest",
      userId: "9",
      chatId: "9",
      now: Date.now(),
    }),
  ).toBeNull();
  expect(
    await t.run((ctx) => ctx.db.query("telegramLinks").collect()),
  ).toHaveLength(1);
  expect(
    (await t.run((ctx) => ctx.db.query("telegramLinkAudit").first()))?.actor,
  ).toBe(adminId);
});

it("enforces expiry, sender guesses and account uniqueness", async () => {
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
  const first = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  const second = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Beto", active: true }),
  );
  await t.mutation(internal.telegramLinks.storeCode, {
    hash: "session",
    employeeId: first,
    digest: "expired",
    expiresAt: Date.now() - 1,
  });
  expect(
    await t.mutation(internal.telegramLinks.consumeCode, {
      codeHash: "expired",
      userId: "8",
      chatId: "8",
      now: Date.now(),
    }),
  ).toBeNull();
  await t.mutation(internal.telegramLinks.storeCode, {
    hash: "session",
    employeeId: first,
    digest: "valid",
    expiresAt: Date.now() + 900000,
  });
  for (let i = 0; i < 4; i++)
    expect(
      await t.mutation(internal.telegramLinks.consumeCode, {
        codeHash: "wrong",
        userId: "8",
        chatId: "8",
        now: Date.now(),
      }),
    ).toBeNull();
  expect(
    await t.mutation(internal.telegramLinks.consumeCode, {
      codeHash: "valid",
      userId: "8",
      chatId: "8",
      now: Date.now(),
    }),
  ).toBeNull();
  expect(
    await t.mutation(internal.telegramLinks.consumeCode, {
      codeHash: "valid",
      userId: "9",
      chatId: "9",
      now: Date.now(),
    }),
  ).not.toBeNull();
  await t.mutation(internal.telegramLinks.storeCode, {
    hash: "session",
    employeeId: second,
    digest: "second",
    expiresAt: Date.now() + 900000,
  });
  expect(
    await t.mutation(internal.telegramLinks.consumeCode, {
      codeHash: "second",
      userId: "9",
      chatId: "9",
      now: Date.now(),
    }),
  ).toBeNull();
  expect(
    await t.run((ctx) => ctx.db.query("telegramLinks").collect()),
  ).toHaveLength(1);
});

it("allows exactly one concurrent consumption", async () => {
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
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  await t.mutation(internal.telegramLinks.storeCode, {
    hash: "session",
    employeeId,
    digest: "race",
    expiresAt: Date.now() + 900000,
  });
  await Promise.allSettled(
    ["8", "9"].map((userId) =>
      t.mutation(internal.telegramLinks.consumeCode, {
        codeHash: "race",
        userId,
        chatId: userId,
        now: Date.now(),
      }),
    ),
  );
  expect(
    await t.run((ctx) => ctx.db.query("telegramLinks").collect()),
  ).toHaveLength(1);
});
