/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const firstPassword = "private-test-password-123";
const peerPassword = "another-private-password-123";

afterEach(() => vi.unstubAllEnvs());

function setup() {
  vi.stubEnv("PROXY_SECRET", "trusted");
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  return convexTest(schema, modules);
}

function api(
  t: ReturnType<typeof convexTest>,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  cookie?: string,
) {
  return t.fetch(path, {
    method,
    headers: {
      "x-proxy-secret": "trusted",
      ...(method === "POST" ? { origin: "https://attendance.example" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(
  t: ReturnType<typeof convexTest>,
  email: string,
  password: string,
) {
  const response = await api(t, "/api/login", "POST", { email, password });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!;
}

it("lets a signed-in HR admin add an equal-permission peer without exposing credentials", async () => {
  const t = setup();
  await t.action(internal.auth.bootstrapAdmin, {
    email: "admin@example.com",
    password: firstPassword,
  });
  expect(
    (
      await api(t, "/api/admins", "POST", {
        email: "peer@example.com",
        password: peerPassword,
      })
    ).status,
  ).toBe(401);

  const firstCookie = await login(t, "admin@example.com", firstPassword);
  const created = await api(
    t,
    "/api/admins",
    "POST",
    {
      email: "  PEER@EXAMPLE.COM  ",
      password: peerPassword,
    },
    firstCookie,
  );
  expect(created.status).toBe(200);
  expect(await created.json()).toEqual({ ok: true });

  const listed = await api(t, "/api/data", "GET", undefined, firstCookie);
  expect(listed.status).toBe(200);
  const data = await listed.json();
  expect(data.admins).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ email: "admin@example.com", active: true }),
      expect.objectContaining({ email: "peer@example.com", active: true }),
    ]),
  );
  expect(data.admins).toHaveLength(2);
  expect(JSON.stringify(data)).not.toContain("passwordHash");
  expect(JSON.stringify(data)).not.toContain(peerPassword);

  const peerCookie = await login(t, "peer@example.com", peerPassword);
  expect((await api(t, "/api/data", "GET", undefined, peerCookie)).status).toBe(
    200,
  );
  const saved = await api(
    t,
    "/api/employees",
    "POST",
    { name: "Ana", active: true },
    peerCookie,
  );
  expect(saved.status).toBe(200);
  const peerData = await api(t, "/api/data", "GET", undefined, peerCookie);
  expect((await peerData.json()).employees).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "Ana" })]),
  );
});

it("rejects invalid inputs and atomically prevents normalized duplicate HR email", async () => {
  const t = setup();
  await t.action(internal.auth.bootstrapAdmin, {
    email: "admin@example.com",
    password: firstPassword,
  });
  const cookie = await login(t, "admin@example.com", firstPassword);
  for (const body of [
    { email: "invalid", password: peerPassword },
    { email: "peer@example.com", password: "short" },
    { email: `${"x".repeat(250)}@example.com`, password: peerPassword },
  ]) {
    const response = await api(t, "/api/admins", "POST", body, cookie);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(body.password);
  }

  const attempts = await Promise.all([
    api(
      t,
      "/api/admins",
      "POST",
      { email: "PEER@example.com", password: peerPassword },
      cookie,
    ),
    api(
      t,
      "/api/admins",
      "POST",
      { email: " peer@example.com ", password: peerPassword },
      cookie,
    ),
  ]);
  expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 409]);
  const admins = await t.run((ctx) => ctx.db.query("admins").collect());
  expect(admins).toHaveLength(2);
  expect(
    admins.filter((admin) => admin.email === "peer@example.com"),
  ).toHaveLength(1);
});

it("uses a six-character minimum for first and added administrators", async () => {
  const t = setup();
  await expect(
    t.action(internal.auth.bootstrapAdmin, {
      email: "admin@example.com",
      password: "12345",
    }),
  ).rejects.toThrow("6–128 characters");
  await t.action(internal.auth.bootstrapAdmin, {
    email: "admin@example.com",
    password: "123456",
  });
  const cookie = await login(t, "admin@example.com", "123456");
  const rejected = await api(
    t,
    "/api/admins",
    "POST",
    { email: "peer@example.com", password: "12345" },
    cookie,
  );
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toEqual({
    error: "Ingresá un correo válido y una contraseña de 6 a 128 caracteres.",
  });
  const created = await api(
    t,
    "/api/admins",
    "POST",
    { email: "peer@example.com", password: "123456" },
    cookie,
  );
  expect(created.status).toBe(200);
  await login(t, "peer@example.com", "123456");
});
