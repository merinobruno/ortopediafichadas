import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  receiveEmployeeMessage,
  simulateEmployeeText,
} from "../server/employee-bot";
import { processInbox } from "../server/whatsapp";
const now = Date.parse("2026-09-15T15:00:00Z"),
  phone = "5491100000001";
function setup() {
  const s = new Store(":memory:");
  s.db.exec(
    `INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('s','Central','Address',-34,-58,100);INSERT INTO employees VALUES('e','Employee','${phone}','Staff','["s"]',1);INSERT INTO visits VALUES('v','e','s','2026-09-15T12:00:00.000Z',NULL,'open','simulator')`,
  );
  return s;
}
const message = (id: string, text: string, time = now) => ({
  id,
  from: phone,
  type: "text",
  text: { body: text },
  timestamp: String(time / 1000),
});
test("pause and finish use employee identity and chronology with idempotent audited results", () => {
  const s = setup();
  receiveEmployeeMessage(s, message("p", "pausa"), "whatsapp", now);
  receiveEmployeeMessage(s, message("p", "pausa"), "whatsapp", now);
  assert.equal(s.one("SELECT COUNT(*) n FROM breaks").n, 1);
  assert.throws(() =>
    receiveEmployeeMessage(
      s,
      message("end", "finpausa", now - 1000),
      "whatsapp",
      now,
    ),
  );
  receiveEmployeeMessage(
    s,
    message("end", "finpausa", now + 1000),
    "whatsapp",
    now + 1000,
  );
  assert.equal(s.one("SELECT status FROM breaks").status, "complete");
  assert.throws(() =>
    receiveEmployeeMessage(
      s,
      message("old", "pausa", now),
      "whatsapp",
      now + 2000,
    ),
  );
  assert.equal(
    JSON.parse(
      s.one("SELECT after_json FROM audit WHERE reason='Employee bot pause'")
        .after_json,
    ).employee_id,
    "e",
  );
  s.db.close();
});
test("one-message leave validates civil dates and remains pending without accepting other employee or approval", () => {
  const s = setup();
  const request =
    "solicitar licencia 28/02/2028 29/02/2028 | Vacaciones anuales | Viaje familiar confirmado";
  receiveEmployeeMessage(s, message("l", request), "whatsapp", now);
  receiveEmployeeMessage(s, message("l", request), "whatsapp", now);
  const leave = s.one("SELECT * FROM leaves");
  assert.equal(leave.status, "pending");
  assert.equal(leave.employee_id, "e");
  assert.equal(leave.type, "Vacaciones anuales");
  assert.equal(leave.date_to, "2028-02-29");
  for (const text of [
    "solicitar licencia 29/02/2027 01/03/2027 | Tipo | Motivo largo",
    "solicitar licencia 20/09/2026 19/09/2026 | Tipo | Motivo largo",
  ])
    assert.throws(() =>
      receiveEmployeeMessage(s, message(text, text), "whatsapp", now),
    );
  receiveEmployeeMessage(
    s,
    message("approval", "aprobar licencia " + leave.id),
    "whatsapp",
    now,
  );
  assert.equal(s.one("SELECT status FROM leaves").status, "pending");
  assert.equal(s.one("SELECT COUNT(*) n FROM leaves").n, 1);
  s.db.close();
});
test("pending attendance is preserved by HR commands and simulation cannot consume real intent", () => {
  const s = setup();
  receiveEmployeeMessage(s, message("entry", "entrada"), "whatsapp", now);
  const before = s.one("SELECT * FROM pending");
  assert.throws(() =>
    receiveEmployeeMessage(s, message("pause", "pausa"), "whatsapp", now),
  );
  assert.deepEqual(s.one("SELECT * FROM pending"), before);
  simulateEmployeeText(s, phone, "cancelar", "admin", now);
  assert.deepEqual(s.one("SELECT * FROM pending"), before);
  simulateEmployeeText(s, phone, "pausa", "admin", now);
  assert.deepEqual(s.one("SELECT * FROM pending"), before);
  assert.equal(s.one("SELECT COUNT(*) n FROM outbox").n, 0);
  assert.equal(s.one("SELECT COUNT(*) n FROM inbox").n, 0);
  receiveEmployeeMessage(s, message("cancel", "cancelar"), "whatsapp", now);
  assert.equal(s.one("SELECT COUNT(*) n FROM pending").n, 0);
  assert.equal(s.one("SELECT status FROM breaks").status, "open");
  s.db.close();
});
test("future stale unknown and inactive messages cannot mutate HR records", () => {
  const s = setup();
  for (const m of [
    message("future", "pausa", now + 1),
    message("stale", "pausa", now - 900001),
    { ...message("unknown", "pausa"), from: "5491100000099" },
  ])
    assert.throws(() => receiveEmployeeMessage(s, m, "whatsapp", now));
  s.db.exec("UPDATE employees SET active=0 WHERE id='e'");
  assert.throws(() =>
    receiveEmployeeMessage(s, message("inactive", "pausa"), "whatsapp", now),
  );
  assert.equal(s.one("SELECT COUNT(*) n FROM breaks").n, 0);
  s.db.close();
});

test("exact overlapping site named Pausa wins over command and keeps original location time", () => {
  const s = setup();
  s.db.exec(
    `INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('p','Pausa','Address',-34,-58,100);UPDATE employees SET site_ids='["s","p"]'`,
  );
  receiveEmployeeMessage(s, message("entry", "entrada"), "whatsapp", now);
  receiveEmployeeMessage(
    s,
    {
      ...message("loc", "", now),
      type: "location",
      location: { latitude: -34, longitude: -58 },
    },
    "whatsapp",
    now,
  );
  assert.ok(s.one("SELECT location_json FROM pending").location_json);
  receiveEmployeeMessage(
    s,
    message("choose", "Pausa", now + 1000),
    "whatsapp",
    now + 1000,
  );
  assert.equal(
    s.one("SELECT site_id FROM visits WHERE status='open'").site_id,
    "p",
  );
  assert.equal(
    s.one("SELECT entry_at FROM visits WHERE status='open'").entry_at,
    new Date(now).toISOString(),
  );
  assert.equal(s.one("SELECT COUNT(*) n FROM breaks").n, 0);
  assert.equal(s.one("SELECT COUNT(*) n FROM pending").n, 0);
  s.db.close();
});
test("future provider entry and location are rejected and leave pending unchanged", () => {
  const s = setup();
  s.db.exec("DELETE FROM visits");
  assert.throws(() =>
    receiveEmployeeMessage(
      s,
      message("future-entry", "entrada", now + 1),
      "whatsapp",
      now,
    ),
  );
  assert.equal(s.one("SELECT COUNT(*) n FROM pending").n, 0);
  receiveEmployeeMessage(s, message("entry", "entrada"), "whatsapp", now);
  const before = s.one("SELECT * FROM pending");
  assert.throws(() =>
    receiveEmployeeMessage(
      s,
      {
        ...message("future-location", "", now + 1),
        type: "location",
        location: { latitude: -34, longitude: -58 },
      },
      "whatsapp",
      now,
    ),
  );
  assert.deepEqual(s.one("SELECT * FROM pending"), before);
  assert.equal(s.one("SELECT COUNT(*) n FROM visits").n, 0);
  s.db.close();
});
test("pause and leave rollback with failed outbox and replay applies exactly once with event and receipt times", () => {
  for (const command of [
    "pausa",
    "solicitar licencia 17/09/2026 18/09/2026 | Vacaciones | Viaje familiar",
  ]) {
    const s = setup();
    const m = message("business:message", command, now - 1000);
    s.db
      .prepare("INSERT INTO inbox VALUES(?,?,'pending',NULL,?)")
      .run(m.id, JSON.stringify(m), new Date(now).toISOString());
    s.db.exec(
      "CREATE TRIGGER fail_bot_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    processInbox(s, () => now);
    assert.equal(s.one("SELECT COUNT(*) n FROM breaks").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM leaves").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM employee_bot_results").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM audit").n, 0);
    assert.equal(s.one("SELECT status FROM inbox").status, "pending");
    s.db.exec("DROP TRIGGER fail_bot_outbox");
    processInbox(s, () => now);
    s.db.exec("UPDATE inbox SET status='pending'");
    processInbox(s, () => now);
    assert.equal(s.one("SELECT COUNT(*) n FROM outbox").n, 1);
    assert.equal(s.one("SELECT COUNT(*) n FROM employee_bot_results").n, 1);
    assert.equal(s.one("SELECT COUNT(*) n FROM audit").n, 1);
    assert.equal(
      s.one("SELECT time FROM employee_bot_results").time,
      new Date(now - 1000).toISOString(),
    );
    assert.equal(
      s.one("SELECT received_at FROM employee_bot_results").received_at,
      new Date(now).toISOString(),
    );
    assert.equal(
      s.one(
        "SELECT COUNT(*) n FROM " + (command === "pausa" ? "breaks" : "leaves"),
      ).n,
      1,
    );
    s.db.close();
  }
});
import { simulateEmployeeMessage } from "../server/employee-bot";
test("local text and location complete their own conversation without touching provider intent or queues", () => {
  const s = setup();
  s.db.exec("DELETE FROM visits");
  receiveEmployeeMessage(s, message("real", "salida"), "whatsapp", now);
  const real = s.one("SELECT * FROM pending WHERE phone=?", phone);
  simulateEmployeeText(s, phone, "entrada", "hr", now);
  simulateEmployeeMessage(
    s,
    phone,
    { type: "location", location: { latitude: -34, longitude: -58 } },
    "hr",
    now + 1000,
  );
  assert.equal(s.one("SELECT source FROM visits").source, "simulator");
  assert.deepEqual(s.one("SELECT * FROM pending WHERE phone=?", phone), real);
  assert.equal(
    s.one("SELECT COUNT(*) n FROM pending WHERE phone LIKE 'simulator:%'").n,
    0,
  );
  assert.equal(s.one("SELECT COUNT(*) n FROM outbox").n, 0);
  assert.equal(s.one("SELECT COUNT(*) n FROM inbox").n, 0);
  s.db.close();
});
import { applyAction } from "../server/domain";
test("attendance cannot move or exit before pause boundaries and unknown endings remain manual", () => {
  const s = setup();
  receiveEmployeeMessage(s, message("p", "pausa"), "whatsapp", now);
  s.db.exec(
    `INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('b','B','Address',1,1,100);UPDATE employees SET site_ids='["s","b"]'`,
  );
  assert.throws(() =>
    applyAction(s, {
      id: "back",
      phone,
      action: "entry",
      siteId: "b",
      lat: 1,
      lon: 1,
      time: new Date(now - 1000).toISOString(),
      source: "whatsapp",
    }),
  );
  receiveEmployeeMessage(
    s,
    message("f", "finpausa", now + 1000),
    "whatsapp",
    now + 1000,
  );
  assert.throws(() =>
    applyAction(s, {
      id: "exit",
      phone,
      action: "exit",
      siteId: "s",
      lat: -34,
      lon: -58,
      time: new Date(now).toISOString(),
      source: "whatsapp",
    }),
  );
  s.db.exec("UPDATE breaks SET status='end_unknown',ended_at=NULL");
  assert.throws(() =>
    receiveEmployeeMessage(
      s,
      message("new", "pausa", now + 2000),
      "whatsapp",
      now + 2000,
    ),
  );
  assert.equal(s.one("SELECT ended_at FROM breaks").ended_at, null);
  s.db.close();
});

import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
test("local simulator endpoints enforce HR/admin permissions and no provider queue; HTTP leave shares pending-only service", async () => {
  process.env.ADMIN_PASSWORD = "Bot-admin-password-123";
  const s = setup(),
    app = createApp(s);
  upsertUser(
    s,
    {
      email: "supervisor@example.test",
      name: "Supervisor",
      password: "Supervisor-password-123",
      role: "supervisor",
      active: true,
      employee_ids: ["e"],
    },
    "admin",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    const login = async (email: string, password: string) => {
      const r = await fetch(url + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return r.headers.get("set-cookie")!;
    };
    const supervisor = await login(
      "supervisor@example.test",
      "Supervisor-password-123",
    );
    for (const path of ["/simulate/text", "/simulate/location"])
      assert.equal(
        (
          await fetch(url + "/api" + path, {
            method: "POST",
            headers: { cookie: supervisor, "Content-Type": "application/json" },
            body: JSON.stringify({ phone, text: "pausa" }),
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await fetch(url + "/api/simulate/text/e", {
          headers: { cookie: supervisor },
        })
      ).status,
      403,
    );
    const admin = await login("admin@carahue.local", "Bot-admin-password-123");
    const headers = { cookie: admin, "Content-Type": "application/json" };
    const r = await fetch(url + "/api/simulate/text", {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, text: "pausa" }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).source, "simulator");
    const history = await (
      await fetch(url + "/api/simulate/text/e", { headers })
    ).json();
    assert.equal(history.length, 1);
    assert.equal(history[0].input_text, "pausa");
    assert.equal(s.one("SELECT COUNT(*) n FROM outbox").n, 0);
    assert.equal(s.one("SELECT COUNT(*) n FROM inbox").n, 0);
    const request = {
      employee_id: "e",
      type: "Vacaciones",
      date_from: "2026-09-20",
      date_to: "2026-09-21",
      reason: "Solicitud por vacaciones",
    };
    assert.equal(
      (
        await fetch(url + "/api/leaves", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...request, status: "approved" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(url + "/api/leaves", {
          method: "POST",
          headers,
          body: JSON.stringify(request),
        })
      ).status,
      200,
    );
    assert.equal(s.one("SELECT status FROM leaves").status, "pending");
    assert.equal(
      JSON.parse(
        s.one(
          "SELECT after_json FROM audit WHERE reason='Leave requested; pending review'",
        ).after_json,
      ).source,
      "hr",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});
test("provider body cannot request leave for another employee and ayuda preserves pending", () => {
  const s = setup();
  receiveEmployeeMessage(
    s,
    {
      ...message(
        "leave",
        "solicitar licencia 20/09/2026 21/09/2026 | Vacaciones | Viaje familiar",
      ),
      employee_id: "someone-else",
    },
    "whatsapp",
    now,
  );
  assert.equal(s.one("SELECT employee_id FROM leaves").employee_id, "e");
  receiveEmployeeMessage(s, message("entry", "entrada"), "whatsapp", now);
  const before = s.one("SELECT * FROM pending");
  const help = receiveEmployeeMessage(
    s,
    message("help", "ayuda"),
    "whatsapp",
    now,
  );
  assert.ok(help.includes("finpausa"));
  assert.deepEqual(s.one("SELECT * FROM pending"), before);
  s.db.close();
});

test("provider messages with missing or invalid timestamps do not fall back to receipt time", () => {
  const s = setup();
  for (const timestamp of [undefined, "not-a-date", NaN, Infinity])
    assert.throws(() =>
      receiveEmployeeMessage(
        s,
        { ...message("bad-" + String(timestamp), "pausa"), timestamp },
        "whatsapp",
        now,
      ),
    );
  assert.equal(s.one("SELECT COUNT(*) n FROM breaks").n, 0);
  assert.equal(s.one("SELECT COUNT(*) n FROM employee_bot_results").n, 0);
  s.db.close();
});
