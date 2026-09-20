import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { processInbox, sendOutbox } from "../server/whatsapp";
const setup = () => {
  const s = new Store(":memory:");
  s.db
    .prepare(
      "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('a','A','A',-34,-58,100)",
    )
    .run();
  s.db
    .prepare(
      "INSERT INTO employees(id,name,phone,role,site_ids) VALUES('e','Employee','5491100000001','Staff','[\"a\"]')",
    )
    .run();
  return s;
};
const put = (s: Store, id: string, type: string, content: any) =>
  s.db.prepare("INSERT INTO inbox VALUES(?,?,'pending',NULL,?)").run(
    id,
    JSON.stringify({
      id,
      from: "5491100000001",
      timestamp: String(Math.floor(Date.now() / 1000)),
      type,
      ...content,
    }),
    new Date().toISOString(),
  );
test("worker restart resumes pending message and replay preserves a single effect", () => {
  const s = setup();
  put(s, "intent", "text", { text: { body: "entrada" } });
  processInbox(s);
  put(s, "location", "location", {
    location: { latitude: -34, longitude: -58 },
  });
  processInbox(s);
  processInbox(s);
  assert.equal(s.all("SELECT * FROM visits").length, 1);
  assert.equal(s.all("SELECT * FROM outbox").length, 2);
  assert.equal(
    s.one("SELECT status FROM inbox WHERE id='location'").status,
    "processed",
  );
});
test("outbox persistence failure rolls attendance and pending consumption back", () => {
  const s = setup();
  put(s, "intent", "text", { text: { body: "entrada" } });
  processInbox(s);
  put(s, "location", "location", {
    location: { latitude: -34, longitude: -58 },
  });
  s.db.exec(
    "CREATE TRIGGER break_outbox BEFORE INSERT ON outbox WHEN NEW.id='location' BEGIN SELECT RAISE(ABORT,'disk failure'); END",
  );
  processInbox(s);
  assert.equal(s.all("SELECT * FROM visits").length, 0);
  assert.equal(s.all("SELECT * FROM pending").length, 1);
  assert.equal(
    s.one("SELECT status FROM inbox WHERE id='location'").status,
    "pending",
  );
  s.db.exec("DROP TRIGGER break_outbox");
  processInbox(s);
  assert.equal(s.all("SELECT * FROM visits").length, 1);
});
test("sender is disabled without explicit enable and records provider acceptance separately", async () => {
  const s = setup();
  put(s, "intent", "text", { text: { body: "entrada" } });
  processInbox(s);
  let calls = 0;
  const fake = async () => {
    calls++;
    return new Response(JSON.stringify({ messages: [{ id: "provider1" }] }), {
      status: 200,
    });
  };
  await sendOutbox(s, fake as typeof fetch, {});
  assert.equal(calls, 0);
  await sendOutbox(s, fake as typeof fetch, {
    WHATSAPP_SEND_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "test",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_API_VERSION: "v23.0",
  });
  assert.equal(calls, 1);
  assert.equal(s.one("SELECT * FROM outbox").status, "accepted");
  assert.equal(s.one("SELECT * FROM outbox").provider_id, "provider1");
});
test("expired messaging window is never sent", async () => {
  const s = setup();
  s.db
    .prepare(
      "INSERT INTO outbox(id,phone,text,status,created_at,window_until) VALUES('o','123','hello','queued',?,?)",
    )
    .run(new Date().toISOString(), "2020-01-01T00:00:00.000Z");
  let calls = 0;
  await sendOutbox(
    s,
    (async () => {
      calls++;
      throw new Error();
    }) as typeof fetch,
    {
      WHATSAPP_SEND_ENABLED: "true",
      WHATSAPP_ACCESS_TOKEN: "test",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
    },
  );
  assert.equal(calls, 0);
  assert.equal(s.one("SELECT * FROM outbox").status, "expired");
});

test("sender rechecks reply window before each network request in a batch", async () => {
  const s = setup();
  let now = Date.now();
  for (const id of ["a", "b"])
    s.db
      .prepare(
        "INSERT INTO outbox(id,phone,text,status,created_at,window_until) VALUES(?, '123','hello','queued',?,?)",
      )
      .run(id, new Date(now).toISOString(), new Date(now + 100).toISOString());
  let calls = 0;
  const fake = async () => {
    calls++;
    now += 200;
    return new Response(JSON.stringify({ messages: [{ id: "p" }] }), {
      status: 200,
    });
  };
  await sendOutbox(
    s,
    fake as typeof fetch,
    {
      WHATSAPP_SEND_ENABLED: "true",
      WHATSAPP_ACCESS_TOKEN: "test",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
    },
    () => now,
  );
  assert.equal(calls, 1);
  assert.equal(
    s.one("SELECT status FROM outbox WHERE id='b'").status,
    "expired",
  );
});

test("sender finishes in-flight request then stops before another row", async () => {
  const s = setup();
  let stop = false;
  let finish!: (v: Response) => void;
  for (const id of ["drain-a", "drain-b"])
    s.db
      .prepare(
        "INSERT INTO outbox(id,phone,text,status,created_at,window_until) VALUES(?,'123','hello','queued',?,?)",
      )
      .run(
        id,
        new Date().toISOString(),
        new Date(Date.now() + 60000).toISOString(),
      );
  let calls = 0;
  const task = sendOutbox(
    s,
    (() => {
      calls++;
      return new Promise<Response>((r) => (finish = r));
    }) as typeof fetch,
    {
      WHATSAPP_SEND_ENABLED: "true",
      WHATSAPP_ACCESS_TOKEN: "test",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
    },
    Date.now,
    () => stop,
  );
  stop = true;
  finish(
    new Response(JSON.stringify({ messages: [{ id: "accepted" }] }), {
      status: 200,
    }),
  );
  await task;
  assert.equal(calls, 1);
  assert.equal(
    s.one("SELECT status FROM outbox WHERE id='drain-a'").status,
    "accepted",
  );
  assert.equal(
    s.one("SELECT status FROM outbox WHERE id='drain-b'").status,
    "queued",
  );
  s.db.close();
});
