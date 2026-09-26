import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  saveTemplate,
  saveCampaign,
  prepareCampaign,
  previewCampaign,
  archiveTemplate,
  onboardingPreview,
} from "../server/communications";
const template = {
  name: "Welcome",
  description: "Local text",
  type: "circular",
  order: 0,
  subject: "Hola {{nombre}}",
  body: "<script>literal</script> {{sedes}}",
  variables: ["nombre", "sedes"],
  requires_signature: false,
};
function setup() {
  const s = new Store(":memory:");
  s.db.exec(
    `INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('s','Central','Address',0,0,100);INSERT INTO employees VALUES('e','Ana','Staff','["s"]',1),('off','Inactive','Staff','["s"]',0);INSERT INTO taxonomy VALUES('sector','sector','Team');INSERT INTO employee_tags VALUES('e','sector'),('off','sector');`,
  );
  return s;
}
const draft = {
  type: "circular",
  channel: "telegram",
  requires_signature: false,
  subject: "Hola {{nombre}}",
  body: "<b>{{nombre}}</b>",
  variables: ["nombre"],
  selection: { mode: "individual", employee_ids: ["e", "e"], sector_id: null },
};
test("immutable local template revisions validate variables and archive with audit", () => {
  const s = setup();
  const a = saveTemplate(s, template, "hr");
  saveTemplate(
    s,
    {
      ...template,
      id: a.id,
      expected_revision: 1,
      subject: "Nuevo {{nombre}}",
    },
    "hr",
  );
  assert.equal(
    s.one("SELECT COUNT(*) n FROM communication_template_revisions").n,
    2,
  );
  assert.throws(() =>
    saveTemplate(s, { ...template, id: a.id, expected_revision: 1 }, "hr"),
  );
  assert.throws(() =>
    saveTemplate(s, { ...template, body: "{{secret}}" }, "hr"),
  );
  assert.throws(() => saveTemplate(s, { ...template, variables: [] }, "hr"));
  archiveTemplate(s, a.id, true, "hr");
  assert.equal(
    s.one("SELECT archived FROM communication_templates").archived,
    1,
  );
  assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  s.db.close();
});
test("preparation deduplicates and freezes renders without phone data or sending", () => {
  const s = setup();
  const c = saveCampaign(s, draft, "hr");
  const preview = previewCampaign(s, c.id);
  assert.equal(preview.recipients.length, 1);
  assert.equal(preview.recipients[0].body, "<b>Ana</b>");
  assert.equal(preview.recipients[0].body_escaped, "&lt;b&gt;Ana&lt;/b&gt;");
  const p = prepareCampaign(s, c.id, 1, "hr");
  assert.equal(prepareCampaign(s, c.id, 1, "hr").id, p.id);
  s.db.exec("UPDATE employees SET name='Changed' WHERE id='e'");
  assert.equal(
    JSON.parse(
      s.one("SELECT snapshot_json FROM communication_preparations")
        .snapshot_json,
    ).recipients[0].name,
    "Ana",
  );
  saveCampaign(
    s,
    { ...draft, id: c.id, expected_revision: 1, subject: "Updated" },
    "hr",
  );
  assert.equal(
    s.one("SELECT preparation_id FROM communication_campaigns").preparation_id,
    null,
  );
  assert.equal(
    s.one("SELECT status FROM communication_campaigns").status,
    "draft",
  );
  assert.equal(s.one("SELECT COUNT(*) n FROM communication_preparations").n, 1);
  assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  s.db.close();
});
test("inactive explicit recipients and unsupported provider approval are rejected; sector selection omits inactive", () => {
  const s = setup();
  assert.throws(() => saveCampaign(s, { ...draft, status: "approved" }, "hr"));
  let c = saveCampaign(
    s,
    {
      ...draft,
      selection: { mode: "individual", employee_ids: ["off"], sector_id: null },
    },
    "hr",
  );
  assert.throws(() => prepareCampaign(s, c.id, 1, "hr"));
  c = saveCampaign(
    s,
    {
      ...draft,
      selection: { mode: "sector", employee_ids: [], sector_id: "sector" },
    },
    "hr",
  );
  assert.equal(previewCampaign(s, c.id).recipients.length, 1);
  assert.throws(() =>
    saveCampaign(
      s,
      {
        ...draft,
        selection: {
          mode: "individual",
          employee_ids: ["missing"],
          sector_id: null,
        },
      },
      "hr",
    ),
  );
  s.db.close();
});
test("onboarding previews authorized sites and never imply identity verification", () => {
  const s = setup();
  const p = onboardingPreview(s, "e");
  assert.ok(p.text.includes("Central"));
  assert.ok(p.text.includes("salida desconocida"));
  assert.equal(p.identity_verified, false);
  assert.equal(p.dispatch_available, false);
  assert.match(p.text, /Telegram/);
  s.db.close();
});

import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
import { readConfig } from "../server/config";
test("audit failure rolls template campaign and preparation writes back atomically", () => {
  const s = setup();
  const c = saveCampaign(s, draft, "hr");
  s.db.exec(
    "CREATE TRIGGER fail_communications_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'forced'); END",
  );
  assert.throws(() => saveTemplate(s, template, "hr"));
  assert.equal(s.one("SELECT COUNT(*) n FROM communication_templates").n, 0);
  assert.throws(() =>
    saveCampaign(
      s,
      { ...draft, id: c.id, expected_revision: 1, subject: "Updated" },
      "hr",
    ),
  );
  assert.equal(
    s.one("SELECT revision FROM communication_campaigns").revision,
    1,
  );
  assert.throws(() => prepareCampaign(s, c.id, 1, "hr"));
  assert.equal(s.one("SELECT COUNT(*) n FROM communication_preparations").n, 0);
  assert.equal(
    s.one("SELECT status FROM communication_campaigns").status,
    "draft",
  );
  assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  s.db.close();
});
test("communications APIs require admin or HR including previews and history; provider status cannot be claimed", async () => {
  process.env.ADMIN_PASSWORD = "Communications-admin-123";
  const s = setup();
  const app = createApp(s);
  for (const role of ["hr", "supervisor"])
    upsertUser(
      s,
      {
        email: role + "@example.test",
        name: role,
        password: "Communications-pass-123",
        role,
        active: true,
        employee_ids: role === "supervisor" ? ["e"] : [],
      },
      "admin",
    );
  const c = saveCampaign(s, draft, "admin"),
    t = saveTemplate(s, template, "admin");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    assert.equal((await fetch(url + "/api/communications")).status, 401);
    const login = async (role: string) => {
      const r = await fetch(url + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: role + "@example.test",
          password: "Communications-pass-123",
        }),
      });
      return r.headers.get("set-cookie")!;
    };
    const supervisor = await login("supervisor");
    for (const path of [
      "",
      `/templates/${t.id}/revisions`,
      `/drafts/${c.id}/preview`,
      `/drafts/${c.id}/preparations`,
      "/onboarding/e",
    ])
      assert.equal(
        (
          await fetch(url + "/api/communications" + path, {
            headers: { cookie: supervisor },
          })
        ).status,
        403,
        path,
      );
    for (const path of [
      "/templates",
      "/drafts",
      `/drafts/${c.id}/prepare`,
      `/templates/${t.id}/archive`,
    ])
      assert.equal(
        (
          await fetch(url + "/api/communications" + path, {
            method: "POST",
            headers: { cookie: supervisor, "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        403,
        path,
      );
    const hr = await login("hr"),
      headers = { cookie: hr, "Content-Type": "application/json" };
    assert.equal(
      (await fetch(url + "/api/communications", { headers })).status,
      200,
    );
    assert.equal(
      (
        await fetch(url + "/api/communications/drafts", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...draft, provider_approved: true }),
        })
      ).status,
      400,
    );
    const prepared = await fetch(
      url + `/api/communications/drafts/${c.id}/prepare`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ expected_revision: 1 }),
      },
    );
    assert.equal(prepared.status, 200);
    const history = await (
      await fetch(url + `/api/communications/drafts/${c.id}/preparations`, {
        headers,
      })
    ).json();
    assert.equal(history[0].actor, "hr@example.test");
    assert.equal(history[0].snapshot.provider_approved, false);
    assert.equal(history[0].snapshot.dispatch_available, false);
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});
test("Telegram configuration requires both secrets before enabling outbound", () => {
  assert.throws(() => readConfig({ TELEGRAM_SEND_ENABLED: "true" }));
  assert.doesNotThrow(() =>
    readConfig({
      TELEGRAM_SEND_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_WEBHOOK_SECRET: "secret",
    }),
  );
  const s = setup();
  assert.match(onboardingPreview(s, "e").text, /Telegram/);
  s.db.close();
});
