import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../server/config";
import { WorkerLifecycle } from "../server/lifecycle";
test("configuration rejects invalid ports weak production password and incomplete explicit sender without leaking secrets", () => {
  for (const env of [
    { PORT: "abc" },
    { PORT: "0" },
    { PORT: "70000" },
    { NODE_ENV: "production", ADMIN_PASSWORD: "short" },
    { TELEGRAM_SEND_ENABLED: "true", TELEGRAM_BOT_TOKEN: "private-secret" },
  ]) {
    assert.throws(
      () => readConfig(env),
      (e) => {
        assert.ok(!String(e).includes("private-secret"));
        return true;
      },
    );
  }
  assert.equal(readConfig({}).port, 4381);
  assert.equal(
    readConfig({ NODE_ENV: "production", ADMIN_PASSWORD: "Strong-secret-123" })
      .demo,
    false,
  );
});
test("worker drain is idempotent waits for inflight task and prevents another task", async () => {
  let finish!: () => void;
  let calls = 0;
  let clock = 100;
  const worker = new WorkerLifecycle(
    async () => {
      calls++;
      await new Promise<void>((r) => (finish = r));
    },
    () => clock,
  );
  assert.equal(worker.ready(), true);
  const task = worker.tick();
  assert.equal(worker.running, true);
  const stop = worker.drain();
  assert.equal(worker.ready(), false);
  await worker.tick();
  assert.equal(calls, 1);
  finish();
  await Promise.all([task, stop, worker.drain()]);
  assert.equal(worker.running, false);
  clock += 601000;
  assert.equal(worker.ready(), false);
});
test("worker readiness tolerates long sender batch but fails stale progress", () => {
  let time = 0;
  const worker = new WorkerLifecycle(
    async () => {},
    () => time,
  );
  time = 301000;
  assert.equal(worker.ready(), true);
  time = 601000;
  assert.equal(worker.ready(), false);
});

import express from "express";
import { Store } from "../server/store";
import { installHealth } from "../server/health";
test("public health reveals only status and rejects draining stale or unavailable database", async () => {
  let now = 0;
  const worker = new WorkerLifecycle(
      async () => {},
      () => now,
    ),
    s = new Store(":memory:"),
    app = express();
  installHealth(app, s, worker);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {
    let r = await fetch(url + "/health/ready");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: "ready" });
    now = 601000;
    r = await fetch(url + "/health/ready");
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { status: "not_ready" });
    now = 0;
    s.db.close();
    assert.equal((await fetch(url + "/health/ready")).status, 503);
    await worker.drain();
    assert.deepEqual(await (await fetch(url + "/health/live")).json(), {
      status: "live",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
