/// <reference types="vite/client" />
import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { verifyTelegramInitData } from "./telegramPhoneAuth";

const modules = import.meta.glob("./**/*.ts");
const token = "test-bot-token";
function signed(userId = 8, authDate = Math.floor(Date.now() / 1000)) {
  const fields = `auth_date=${authDate}\nuser=${JSON.stringify({ id: userId, first_name: "Ana" })}`;
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(fields).digest("hex");
  return `auth_date=${authDate}&user=${encodeURIComponent(JSON.stringify({ id: userId, first_name: "Ana" }))}&hash=${hash}`;
}

it("authenticates exact raw Telegram initData and rejects tampering, expiry and future dates", async () => {
  const now = Date.now();
  expect(await verifyTelegramInitData(signed(), token, now)).toBe("8");
  await expect(
    verifyTelegramInitData(signed().replace("Ana", "Eve"), token, now),
  ).rejects.toThrow();
  await expect(
    verifyTelegramInitData(signed(8, Math.floor(now / 1000) - 301), token, now),
  ).rejects.toMatchObject({ code: "expired" });
  await expect(
    verifyTelegramInitData(signed(8, Math.floor(now / 1000) + 31), token, now),
  ).rejects.toMatchObject({ code: "invalid" });
  await expect(
    verifyTelegramInitData(signed().replace("Ana", "Eve"), token, now),
  ).rejects.toMatchObject({ code: "invalid" });
  await expect(
    verifyTelegramInitData(`${signed()}&user=duplicate`, token, now),
  ).rejects.toThrow();
  const date = Math.floor(now / 1000);
  const user = JSON.stringify({ id: 8 });
  const extraCheck = `auth_date=${date}\nchat_instance=trial\nquery_id=Q1\nuser=${user}`;
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const extraHash = createHmac("sha256", secret)
    .update(extraCheck)
    .digest("hex");
  expect(
    await verifyTelegramInitData(
      `user=${encodeURIComponent(user)}&query_id=Q1&auth_date=${date}&chat_instance=trial&hash=${extraHash}`,
      token,
      now,
    ),
  ).toBe("8");
});

async function prepared() {
  const t = convexTest(schema, modules);
  const employeeId = await t.run((ctx) =>
    ctx.db.insert("employees", { name: "Ana", active: true }),
  );
  const siteId = await t.run((ctx) =>
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
  return { t, employeeId, siteId, linkId };
}

it("uses one challenge for one server-timed attendance and returns its receipt on retry", async () => {
  const { t, employeeId } = await prepared();
  const now = Date.now();
  const issued = await t.mutation(internal.telegramPhone.issueChallenge, {
    userId: "8",
    digest: "a".repeat(64),
    kind: "entrada",
    now,
  });
  expect(issued).toMatchObject({ ok: true });
  const args = {
    userId: "8",
    digest: "a".repeat(64),
    latitude: -34.6,
    longitude: -58.4,
    accuracy: 20,
    now: now + 1000,
  };
  const first = await t.mutation(internal.telegramPhone.submitChallenge, args);
  const second = await t.mutation(internal.telegramPhone.submitChallenge, args);
  expect(first).toMatchObject({
    ok: true,
    kind: "entrada",
    siteName: "Central",
  });
  expect(second).toEqual(first);
  const rows = await t.run((ctx) => ctx.db.query("attendance").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    employeeId,
    timestamp: now + 1000,
    source: "telegram_mini_app",
    horizontalAccuracy: 20,
  });
});

it("rejects expired, revoked, relinked, inaccurate and out-of-radius submissions", async () => {
  const { t, employeeId, linkId } = await prepared();
  const now = Date.now();
  await t.mutation(internal.telegramPhone.issueChallenge, {
    userId: "8",
    digest: "b".repeat(64),
    kind: "entrada",
    now,
  });
  const base = {
    userId: "8",
    digest: "b".repeat(64),
    latitude: -34.6,
    longitude: -58.4,
    accuracy: 20,
    now: now + 1000,
  };
  expect(
    await t.mutation(internal.telegramPhone.submitChallenge, {
      ...base,
      accuracy: 101,
    }),
  ).toMatchObject({ ok: false, reason: "accuracy_invalid" });
  expect(
    await t.mutation(internal.telegramPhone.submitChallenge, {
      ...base,
      latitude: -35,
    }),
  ).toMatchObject({ ok: false, reason: "outside_active_site" });
  expect(
    await t.mutation(internal.telegramPhone.submitChallenge, {
      ...base,
      now: now + 61000,
    }),
  ).toMatchObject({ ok: false, reason: "challenge_expired" });
  await t.run(async (ctx) => {
    await ctx.db.delete(linkId);
    await ctx.db.insert("telegramLinks", {
      employeeId,
      userId: "8",
      chatId: "8",
      createdAt: now + 1,
    });
  });
  expect(
    await t.mutation(internal.telegramPhone.submitChallenge, base),
  ).toMatchObject({ ok: false, reason: "link_inactive" });
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(0);
});

it("returns distinct reasons for attendance state, site, and location failures", async () => {
  const cases = [
    { state: "open", kind: "entrada", reason: "entry_already_open" },
    { state: "closed", kind: "salida", reason: "entry_missing" },
    { state: "open", kind: "salida", latitude: -35, reason: "exit_wrong_site" },
    {
      state: "closed",
      kind: "entrada",
      latitude: -35,
      reason: "outside_active_site",
    },
    {
      state: "closed",
      kind: "entrada",
      last: true,
      reason: "attendance_out_of_order",
    },
    {
      state: "closed",
      kind: "entrada",
      latitude: 91,
      reason: "coordinates_invalid",
    },
    {
      state: "closed",
      kind: "entrada",
      accuracy: 101,
      reason: "accuracy_invalid",
    },
    {
      state: "closed",
      kind: "entrada",
      latitude: -34.5995,
      accuracy: 60,
      reason: "accuracy_outside_site",
    },
  ] as const;
  for (const [index, scenario] of cases.entries()) {
    const { t, employeeId, siteId, linkId } = await prepared();
    const now = Date.now();
    if (scenario.state === "open")
      await t.run((ctx) =>
        ctx.db.insert("conversations", {
          employeeId,
          linkId,
          lastTimestamp: 0,
          openSiteId: siteId,
        }),
      );
    if ("last" in scenario)
      await t.run((ctx) =>
        ctx.db.insert("attendance", {
          employeeId,
          siteId,
          employeeName: "Ana",
          siteName: "Central",
          kind: "entrada",
          timestamp: now + 2000,
          latitude: -34.6,
          longitude: -58.4,
          messageId: `prior:${index}`,
        }),
      );
    const digest = index.toString(16).padStart(64, "0");
    await t.mutation(internal.telegramPhone.issueChallenge, {
      userId: "8",
      digest,
      kind: scenario.kind,
      now,
    });
    expect(
      await t.mutation(internal.telegramPhone.submitChallenge, {
        userId: "8",
        digest,
        latitude: "latitude" in scenario ? scenario.latitude : -34.6,
        longitude: -58.4,
        accuracy: "accuracy" in scenario ? scenario.accuracy : 12,
        now: now + 1000,
      }),
      scenario.reason,
    ).toMatchObject({ ok: false, reason: scenario.reason });
    expect(
      await t.run((ctx) => ctx.db.query("attendance").collect()),
    ).toHaveLength("last" in scenario ? 1 : 0);
  }
});

it("writes once for concurrent submissions and requires exit at the open site", async () => {
  const { t } = await prepared();
  await t.run((ctx) =>
    ctx.db.insert("sites", {
      name: "Other",
      latitude: -35,
      longitude: -58.4,
      radius: 100,
      active: true,
    }),
  );
  const now = Date.now();
  await t.mutation(internal.telegramPhone.issueChallenge, {
    userId: "8",
    digest: "c".repeat(64),
    kind: "entrada",
    now,
  });
  const entry = {
    userId: "8",
    digest: "c".repeat(64),
    latitude: -34.6,
    longitude: -58.4,
    accuracy: 12,
    now: now + 1000,
  };
  const [first, second] = await Promise.all([
    t.mutation(internal.telegramPhone.submitChallenge, entry),
    t.mutation(internal.telegramPhone.submitChallenge, entry),
  ]);
  expect(first).toEqual(second);
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(1);
  await t.mutation(internal.telegramPhone.issueChallenge, {
    userId: "8",
    digest: "d".repeat(64),
    kind: "salida",
    now: now + 2000,
  });
  const exit = { ...entry, digest: "d".repeat(64), now: now + 3000 };
  expect(
    await t.mutation(internal.telegramPhone.submitChallenge, {
      ...exit,
      latitude: -35,
    }),
  ).toMatchObject({ ok: false });
  expect(
    await t.mutation(internal.telegramPhone.submitChallenge, exit),
  ).toMatchObject({ ok: true, kind: "salida" });
  expect(
    await t.run((ctx) => ctx.db.query("attendance").collect()),
  ).toHaveLength(2);
});
