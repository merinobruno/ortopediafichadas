import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { processTelegramInbox } from "../server/telegram";

test("session, Telegram linking, and verified durable webhook", async () => {
  process.env.ADMIN_PASSWORD = "test-password-123";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO employees(id,name,role,site_ids,active) VALUES('e1','Ana','Empleado','[]',1)",
    )
    .run();
  const server = createApp(s).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(url + "/api/state")).status, 401);
    const login = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password-123" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    const issue = await fetch(url + "/api/employees/e1/telegram-code", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(issue.status, 200);
    assert.match(issue.headers.get("cache-control") || "", /no-store/);
    const { code } = await issue.json();
    assert.equal(
      JSON.stringify(
        await (await fetch(url + "/api/state", { headers: { cookie } })).json(),
      ).includes(code),
      false,
    );
    const update = {
      update_id: 92,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        from: { id: 8 },
        chat: { id: 8, type: "private" },
        text: `/start ${code}`,
      },
    };
    const send = (headers: Record<string, string> = {}) =>
      fetch(url + "/webhook/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(update),
      });
    assert.equal((await send()).status, 401);
    assert.equal(s.all("SELECT * FROM telegram_inbox").length, 0);
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await send({ "X-Telegram-Bot-Api-Secret-Token": "test-secret" }))
          .status,
        200,
      );
    assert.equal(s.all("SELECT * FROM telegram_inbox").length, 1);
    assert.equal(
      JSON.stringify(s.all("SELECT * FROM telegram_inbox")).includes(code),
      false,
    );
    processTelegramInbox(s);
    assert.equal(
      s.one("SELECT employee_id FROM telegram_links WHERE user_id='8'")
        ?.employee_id,
      "e1",
    );
    assert.equal(
      s.one("SELECT status FROM telegram_inbox WHERE update_id=92")?.status,
      "processed",
    );
    assert.equal(
      s.one("SELECT status FROM telegram_outbox WHERE update_id=92")?.status,
      "queued",
    );
    assert.equal(
      (await fetch(url + "/webhook/whatsapp", { method: "POST" })).status,
      404,
    );
  } finally {
    server.close();
    s.db.close();
  }
});
