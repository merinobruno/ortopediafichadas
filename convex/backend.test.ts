/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
it("requires session and active admin on every data operation", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(internal.data.list, { hash: "missing" }),
  ).rejects.toThrow();
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: "a@b.c",
      passwordHash: "private",
      active: false,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("sessions", {
      hash: "token",
      adminId,
      expires: Date.now() + 100000,
    }),
  );
  await expect(
    t.mutation(internal.data.list, { hash: "token" }),
  ).rejects.toThrow();
});
it("deduplicates messages before scheduled processing and preserves immutable history", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("employees", {
      name: "Ana",
      phone: "5491112345678",
      active: true,
    });
    await ctx.db.insert("sites", {
      name: "Central",
      latitude: -34.6,
      longitude: -58.4,
      radius: 100,
      active: true,
    });
  });
  const command = {
    messageId: "cmd",
    phone: "5491112345678",
    timestamp: now,
    kind: "text",
    text: "entrada",
  };
  await t.mutation(internal.messages.receive, { messages: [command, command] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const loc = {
    messageId: "loc",
    phone: command.phone,
    timestamp: now,
    kind: "location",
    latitude: -34.6,
    longitude: -58.4,
  };
  await t.mutation(internal.messages.receive, { messages: [loc, loc] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const rows = await t.run((ctx) => ctx.db.query("attendance").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    employeeName: "Ana",
    siteName: "Central",
    kind: "entrada",
  });
  expect(await t.run((ctx) => ctx.db.query("inbox").collect())).toHaveLength(2);
  vi.useRealTimers();
});
it("persists login throttles even when authentication fails", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 5; i++)
    expect(
      await t.mutation(internal.data.loginAttempt, { email: "x@y.z" }),
    ).toBe(true);
  expect(await t.mutation(internal.data.loginAttempt, { email: "x@y.z" })).toBe(
    false,
  );
});

it("provisions only once, stores password and session hashes, expires and revokes access", async () => {
  const t = convexTest(schema, modules);
  await t.action(internal.auth.bootstrapAdmin, {
    email: "admin@example.com",
    password: "private-test-password-123",
  });
  await expect(
    t.action(internal.auth.bootstrapAdmin, {
      email: "other@example.com",
      password: "private-test-password-456",
    }),
  ).rejects.toThrow();
  const admin = await t.run((ctx) => ctx.db.query("admins").first());
  expect(admin!.passwordHash).not.toContain("private-test-password");
  expect(
    await t.action(internal.auth.login, {
      email: "admin@example.com",
      password: "wrong",
      clientKey: "ip1",
    }),
  ).toBeNull();
  const login = await t.action(internal.auth.login, {
    email: "admin@example.com",
    password: "private-test-password-123",
    clientKey: "ip1",
  });
  expect(login!.token).toHaveLength(64);
  const session = await t.run((ctx) => ctx.db.query("sessions").first());
  expect(session!.hash).not.toBe(login!.token);
  expect(
    (await t.mutation(internal.data.list, { hash: session!.hash })).email,
  ).toBe("admin@example.com");
  await t.run((ctx) => ctx.db.patch(session!._id, { expires: Date.now() - 1 }));
  await expect(
    t.mutation(internal.data.saveEmployee, {
      hash: session!.hash,
      name: "Ana",
      phone: "5491112345678",
      active: true,
    }),
  ).rejects.toThrow();
  await t.mutation(internal.data.logout, { hash: session!.hash });
  expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toHaveLength(
    0,
  );
});

it("normalizes unique employee phones and validates site coordinates behind auth", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("admins", {
      email: "a@b.c",
      passwordHash: "private",
      active: true,
    });
    await ctx.db.insert("sessions", {
      hash: "session",
      adminId,
      expires: Date.now() + 100000,
    });
  });
  await t.mutation(internal.data.saveEmployee, {
    hash: "session",
    name: " Ana ",
    phone: "+54 9 11 1234-5678",
    active: true,
  });
  await expect(
    t.mutation(internal.data.saveEmployee, {
      hash: "session",
      name: "Other",
      phone: "5491112345678",
      active: true,
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(internal.data.saveSite, {
      hash: "session",
      name: "Bad",
      latitude: 91,
      longitude: 0,
      radius: 100,
      active: true,
    }),
  ).rejects.toThrow();
  const employee = (
    await t.run((ctx) => ctx.db.query("employees").collect())
  )[0];
  expect(employee).toMatchObject({ name: "Ana", phone: "5491112345678" });
  await t.mutation(internal.data.saveEmployee, {
    hash: "session",
    id: employee._id,
    name: "Ana",
    phone: employee.phone,
    active: false,
  });
  expect((await t.run((ctx) => ctx.db.get(employee._id)))!.active).toBe(false);
});

it("rejects wrong-site exit and stale events without altering an open entry", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const now = Date.now();
  const phone = "5491112345678";
  await t.run(async (ctx) => {
    await ctx.db.insert("employees", { name: "Ana", phone, active: true });
    await ctx.db.insert("sites", {
      name: "A",
      latitude: 0,
      longitude: 0,
      radius: 100,
      active: true,
    });
    await ctx.db.insert("sites", {
      name: "B",
      latitude: 1,
      longitude: 1,
      radius: 100,
      active: true,
    });
  });
  async function send(messageId: string, timestamp: number, value: object) {
    await t.mutation(internal.messages.receive, {
      messages: [{ messageId, timestamp, phone, ...value }] as any,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }
  await send("in", now - 5000, { kind: "text", text: "entrada" });
  await send("inloc", now - 4000, {
    kind: "location",
    latitude: 0,
    longitude: 0,
  });
  await send("out", now - 3000, { kind: "text", text: "salida" });
  await send("wrongloc", now - 2000, {
    kind: "location",
    latitude: 1,
    longitude: 1,
  });
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(1);
  await send("out2", now - 1000, { kind: "text", text: "salida" });
  await send("correctloc", now, {
    kind: "location",
    latitude: 0,
    longitude: 0,
  });
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(2);
  await send("old", now - 1000000, { kind: "text", text: "entrada" });
  expect(
    (await t.run((ctx) =>
      ctx.db
        .query("inbox")
        .withIndex("message", (q) => q.eq("messageId", "old"))
        .unique(),
    ))!.status,
  ).toBe("rejected");
  expect(
    (await t.run((ctx) => ctx.db.query("conversations").first()))!.openSiteId,
  ).toBeUndefined();
  vi.useRealTimers();
});

it("does not create account throttle rows once the client is rate limited", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 5; i++)
    await t.mutation(internal.data.loginAttempt, {
      email: "ip:limited-client",
    });
  await t.action(internal.auth.login, {
    email: "unbounded-new-email@example.com",
    password: "wrong",
    clientKey: "limited-client",
  });
  expect(await t.run((ctx) => ctx.db.query("limits").collect())).toHaveLength(
    1,
  );
});

it("expires replies based on the inbound timestamp before attempting a send", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("outbox", {
      phone: "5491112345678",
      text: "Reply",
      status: "pending",
      expiresAt: Date.now() - 1,
    }),
  );
  expect(
    await t.mutation(internal.messages.claimSend, { id, enabled: true }),
  ).toBeNull();
  expect((await t.run((ctx) => ctx.db.get(id)))!.status).toBe("expired");
});

it("processes a queued command before its location even if the location worker runs first", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const now = Date.now();
  const phone = "5491112345678";
  await t.run(async (ctx) => {
    await ctx.db.insert("employees", { name: "Ana", phone, active: true });
    await ctx.db.insert("sites", {
      name: "A",
      latitude: 0,
      longitude: 0,
      radius: 100,
      active: true,
    });
  });
  await t.mutation(internal.messages.receive, {
    messages: [
      {
        messageId: "cmd",
        phone,
        timestamp: now - 1000,
        kind: "text",
        text: "entrada",
      },
      {
        messageId: "loc",
        phone,
        timestamp: now,
        kind: "location",
        latitude: 0,
        longitude: 0,
      },
    ],
  });
  const location = await t.run((ctx) =>
    ctx.db
      .query("inbox")
      .withIndex("message", (q) => q.eq("messageId", "loc"))
      .unique(),
  );
  await t.mutation(internal.messages.process, { id: location!._id });
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(1);
  vi.useRealTimers();
});
