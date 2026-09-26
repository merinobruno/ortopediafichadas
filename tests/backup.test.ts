import { createBatch, addDocument, assignDocument } from "../server/receipts";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store";
import {
  issueLinkCode,
  consumeLinkCode,
  hashLinkCode,
} from "../server/telegram-links";
import { receiveTelegramUpdate } from "../server/telegram";
import {
  snapshotDatabase,
  restoreDatabase,
  verifyDatabase,
  acknowledgeRecovery,
} from "../server/backup";
test("consistent WAL snapshot restores to new path with sessions revoked and replay quarantined", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carahue-backup-"));
  const source = join(dir, "source.sqlite"),
    backup = join(dir, "snapshot.sqlite"),
    restored = join(dir, "restored.sqlite");
  const s = new Store(source);
  try {
    s.db
      .prepare(
        "INSERT INTO sessions(token,actor,expires_at) VALUES('secret-session','hr','2099-01-01')",
      )
      .run();
    s.db
      .prepare(
        "INSERT INTO audit VALUES('a','entity','hr','reason','null','{}','2026-09-01')",
      )
      .run();
    s.db.exec(
      "INSERT INTO employees(id,name) VALUES('e','Synthetic employee'); INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('s','Synthetic site','Address',0,0,100); INSERT INTO visits VALUES('v','e','s','2026-09-01T09:00:00Z','2026-09-01T10:00:00Z','complete','simulator');",
    );
    const oldCode = issueLinkCode(s, "e", "hr");
    consumeLinkCode(s, hashLinkCode(oldCode.code), "8", "8");
    const unusedCodeEmployee = "unused";
    s.db
      .prepare("INSERT INTO employees(id,name) VALUES(?,?)")
      .run(unusedCodeEmployee, "Unused");
    issueLinkCode(s, unusedCodeEmployee, "hr");
    receiveTelegramUpdate(s, {
      updateId: 1,
      messageId: 1,
      userId: "8",
      chatId: "8",
      timestamp: Date.now(),
      kind: "text",
      text: "entrada",
    });
    s.db
      .prepare(
        "INSERT INTO telegram_outbox(id,employee_id,link_generation,chat_id,text,status,created_at) SELECT 'reply',employee_id,generation,chat_id,'private reply','queued',? FROM telegram_links WHERE employee_id='e'",
      )
      .run(new Date().toISOString());
    s.db
      .prepare(
        "INSERT INTO bot_pending(key,employee_id,action,expires_at) VALUES('telegram:e','e','entry','2099-01-01')",
      )
      .run();
    const bytes = readFileSync(
      new URL("./fixtures/recibo-ficticio-qa.pdf", import.meta.url),
    );
    const batch = createBatch(
      s,
      {
        title: "Synthetic private batch",
        period: "2026-09",
        liquidation: "monthly",
      },
      "hr",
    );
    const doc = await addDocument(s, batch.id, bytes, "fictional.pdf", "hr");
    assignDocument(s, doc.id, "e", "Confirmed synthetic recipient", "hr");
    const auditCount = s.one("SELECT COUNT(*) n FROM audit").n;
    await snapshotDatabase(source, backup);
    await restoreDatabase(backup, restored);
    const r = new DatabaseSync(restored, { readOnly: true });
    try {
      assert.equal(r.prepare("SELECT COUNT(*) n FROM sessions").get()!.n, 0);
      assert.equal(
        r.prepare("SELECT status FROM telegram_inbox").get()!.status,
        "recovery_hold",
      );
      assert.equal(
        r.prepare("SELECT status FROM telegram_outbox").get()!.status,
        "recovery_hold",
      );
      assert.equal(r.prepare("SELECT COUNT(*) n FROM bot_pending").get()!.n, 0);
      assert.equal(
        r.prepare("SELECT COUNT(*) n FROM telegram_codes").get()!.n,
        0,
      );
      assert.equal(
        r.prepare("SELECT COUNT(*) n FROM audit").get()!.n,
        auditCount,
      );
      const restoredDoc = r
        .prepare("SELECT * FROM receipt_documents WHERE id=?")
        .get(doc.id)!;
      assert.deepEqual(Buffer.from(restoredDoc.content as Uint8Array), bytes);
      assert.equal(restoredDoc.sha256, doc.sha256);
      assert.equal(restoredDoc.batch_id, batch.id);
      assert.equal(restoredDoc.employee_id, "e");
      assert.equal(
        r.prepare("SELECT exit_at FROM visits WHERE id='v'").get()!.exit_at,
        "2026-09-01T10:00:00Z",
      );
      assert.equal(
        r
          .prepare(
            "SELECT value FROM runtime_state WHERE key='recovery_required'",
          )
          .get()!.value,
        "1",
      );
    } finally {
      r.close();
    }
    acknowledgeRecovery(restored);
    assert.equal(s.one("SELECT status FROM telegram_inbox").status, "pending");
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_codes").n, 1);
    assert.equal(s.one("SELECT COUNT(*) n FROM sessions").n, 1);
    await assert.rejects(() => snapshotDatabase(source, backup));
    const alias = join(dir, "alias.sqlite");
    linkSync(source, alias);
    await assert.rejects(() => restoreDatabase(backup, alias));
    assert.ok(existsSync(source));
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("verification rejects corruption and foreign key violations without migrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "carahue-verify-"));
  try {
    const bad = join(dir, "bad.sqlite");
    writeFileSync(bad, "not a database");
    assert.throws(() => verifyDatabase(bad));
    const fk = join(dir, "fk.sqlite");
    const db = new DatabaseSync(fk);
    db.exec(
      "PRAGMA foreign_keys=OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(8)",
    );
    db.close();
    assert.throws(() => verifyDatabase(fk));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
