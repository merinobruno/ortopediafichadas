import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { listOperations, reviewOperation } from "../server/telegram-operations";
function setup() {
  const s = new Store(":memory:");
  s.db.exec(
    "INSERT INTO employees(id,name) VALUES('e','Ana');INSERT INTO telegram_inbox(update_id,message_id,user_id,chat_id,event_at,received_at,kind,text,status,reason_code) VALUES(1,1,'8','8',1788220800000,'2026-09-01T00:00:00Z','text','SECRET RAW LOCATION','rejected','PRIVATE ERROR');INSERT INTO telegram_outbox(id,employee_id,link_generation,chat_id,text,status,created_at,reason_code) VALUES('out','e','generation','8','PRIVATE MESSAGE','recovery_hold','2026-09-01T00:00:00Z','SECRET TOKEN')",
  );
  return s;
}
test("operator metadata is role restricted and redacted with recovery hold visible", async () => {
  const s = setup();
  try {
    assert.throws(
      () => listOperations(s, { role: "supervisor" }, { lane: "outbox" }),
      (e: any) => e.status === 403,
    );
    const rows = listOperations(s, { role: "hr" }, { lane: "outbox" });
    assert.equal(rows.rows[0].status, "recovery_hold");
    assert.doesNotMatch(
      JSON.stringify(rows),
      /SECRET|PRIVATE|123|payload|phone|provider_id/,
    );
    assert.equal(
      listOperations(s, { role: "admin" }, { lane: "inbox" }).rows[0]
        .reason_code,
      "processing_rejected",
    );
    process.env.ADMIN_PASSWORD = "Operator-test-2026";
    const app = createApp(s);
    upsertUser(
      s,
      {
        email: "supervisor@example.test",
        name: "Synthetic supervisor",
        role: "supervisor",
        active: true,
        employee_ids: [],
        password: "Supervisor-test-2026",
      },
      "bootstrap",
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const base = "http://127.0.0.1:" + (server.address() as any).port;
      assert.equal(
        (await fetch(base + "/api/telegram-operations?lane=inbox")).status,
        401,
      );
      const login = await fetch(base + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "supervisor@example.test",
          password: "Supervisor-test-2026",
        }),
      });
      const cookie = login.headers.get("set-cookie")!;
      assert.equal(
        (
          await fetch(base + "/api/telegram-operations?lane=inbox", {
            headers: { cookie },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(base + "/api/telegram-operations/review", {
            method: "POST",
            headers: { cookie, "Content-Type": "application/json" },
            body: JSON.stringify({}),
          })
        ).status,
        403,
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    s.db.close();
  }
});
test("review revisions audit atomically without any transport or intent mutation", () => {
  const s = setup();
  try {
    const before = s.all("SELECT * FROM telegram_outbox");
    const input = {
      lane: "outbox",
      id: "out",
      expectedRevision: 0,
      state: "reviewed",
      reason: "Checked offline",
    };
    reviewOperation(s, { role: "hr", email: "hr@example.test" }, input);
    assert.deepEqual(s.all("SELECT * FROM telegram_outbox"), before);
    assert.equal(
      s.one("SELECT actor FROM operation_reviews").actor,
      "hr@example.test",
    );
    assert.throws(
      () => reviewOperation(s, { role: "hr" }, input),
      (e: any) => e.status === 409,
    );
    s.db.exec(
      "CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'synthetic');END",
    );
    assert.throws(() =>
      reviewOperation(
        s,
        { role: "admin", email: "admin@example.test" },
        { ...input, expectedRevision: 1, state: "dismissed" },
      ),
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM operation_reviews").n, 1);
    assert.deepEqual(s.all("SELECT * FROM telegram_outbox"), before);
    assert.equal(s.one("SELECT COUNT(*) n FROM bot_pending").n, 0);
  } finally {
    s.db.close();
  }
});
test("operator cursor pages and review filters do not skip or duplicate records", () => {
  const s = setup();
  try {
    for (let i = 0; i < 30; i++)
      s.db
        .prepare(
          "INSERT INTO telegram_inbox(update_id,message_id,user_id,chat_id,event_at,received_at,kind,text,status) VALUES(?,1,'8','8',1788307200000,?,'text','secret','pending')",
        )
        .run(i + 2, "2026-09-02T00:00:00Z");
    const a = listOperations(s, { role: "admin" }, { lane: "inbox" }),
      b = listOperations(
        s,
        { role: "admin" },
        { lane: "inbox", cursor: a.nextCursor },
      );
    assert.equal(a.rows.length, 25);
    assert.equal(b.rows.length, 6);
    assert.equal(new Set([...a.rows, ...b.rows].map((r) => r.id)).size, 31);
    assert.throws(() =>
      listOperations(s, { role: "hr" }, { lane: "inbox", cursor: "invalid" }),
    );
  } finally {
    s.db.close();
  }
});
