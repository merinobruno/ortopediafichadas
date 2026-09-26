import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  receiveEmployeeMessage,
  simulateEmployeeText,
  simulateEmployeeMessage,
} from "../server/employee-bot";

const now = Date.parse("2026-09-15T15:00:00Z");
function setup() {
  const s = new Store(":memory:");
  s.db
    .exec(`INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('s','Central','Address',-34,-58,100);
    INSERT INTO employees(id,name,role,site_ids,active) VALUES('e','Employee','Staff','["s"]',1);
    INSERT INTO visits VALUES('v','e','s','2026-09-15T12:00:00.000Z',NULL,'open','simulator');`);
  return s;
}
const message = (id: string, text: string, timestamp = now) => ({
  id,
  employeeId: "e",
  kind: "text" as const,
  text,
  timestamp,
});

test("Telegram pause and finish are idempotent and audited with employee identity", () => {
  const s = setup();
  try {
    receiveEmployeeMessage(s, message("p", "pausa"), "telegram", now);
    receiveEmployeeMessage(s, message("p", "pausa"), "telegram", now);
    assert.equal(s.one("SELECT COUNT(*) n FROM breaks").n, 1);
    assert.throws(() =>
      receiveEmployeeMessage(
        s,
        message("early", "finpausa", now - 1000),
        "telegram",
        now,
      ),
    );
    receiveEmployeeMessage(
      s,
      message("end", "finpausa", now + 1000),
      "telegram",
      now + 1000,
    );
    assert.equal(s.one("SELECT status FROM breaks").status, "complete");
    assert.equal(
      s.one("SELECT COUNT(*) n FROM audit WHERE reason='Employee bot pause'").n,
      2,
    );
  } finally {
    s.db.close();
  }
});

test("leave request validates civil dates and remains pending", () => {
  const s = setup();
  try {
    assert.throws(() =>
      receiveEmployeeMessage(
        s,
        message(
          "bad",
          "solicitar licencia 31/02/2026 01/03/2026 | Vacaciones | Viaje familiar",
        ),
        "telegram",
        now,
      ),
    );
    const reply = receiveEmployeeMessage(
      s,
      message(
        "leave",
        "solicitar licencia 17/09/2026 18/09/2026 | Vacaciones | Viaje familiar",
      ),
      "telegram",
      now,
    );
    assert.match(reply, /pendiente/);
    assert.equal(s.one("SELECT status FROM leaves").status, "pending");
  } finally {
    s.db.close();
  }
});

test("simulator pending intent is separate from Telegram and has no provider queues", () => {
  const s = setup();
  try {
    receiveEmployeeMessage(s, message("entry", "entrada"), "telegram", now);
    assert.equal(
      s.one("SELECT key FROM bot_pending WHERE key='telegram:e'")?.key,
      "telegram:e",
    );
    simulateEmployeeText(s, "e", "cancelar", "hr", now);
    assert.equal(
      s.one("SELECT key FROM bot_pending WHERE key='telegram:e'")?.key,
      "telegram:e",
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_inbox").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  } finally {
    s.db.close();
  }
});

test("future stale and inactive messages cannot mutate HR records", () => {
  const s = setup();
  try {
    assert.throws(() =>
      receiveEmployeeMessage(
        s,
        message("future", "pausa", now + 1),
        "telegram",
        now,
      ),
    );
    assert.throws(() =>
      receiveEmployeeMessage(
        s,
        message("old", "pausa", now - 16 * 60000),
        "telegram",
        now,
      ),
    );
    s.db.prepare("UPDATE employees SET active=0 WHERE id='e'").run();
    assert.throws(() =>
      receiveEmployeeMessage(s, message("inactive", "pausa"), "telegram", now),
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM breaks").n, 0);
  } finally {
    s.db.close();
  }
});

test("local text and location finish a separate attendance conversation", () => {
  const s = setup();
  try {
    s.db
      .prepare(
        "UPDATE visits SET status='complete',exit_at='2026-09-15T14:00:00Z' WHERE id='v'",
      )
      .run();
    simulateEmployeeText(s, "e", "entrada", "hr", now);
    simulateEmployeeMessage(
      s,
      "e",
      { kind: "location", latitude: -34, longitude: -58 },
      "hr",
      now + 1000,
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM visits").n, 2);
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  } finally {
    s.db.close();
  }
});
