import { DatabaseSync } from "node:sqlite";
export class Store {
  db: DatabaseSync;
  private depth = 0;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,role TEXT NOT NULL DEFAULT 'Empleado',site_ids TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS sites(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,radius REAL NOT NULL,category TEXT NOT NULL DEFAULT 'Sucursal',active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY,employee_id TEXT REFERENCES employees(id),site_id TEXT REFERENCES sites(id),entry_at TEXT NOT NULL,exit_at TEXT,status TEXT NOT NULL,source TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_open_visit ON visits(employee_id) WHERE status='open';
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL,time TEXT NOT NULL,result TEXT NOT NULL,source TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,visit_id TEXT REFERENCES visits(id),employee_id TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pending(phone TEXT PRIMARY KEY,action TEXT NOT NULL,expires_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',error TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,phone TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,actor TEXT NOT NULL,expires_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,employee_ids TEXT NOT NULL DEFAULT '[]');
 CREATE TABLE IF NOT EXISTS leaves(id TEXT PRIMARY KEY,employee_id TEXT REFERENCES employees(id),type TEXT NOT NULL,date_from TEXT NOT NULL,date_to TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
 CREATE TABLE IF NOT EXISTS shifts(id TEXT PRIMARY KEY,name TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,tolerance INTEGER NOT NULL DEFAULT 10);
 CREATE TABLE IF NOT EXISTS breaks(id TEXT PRIMARY KEY,visit_id TEXT REFERENCES visits(id),started_at TEXT NOT NULL,ended_at TEXT,status TEXT NOT NULL DEFAULT 'open');
 CREATE UNIQUE INDEX IF NOT EXISTS one_open_break ON breaks(visit_id) WHERE status='open';
 CREATE TABLE IF NOT EXISTS shift_assignments(employee_id TEXT PRIMARY KEY REFERENCES employees(id),shift_id TEXT REFERENCES shifts(id));
 CREATE TABLE IF NOT EXISTS overtime(id TEXT PRIMARY KEY,visit_id TEXT NOT NULL UNIQUE REFERENCES visits(id),minutes INTEGER NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
 CREATE TABLE IF NOT EXISTS holidays(day TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS taxonomy(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(kind,name));
 CREATE TABLE IF NOT EXISTS catalog_state(kind TEXT NOT NULL,entity_id TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(kind,entity_id));
 CREATE TABLE IF NOT EXISTS site_categories(site_id TEXT PRIMARY KEY REFERENCES sites(id),category_id TEXT NOT NULL REFERENCES taxonomy(id));
 CREATE TABLE IF NOT EXISTS employee_tags(employee_id TEXT REFERENCES employees(id),tag_id TEXT REFERENCES taxonomy(id),PRIMARY KEY(employee_id,tag_id));
 CREATE TABLE IF NOT EXISTS planning_overrides(employee_id TEXT NOT NULL REFERENCES employees(id),day TEXT NOT NULL,revision INTEGER NOT NULL,mode TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(employee_id,day));
 CREATE TABLE IF NOT EXISTS planning_revisions(employee_id TEXT NOT NULL REFERENCES employees(id),day TEXT NOT NULL,revision INTEGER NOT NULL,mode TEXT NOT NULL,snapshot_json TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(employee_id,day,revision));
 CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),date_from TEXT NOT NULL,date_to TEXT NOT NULL,anchor TEXT NOT NULL,cycle INTEGER NOT NULL,slots_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active');
 CREATE TABLE IF NOT EXISTS receipt_batches(id TEXT PRIMARY KEY,title TEXT NOT NULL,period TEXT NOT NULL,liquidation TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS receipt_documents(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES receipt_batches(id),filename TEXT NOT NULL,sha256 TEXT NOT NULL,byte_count INTEGER NOT NULL,page_count INTEGER NOT NULL,employee_id TEXT REFERENCES employees(id),status TEXT NOT NULL,created_at TEXT NOT NULL,content BLOB NOT NULL CHECK(length(content)=byte_count),UNIQUE(batch_id,sha256));
 CREATE TABLE IF NOT EXISTS employee_bot_results(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),time TEXT NOT NULL,source TEXT NOT NULL,input_text TEXT NOT NULL,reply TEXT NOT NULL,status TEXT NOT NULL,received_at TEXT);
 CREATE TABLE IF NOT EXISTS communication_templates(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS communication_template_revisions(template_id TEXT NOT NULL REFERENCES communication_templates(id),revision INTEGER NOT NULL,document_json TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(template_id,revision));
 CREATE TABLE IF NOT EXISTS communication_campaigns(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,document_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',preparation_id TEXT,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS communication_preparations(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES communication_campaigns(id),revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(campaign_id,revision));
 CREATE TABLE IF NOT EXISTS exception_rules(type TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,priority TEXT NOT NULL DEFAULT 'normal');
 INSERT OR IGNORE INTO exception_rules(type) VALUES('late'),('absent');
 CREATE TABLE IF NOT EXISTS exception_periods(id TEXT PRIMARY KEY,type TEXT NOT NULL,start_day TEXT NOT NULL,end_day TEXT,catchup_day TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS exception_jobs(id TEXT PRIMARY KEY,employee_id TEXT,day TEXT NOT NULL,date_to TEXT NOT NULL,employee_cursor TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attendance_exceptions(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),day TEXT NOT NULL,type TEXT NOT NULL,period_id TEXT NOT NULL REFERENCES exception_periods(id),priority TEXT NOT NULL,evidence_json TEXT NOT NULL,current_evidence_json TEXT NOT NULL,condition TEXT NOT NULL,condition_reason TEXT NOT NULL,first_evaluated_at TEXT NOT NULL,last_evaluated_at TEXT NOT NULL,ack_actor TEXT,ack_at TEXT,ack_reason TEXT,UNIQUE(employee_id,day,type));
 CREATE TABLE IF NOT EXISTS operation_reviews(lane TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,id TEXT UNIQUE NOT NULL,PRIMARY KEY(lane,entity_id,revision));
 CREATE TABLE IF NOT EXISTS runtime_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
 `);
    for (const [table, column, definition] of [
      ["events", "input_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["events", "received_at", "TEXT"],
      ["employee_bot_results", "received_at", "TEXT"],
      ["outbox", "attempts", "INTEGER NOT NULL DEFAULT 0"],
      ["outbox", "next_attempt_at", "TEXT"],
      ["outbox", "provider_id", "TEXT"],
      ["outbox", "error", "TEXT"],
      ["outbox", "window_until", "TEXT"],
      ["pending", "location_json", "TEXT"],
      ["sessions", "user_id", "TEXT"],
    ]) {
      if (
        !this.all(`PRAGMA table_info(${table})`).some((c) => c.name === column)
      )
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  all(sql: string, ...params: any[]): any[] {
    return this.db.prepare(sql).all(...params);
  }
  one(sql: string, ...params: any[]): any {
    return this.db.prepare(sql).get(...params);
  }
  tx<T>(fn: () => T): T {
    const nested = this.depth > 0;
    const savepoint = `unit_${this.depth++}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
      return result;
    } catch (e) {
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}` : "ROLLBACK");
      if (nested) this.db.exec(`RELEASE ${savepoint}`);
      throw e;
    } finally {
      this.depth--;
    }
  }
}
