import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Store } from "../server/store";
import { createApp } from "../server/app";
test("admin requires session and signed webhook durably deduplicates messages", async () => {
  process.env.ADMIN_PASSWORD = "test-password-123";
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  const s = new Store(":memory:");
  const server = createApp(s).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const address = server.address() as any;
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(url + "/api/state")).status, 401);
    const login = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password-123" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    assert.equal(
      (await fetch(url + "/api/state", { headers: { cookie } })).status,
      200,
    );
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wa1",
                    from: "5491100000001",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "presente" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(
      (
        await fetch(url + "/webhook/whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: raw,
        })
      ).status,
      401,
    );
    const signature =
      "sha256=" + createHmac("sha256", "test-secret").update(raw).digest("hex");
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await fetch(url + "/webhook/whatsapp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-hub-signature-256": signature,
            },
            body: raw,
          })
        ).status,
        200,
      );
    assert.equal(s.all("SELECT * FROM inbox").length, 1);
  } finally {
    server.close();
  }
});
