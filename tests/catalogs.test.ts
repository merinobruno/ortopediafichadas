import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  createCatalog,
  editCatalog,
  listCatalog,
  migrateCatalogs,
  setEmployeeAssociation,
  setSiteCategory,
} from "../server/catalogs";
test("exact category migration is idempotent and archived links remain while new links are rejected", () => {
  const s = new Store(":memory:");
  try {
    s.db.exec(
      "INSERT INTO sites VALUES('s','Site','Address',0,0,100,'Exact Label',1),('b','Other','Address',0,0,100,'',1)",
    );
    migrateCatalogs(s);
    migrateCatalogs(s);
    assert.equal(
      s.one("SELECT COUNT(*) n FROM taxonomy WHERE kind='category'").n,
      1,
    );
    const c = listCatalog(s, "category")[0];
    assert.equal(
      s.one("SELECT category_id FROM site_categories WHERE site_id=?", "s")
        .category_id,
      c.id,
    );
    editCatalog(
      s,
      "category",
      c.id,
      { expected_revision: 1, reason: "Rename exact label", name: "New label" },
      "hr",
    );
    assert.equal(
      s.one("SELECT category FROM sites WHERE id='s'").category,
      "Exact Label",
    );
    editCatalog(
      s,
      "category",
      c.id,
      { expected_revision: 2, reason: "Archive old label", archive: true },
      "hr",
    );
    setSiteCategory(s, "s", c.id);
    assert.throws(() => setSiteCategory(s, "b", c.id));
    assert.throws(
      () =>
        editCatalog(
          s,
          "category",
          c.id,
          { expected_revision: 2, reason: "Stale update label", name: "Bad" },
          "hr",
        ),
      (e: any) => e.status === 409,
    );
  } finally {
    s.db.close();
  }
});
test("association removal and catalog updates are audited atomically without deleting history", () => {
  const s = new Store(":memory:");
  try {
    s.db.exec(
      "INSERT INTO employees(id,name,role) VALUES('e','Synthetic','123')",
    );
    const c = createCatalog(s, "sector", { name: "Synthetic sector" }, "hr");
    setEmployeeAssociation(
      s,
      "e",
      c.id,
      true,
      "Confirmed sector assignment",
      "hr",
    );
    editCatalog(
      s,
      "sector",
      c.id,
      { expected_revision: 1, archive: true, reason: "Archive this sector" },
      "hr",
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM employee_tags").n, 1);
    setEmployeeAssociation(s, "e", c.id, false, "Remove old association", "hr");
    assert.equal(s.one("SELECT COUNT(*) n FROM employee_tags").n, 0);
    assert.throws(() =>
      setEmployeeAssociation(
        s,
        "e",
        c.id,
        true,
        "Cannot restore archived",
        "hr",
      ),
    );
    const tag = createCatalog(s, "tag", { name: "Tag" }, "hr");
    s.db.exec(
      "CREATE TRIGGER fail_catalog BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    assert.throws(() =>
      editCatalog(
        s,
        "tag",
        tag.id,
        { expected_revision: 1, reason: "Must roll back", name: "Changed" },
        "hr",
      ),
    );
    assert.equal(listCatalog(s, "tag")[0].name, "Tag");
    assert.equal(listCatalog(s, "tag")[0].revision, 1);
  } finally {
    s.db.close();
  }
});
import { createSchedule, calendar } from "../server/schedules";
import {
  saveCampaign,
  prepareCampaign,
  previewCampaign,
} from "../server/communications";
import {
  configureRule,
  processExceptions,
} from "../server/attendance-exceptions";
import { publicSites } from "../server/catalogs";
test("shift edits and archives preserve dated schedule snapshots and forbid new selections", () => {
  const s = new Store(":memory:");
  try {
    s.db.exec(
      "INSERT INTO employees(id,name,role) VALUES('e','Synthetic','123')",
    );
    const shift = createCatalog(
      s,
      "shift",
      { name: "Morning", start: "09:00", end: "17:00", tolerance: 10 },
      "hr",
    );
    const plan = {
      employee_id: "e",
      date_from: "2026-09-01",
      date_to: "2026-09-15",
      anchor: "2026-09-01",
      cycle: 7,
      slots: Array(7).fill(shift.id),
      reason: "Synthetic planning",
    };
    createSchedule(s, plan, "hr");
    const original = s.one("SELECT slots_json FROM schedules").slots_json;
    editCatalog(
      s,
      "shift",
      shift.id,
      {
        expected_revision: 1,
        reason: "Change future reference",
        name: "Later",
        start: "10:00",
        end: "18:00",
        tolerance: 15,
      },
      "hr",
    );
    editCatalog(
      s,
      "shift",
      shift.id,
      { expected_revision: 2, reason: "Archive reference", archive: true },
      "hr",
    );
    assert.equal(
      s.one("SELECT slots_json FROM schedules").slots_json,
      original,
    );
    assert.throws(() =>
      createSchedule(
        s,
        { ...plan, date_from: "2026-09-16", date_to: "2026-09-30" },
        "hr",
      ),
    );
    assert.equal(
      calendar(s, ["e"], "2026-09-01", "2026-09-01", "2026-10-01T23:00:00Z")[0]
        .status,
      "absent",
    );
  } finally {
    s.db.close();
  }
});
test("association removal changes future previews but never prepared snapshots; archived sector cannot prepare again", () => {
  const s = new Store(":memory:");
  try {
    s.db.exec(
      "INSERT INTO employees(id,name,role) VALUES('e','Synthetic','123')",
    );
    const sector = createCatalog(s, "sector", { name: "Sector" }, "hr");
    setEmployeeAssociation(
      s,
      "e",
      sector.id,
      true,
      "Synthetic assignment",
      "hr",
    );
    const campaign = saveCampaign(
      s,
      {
        type: "circular",
        channel: "telegram",
        requires_signature: false,
        subject: "Hello",
        body: "Synthetic message",
        variables: [],
        selection: { mode: "sector", sector_id: sector.id, employee_ids: [] },
      },
      "hr",
    );
    prepareCampaign(s, campaign.id, 1, "hr");
    const original = s.one(
      "SELECT snapshot_json FROM communication_preparations",
    ).snapshot_json;
    setEmployeeAssociation(
      s,
      "e",
      sector.id,
      false,
      "Remove synthetic membership",
      "hr",
    );
    assert.equal(previewCampaign(s, campaign.id).recipients.length, 0);
    assert.equal(
      s.one("SELECT snapshot_json FROM communication_preparations")
        .snapshot_json,
      original,
    );
    editCatalog(
      s,
      "sector",
      sector.id,
      { expected_revision: 1, reason: "Archive sector now", archive: true },
      "hr",
    );
    assert.throws(() => previewCampaign(s, campaign.id));
    assert.throws(() => prepareCampaign(s, campaign.id, 1, "hr"));
    assert.equal(
      s.one("SELECT snapshot_json FROM communication_preparations")
        .snapshot_json,
      original,
    );
  } finally {
    s.db.close();
  }
});
test("holiday archival and date replacement reconcile expectations without altering visits", () => {
  const s = new Store(":memory:");
  try {
    s.db.exec(
      "INSERT INTO employees(id,name,role) VALUES('e','Synthetic','123')",
    );
    const shift = createCatalog(
      s,
      "shift",
      { name: "Morning", start: "09:00", end: "17:00", tolerance: 10 },
      "hr",
    );
    createSchedule(
      s,
      {
        employee_id: "e",
        date_from: "2026-09-15",
        date_to: "2026-09-16",
        anchor: "2026-09-15",
        cycle: 7,
        slots: Array(7).fill(shift.id),
        reason: "Initial planning",
      },
      "hr",
    );
    const now = "2026-09-15T23:00:00Z";
    const drain = () => {
      for (let i = 0; i < 20 && s.one("SELECT id FROM exception_jobs"); i++)
        processExceptions(s, now, false);
    };
    configureRule(
      s,
      "absent",
      { enabled: true, priority: "normal" },
      "hr",
      now,
    );
    drain();
    assert.equal(
      s.one("SELECT condition FROM attendance_exceptions").condition,
      "active",
    );
    createCatalog(
      s,
      "holiday",
      { day: "2026-09-15", name: "Synthetic holiday" },
      "hr",
    );
    drain();
    assert.equal(
      s.one("SELECT condition FROM attendance_exceptions").condition,
      "resolved",
    );
    editCatalog(
      s,
      "holiday",
      "2026-09-15",
      {
        expected_revision: 1,
        reason: "Correct synthetic date",
        day: "2026-09-16",
        name: "Corrected holiday",
      },
      "hr",
    );
    drain();
    assert.equal(
      s.one("SELECT condition FROM attendance_exceptions").condition,
      "active",
    );
    assert.equal(
      listCatalog(s, "holiday").find((h) => h.id === "2026-09-15").archived,
      1,
    );
    assert.equal(
      calendar(s, ["e"], "2026-09-16", "2026-09-16", now)[0].status,
      "holiday",
    );
    editCatalog(
      s,
      "holiday",
      "2026-09-16",
      {
        expected_revision: 1,
        reason: "Archive destination holiday",
        archive: true,
      },
      "hr",
    );
    assert.notEqual(
      calendar(s, ["e"], "2026-09-16", "2026-09-16", now)[0].status,
      "holiday",
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM visits").n, 0);
    assert.throws(() =>
      createCatalog(
        s,
        "holiday",
        { day: "2026-02-30", name: "Impossible" },
        "hr",
      ),
    );
    assert.throws(() =>
      createCatalog(
        s,
        "holiday",
        { day: "2026-09-15", name: "Duplicate archived" },
        "hr",
      ),
    );
    assert.throws(() =>
      editCatalog(
        s,
        "holiday",
        "2026-09-15",
        {
          expected_revision: 2,
          reason: "Cannot resurrect date",
          name: "Another",
          day: "2026-09-17",
        },
        "hr",
      ),
    );
  } finally {
    s.db.close();
  }
});
test("category labels derive current IDs while immutable legacy text and exact variants survive", () => {
  const s = new Store(":memory:");
  try {
    s.db.exec(
      "INSERT INTO sites VALUES('s','Site','Address',0,0,100,'Label',1),('b','Other','Address',0,0,100,'label',1)",
    );
    migrateCatalogs(s);
    assert.equal(listCatalog(s, "category").length, 2);
    const c = listCatalog(s, "category").find((c) => c.name === "Label");
    editCatalog(
      s,
      "category",
      c.id,
      {
        expected_revision: 1,
        reason: "Rename current category",
        name: "Renamed",
      },
      "hr",
    );
    assert.equal(publicSites(s).find((r) => r.id === "s").category, "Renamed");
    const tag = createCatalog(s, "tag", { name: "Wrong kind" }, "hr");
    assert.throws(() => setSiteCategory(s, "s", tag.id));
    assert.throws(() => setSiteCategory(s, "s", "missing"));
    setSiteCategory(s, "s", null);
    migrateCatalogs(s);
    assert.equal(publicSites(s).find((r) => r.id === "s").category, "");
  } finally {
    s.db.close();
  }
});
import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
test("catalog HTTP preserves revision conflict status and rejects supervisor mutations with scoped association reads", async () => {
  process.env.ADMIN_PASSWORD = "Catalog-admin-test-2026";
  const s = new Store(":memory:");
  s.db.exec(
    "INSERT INTO employees(id,name,role) VALUES('e','Assigned','123'),('other','Other','456');INSERT INTO sites VALUES('s','Site','Address',0,0,100,'Legacy',1)",
  );
  const app = createApp(s);
  upsertUser(
    s,
    {
      email: "catalog-supervisor@example.test",
      name: "Supervisor",
      role: "supervisor",
      active: true,
      employee_ids: ["e"],
      password: "Catalog-supervisor-2026",
    },
    "admin",
  );
  const sector = createCatalog(s, "sector", { name: "Team" }, "hr");
  for (const id of ["e", "other"])
    setEmployeeAssociation(s, id, sector.id, true, "Initial assignment", "hr");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const login = async (body: any) =>
    (
      await fetch(base + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).headers.get("set-cookie")!;
  try {
    const admin = await login({ password: "Catalog-admin-test-2026" }),
      sup = await login({
        email: "catalog-supervisor@example.test",
        password: "Catalog-supervisor-2026",
      });
    const post = (path: string, cookie: string, body: any) =>
      fetch(base + path, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const body = {
      expected_revision: 1,
      reason: "Rename sector",
      name: "Renamed",
    };
    assert.equal(
      (await post("/api/catalogs/sector/" + sector.id, sup, body)).status,
      403,
    );
    assert.equal(
      (
        await post("/api/catalogs/associations", sup, {
          employee: "e",
          tag: sector.id,
          add: false,
          reason: "Not allowed",
        })
      ).status,
      403,
    );
    const view = await (
      await fetch(base + "/api/catalogs", { headers: { cookie: sup } })
    ).json();
    assert.deepEqual(
      view.associations.map((a: any) => a.employee_id),
      ["e"],
    );
    assert.equal(
      (await post("/api/catalogs/sector/" + sector.id, admin, body)).status,
      200,
    );
    assert.equal(
      (await post("/api/catalogs/sector/" + sector.id, admin, body)).status,
      409,
    );
    assert.equal(
      (
        await post("/api/catalogs/sector/" + sector.id, admin, {
          ...body,
          expected_revision: 2,
          kind: "tag",
        })
      ).status,
      400,
    );
    const site = {
      id: "s",
      name: "Site renamed",
      address: "Address",
      lat: 0,
      lon: 0,
      radius: 100,
      active: 1,
    };
    const category = s.one("SELECT id FROM taxonomy WHERE kind='category'").id;
    editCatalog(
      s,
      "category",
      category,
      { expected_revision: 1, reason: "Archive category", archive: true },
      "hr",
    );
    assert.equal(
      (await post("/api/sites", admin, { ...site, category_id: category }))
        .status,
      200,
    );
    assert.equal(
      (
        await post("/api/sites", admin, {
          ...site,
          id: undefined,
          category_id: category,
        })
      ).status,
      400,
    );
    assert.equal(
      (await post("/api/sites", admin, { ...site, category: "arbitrary" }))
        .status,
      400,
    );
    assert.equal(
      (await post("/api/sites", admin, { ...site, category_id: sector.id }))
        .status,
      400,
    );
    assert.equal(
      (await post("/api/sites", admin, { ...site, category_id: "" })).status,
      200,
    );
    assert.equal(publicSites(s)[0].category, "");
    assert.equal(
      s.one("SELECT actor FROM audit WHERE reason='Rename sector'").actor,
      "admin@carahue.local",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});
test("holiday destination conflicts and audit failures roll back both records and reconciliation jobs", () => {
  const s = new Store(":memory:");
  try {
    createCatalog(
      s,
      "holiday",
      { day: "2026-09-15", name: "Original day" },
      "hr",
    );
    createCatalog(
      s,
      "holiday",
      { day: "2026-09-16", name: "Existing destination" },
      "hr",
    );
    s.db.exec("DELETE FROM exception_jobs");
    assert.throws(() =>
      editCatalog(
        s,
        "holiday",
        "2026-09-15",
        {
          expected_revision: 1,
          reason: "Conflicting destination",
          day: "2026-09-16",
          name: "Moved",
        },
        "hr",
      ),
    );
    assert.equal(
      listCatalog(s, "holiday").find((h) => h.id === "2026-09-15").archived,
      0,
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM exception_jobs").n, 0);
    s.db.exec(
      "CREATE TRIGGER fail_holiday_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    assert.throws(() =>
      editCatalog(
        s,
        "holiday",
        "2026-09-15",
        {
          expected_revision: 1,
          reason: "Atomic date change",
          day: "2026-09-17",
          name: "Moved",
        },
        "hr",
      ),
    );
    assert.equal(listCatalog(s, "holiday").length, 2);
    assert.equal(
      listCatalog(s, "holiday").find((h) => h.id === "2026-09-15").revision,
      1,
    );
    assert.equal(s.one("SELECT COUNT(*) n FROM exception_jobs").n, 0);
  } finally {
    s.db.close();
  }
});
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "../server/seed";
test("fresh seeded startup and persisted migration reopen preserve category identities and explicit clears", () => {
  const dir = mkdtempSync(join(tmpdir(), "carahue-catalog-"));
  let s = new Store(join(dir, "synthetic.sqlite"));
  try {
    seed(s);
    createApp(s);
    const sites = publicSites(s);
    assert.ok(sites.length > 0);
    assert.ok(sites.every((r) => r.category_id));
    const categories = JSON.stringify(listCatalog(s, "category"));
    const first = sites[0];
    setSiteCategory(s, first.id, null);
    s.db.close();
    s = new Store(join(dir, "synthetic.sqlite"));
    createApp(s);
    assert.equal(JSON.stringify(listCatalog(s, "category")), categories);
    assert.equal(publicSites(s).find((r) => r.id === first.id).category, "");
    assert.equal(
      s.one(
        "SELECT COUNT(*) n FROM migrations WHERE name='catalog_exact_categories_v1'",
      ).n,
      1,
    );
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
