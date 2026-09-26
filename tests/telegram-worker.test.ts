import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  issueLinkCode,
  consumeLinkCode,
  hashLinkCode,
  revokeLink,
} from "../server/telegram-links";
import {
  receiveTelegramUpdate,
  processTelegramInbox,
} from "../server/telegram";
import {
  simulateEmployeeText,
  simulateEmployeeMessage,
} from "../server/employee-bot";

function fixture() {
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius,category,active) VALUES(?,?,?,?,?,?,?,1)",
    )
    .run("s", "Central", "", 0, 0, 100, "Sucursal");
  s.db
    .prepare(
      "INSERT INTO employees(id,name,role,site_ids,active) VALUES(?,?,?,?,1)",
    )
    .run("e", "Ana", "Empleado", '["s"]');
  return s;
}

test("committed equal-second command and manual pin never record attendance", () => {
  const s = fixture();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const { code } = issueLinkCode(s, "e", "hr", now);
    assert.ok(consumeLinkCode(s, hashLinkCode(code), "8", "8", now));
    receiveTelegramUpdate(
      s,
      {
        updateId: 2,
        messageId: 2,
        userId: "8",
        chatId: "8",
        timestamp: now,
        kind: "location",
        latitude: 0,
        longitude: 0,
      },
      now,
    );
    receiveTelegramUpdate(
      s,
      {
        updateId: 1,
        messageId: 1,
        userId: "8",
        chatId: "8",
        timestamp: now,
        kind: "text",
        text: "entrada",
      },
      now,
    );
    processTelegramInbox(s, () => now + 1000);
    processTelegramInbox(s, () => now + 1000);
    assert.equal(s.all("SELECT * FROM visits").length, 0);
    assert.equal(s.all("SELECT * FROM telegram_outbox").length, 2);
    assert.equal(
      s.all("SELECT * FROM telegram_inbox WHERE status='processed'").length,
      2,
    );
  } finally {
    s.db.close();
  }
});

test("revoke and relink to the same account cannot process queued old work", () => {
  const s = fixture();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const first = issueLinkCode(s, "e", "hr", now);
    consumeLinkCode(s, hashLinkCode(first.code), "8", "8", now);
    receiveTelegramUpdate(
      s,
      {
        updateId: 1,
        messageId: 1,
        userId: "8",
        chatId: "8",
        timestamp: now,
        kind: "text",
        text: "entrada",
      },
      now,
    );
    revokeLink(s, "e", "hr", now);
    const second = issueLinkCode(s, "e", "hr", now);
    consumeLinkCode(s, hashLinkCode(second.code), "8", "8", now);
    processTelegramInbox(s, () => now + 1000);
    assert.equal(
      s.one("SELECT status FROM telegram_inbox WHERE update_id=1").status,
      "rejected",
    );
    assert.equal(s.all("SELECT * FROM telegram_outbox").length, 0);
  } finally {
    s.db.close();
  }
});

test("simulator uses employee ID without provider inbox or outbox", () => {
  const s = fixture();
  try {
    const now = Date.now();
    simulateEmployeeText(s, "e", "entrada", "hr", now);
    simulateEmployeeMessage(
      s,
      "e",
      { kind: "location", latitude: 0, longitude: 0 },
      "hr",
      now + 1000,
    );
    assert.equal(s.all("SELECT * FROM visits").length, 1);
    assert.equal(s.all("SELECT * FROM telegram_inbox").length, 0);
    assert.equal(s.all("SELECT * FROM telegram_outbox").length, 0);
  } finally {
    s.db.close();
  }
});

test("invalid leave does not poison sender queue; chat pin cannot record attendance", () => {
  const s = fixture();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const { code } = issueLinkCode(s, "e", "hr", now);
    consumeLinkCode(s, hashLinkCode(code), "8", "8", now);
    const event = (
      updateId: number,
      kind: "text" | "location",
      text?: string,
    ) =>
      receiveTelegramUpdate(
        s,
        {
          updateId,
          messageId: updateId,
          userId: "8",
          chatId: "8",
          timestamp: now,
          kind,
          ...(kind === "text" ? { text } : { latitude: 0, longitude: 0 }),
        },
        now,
      );
    event(
      1,
      "text",
      "solicitar licencia 31/02/2026 01/03/2026 | Vacaciones | Viaje familiar",
    );
    event(2, "location");
    event(3, "text", "entrada");
    event(4, "location");
    processTelegramInbox(s, () => now + 1000);
    assert.deepEqual(
      s
        .all("SELECT update_id,status FROM telegram_inbox ORDER BY update_id")
        .map((x) => x.status),
      ["rejected", "processed", "processed", "processed"],
    );
    assert.equal(s.all("SELECT * FROM visits").length, 0);
    assert.equal(s.all("SELECT * FROM telegram_outbox").length, 4);
  } finally {
    s.db.close();
  }
});

test("reply persistence failure rolls back sender state and replays without attendance", () => {
  const s = fixture();
  try {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const { code } = issueLinkCode(s, "e", "hr", now);
    consumeLinkCode(s, hashLinkCode(code), "8", "8", now);
    receiveTelegramUpdate(
      s,
      {
        updateId: 1,
        messageId: 1,
        userId: "8",
        chatId: "8",
        timestamp: now,
        kind: "text",
        text: "entrada",
      },
      now,
    );
    receiveTelegramUpdate(
      s,
      {
        updateId: 2,
        messageId: 2,
        userId: "8",
        chatId: "8",
        timestamp: now,
        kind: "location",
        latitude: 0,
        longitude: 0,
      },
      now,
    );
    s.db.exec(
      "CREATE TRIGGER fail_reply BEFORE INSERT ON telegram_outbox BEGIN SELECT RAISE(ABORT,'synthetic reply failure'); END",
    );
    assert.throws(() => processTelegramInbox(s, () => now + 1000));
    assert.deepEqual(
      s
        .all("SELECT status FROM telegram_inbox ORDER BY update_id")
        .map((row) => row.status),
      ["pending", "pending"],
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM visits").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM employee_bot_results").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM bot_pending").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_sender_state").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
    s.db.exec("DROP TRIGGER fail_reply");
    processTelegramInbox(s, () => now + 1000);
    processTelegramInbox(s, () => now + 1000);
    assert.equal(s.one("SELECT COUNT(*) n FROM visits").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM employee_bot_results").n, 2);
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 2);
    assert.equal(
      s.one("SELECT COUNT(*) n FROM telegram_inbox WHERE status='processed'").n,
      2,
    );
  } finally {
    s.db.close();
  }
});
