import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
const pdf = readFileSync(
  new URL("./fixtures/recibo-ficticio-qa.pdf", import.meta.url),
);
test("private receipt HTTP authenticates before parsing and protects bytes and audits from supervisors", async () => {
  process.env.ADMIN_PASSWORD = "Receipt-api-test-2026";
  const s = new Store(":memory:");
  s.db.exec(
    "INSERT INTO employees(id,name,role) VALUES('e','Synthetic','5491100000011')",
  );
  const app = createApp(s);
  upsertUser(
    s,
    {
      email: "supervisor@example.test",
      name: "Synthetic supervisor",
      role: "supervisor",
      active: true,
      employee_ids: ["e"],
      password: "Supervisor-test-2026",
    },
    "admin",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const login = async (body: unknown) =>
    (
      await fetch(base + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).headers.get("set-cookie")!;
  try {
    const admin = await login({ password: "Receipt-api-test-2026" }),
      sup = await login({
        email: "supervisor@example.test",
        password: "Supervisor-test-2026",
      });
    const request = (path: string, cookie: string, body?: unknown) =>
      fetch(base + "/api/receipts" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const unauthorized = await fetch(
      base + "/api/receipts/batches/x/documents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken",
      },
    );
    assert.equal(unauthorized.status, 401);
    assert.equal((await request("/batches", sup)).status, 403);
    const created = await request("/batches", admin, {
      title: "Synthetic payroll",
      period: "2026-09",
      liquidation: "monthly",
    });
    assert.equal(created.status, 201);
    const b = await created.json();
    const upload = (cookie: string, bytes: Buffer, type = "application/pdf") =>
      fetch(base + "/api/receipts/batches/" + b.id + "/documents", {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": type,
          "X-Filename": "synthetic.pdf",
        },
        body: new Uint8Array(bytes),
      });
    assert.equal(
      (await upload(sup, Buffer.from("{bad"), "application/json")).status,
      403,
    );
    assert.equal((await upload(admin, pdf, "text/plain")).status, 415);
    assert.equal(
      (await upload(admin, Buffer.alloc(5 * 1048576 + 1))).status,
      413,
    );
    assert.equal((await upload(admin, Buffer.from("invalid"))).status, 400);
    const uploaded = await upload(admin, pdf);
    assert.equal(uploaded.status, 201);
    const d = await uploaded.json();
    assert.equal("content" in d, false);
    assert.equal(
      (
        await request("/documents/" + d.id + "/assignment", admin, {
          employee_id: "e",
          reason: "Confirmed synthetic assignment",
        })
      ).status,
      200,
    );
    assert.equal((await upload(admin, pdf)).status, 409);
    const download = await request("/documents/" + d.id + "/download", admin);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("cache-control")!, /no-store/);
    assert.match(download.headers.get("content-disposition")!, /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.equal(
      (await request("/documents/" + d.id + "/download", sup)).status,
      403,
    );
    assert.equal(
      (await request("/batches/" + b.id + "/documents", sup)).status,
      403,
    );
    const state = await (
      await fetch(base + "/api/state", { headers: { cookie: sup } })
    ).json();
    assert.ok(
      state.audit.every(
        (a: any) => !String(a.after_json).includes("private_receipt"),
      ),
    );
    assert.equal(
      (
        await request("/batches/" + b.id + "/archive", admin, {
          reason: "Completed test archive",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/documents/" + d.id + "/assignment", admin, {
          employee_id: "e",
          reason: "Cannot change archive",
        })
      ).status,
      409,
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});
