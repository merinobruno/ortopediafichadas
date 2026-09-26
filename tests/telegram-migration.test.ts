import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";

test("migrates an old file without changing employee, attendance or receipt identities", () => {
  const dir = mkdtempSync(join(tmpdir(), "carahue-telegram-migration-"));
  const path = join(dir, "old.sqlite");
  try {
    const old = new DatabaseSync(path);
    old.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,role TEXT NOT NULL,site_ids TEXT NOT NULL,active INTEGER NOT NULL);
      CREATE TABLE sites(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,radius REAL NOT NULL,category TEXT NOT NULL,active INTEGER NOT NULL);
      CREATE TABLE visits(id TEXT PRIMARY KEY,employee_id TEXT REFERENCES employees(id),site_id TEXT REFERENCES sites(id),entry_at TEXT NOT NULL,exit_at TEXT,status TEXT NOT NULL,source TEXT NOT NULL);
      CREATE TABLE receipt_batches(id TEXT PRIMARY KEY,title TEXT NOT NULL,period TEXT NOT NULL,liquidation TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE receipt_documents(id TEXT PRIMARY KEY,batch_id TEXT REFERENCES receipt_batches(id),filename TEXT NOT NULL,sha256 TEXT NOT NULL,byte_count INTEGER NOT NULL,page_count INTEGER NOT NULL,employee_id TEXT REFERENCES employees(id),status TEXT NOT NULL,created_at TEXT NOT NULL,content BLOB NOT NULL);
      CREATE TABLE audit(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE shifts(id TEXT PRIMARY KEY,name TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,tolerance INTEGER NOT NULL);
      CREATE TABLE shift_assignments(employee_id TEXT PRIMARY KEY REFERENCES employees(id),shift_id TEXT REFERENCES shifts(id));
      CREATE TABLE leaves(id TEXT PRIMARY KEY,employee_id TEXT REFERENCES employees(id),type TEXT NOT NULL,date_from TEXT NOT NULL,date_to TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE employee_bot_results(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),time TEXT NOT NULL,source TEXT NOT NULL,input_text TEXT NOT NULL,reply TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE inbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE outbox(id TEXT PRIMARY KEY,phone TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE pending(phone TEXT PRIMARY KEY,action TEXT NOT NULL,expires_at TEXT NOT NULL);
      INSERT INTO employees VALUES('e','Ana','5491112345678','Empleado','["s"]',1);
      INSERT INTO sites VALUES('s','Central','',0,0,100,'Sucursal',1);
      INSERT INTO visits VALUES('v','e','s','2026-09-01T10:00:00.000Z',NULL,'open','old');
      INSERT INTO receipt_batches VALUES('b','Septiembre','2026-09','monthly','draft','2026-09-01');
      INSERT INTO receipt_documents VALUES('r','b','receipt.pdf','digest',3,1,'e','draft','2026-09-01',x'010203');
      INSERT INTO audit VALUES('a','e','hr','old','{}','{}','2026-09-01');
      INSERT INTO shifts VALUES('shift','Morning','09:00','17:00',10);
      INSERT INTO shift_assignments VALUES('e','shift');
      INSERT INTO leaves VALUES('leave','e','Vacation','2026-10-01','2026-10-02','Old approved leave','approved');
      INSERT INTO employee_bot_results VALUES('sim','e','2026-09-01','simulator','help','reply','processed');
      INSERT INTO employee_bot_results VALUES('wa','e','2026-09-01','whatsapp','secret','reply','processed');
      INSERT INTO inbox VALUES('old','{}','pending',NULL,'2026-09-01');
      INSERT INTO outbox VALUES('old','5491112345678','private','queued','2026-09-01');
      INSERT INTO pending VALUES('5491112345678','entry','2026-09-01');`);
    old.close();
    for (let reopen = 0; reopen < 2; reopen++) {
      const s = new Store(path);
      try {
        assert.equal(
          s
            .all("PRAGMA table_info(employees)")
            .some((row) => row.name === "phone"),
          false,
        );
        assert.equal(s.one("SELECT id FROM employees WHERE id='e'").id, "e");
        assert.equal(s.one("SELECT id FROM visits WHERE id='v'").id, "v");
        assert.deepEqual(
          Buffer.from(
            s.one("SELECT content FROM receipt_documents WHERE id='r'").content,
          ),
          Buffer.from([1, 2, 3]),
        );
        assert.equal(s.one("SELECT id FROM audit WHERE id='a'").id, "a");
        assert.equal(
          s.one("SELECT shift_id FROM shift_assignments WHERE employee_id='e'")
            .shift_id,
          "shift",
        );
        assert.equal(
          s.one("SELECT status FROM leaves WHERE id='leave'").status,
          "approved",
        );
        assert.equal(
          s.one("SELECT id FROM employee_bot_results WHERE id='sim'").id,
          "sim",
        );
        assert.equal(
          s.one("SELECT id FROM employee_bot_results WHERE id='wa'"),
          undefined,
        );
        assert.equal(s.all("PRAGMA foreign_key_check").length, 0);
        assert.equal(s.all("SELECT * FROM telegram_inbox").length, 0);
        assert.equal(s.all("SELECT * FROM telegram_outbox").length, 0);
      } finally {
        s.db.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
