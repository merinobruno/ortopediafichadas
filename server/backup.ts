import { DatabaseSync, backup } from "node:sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
function sourcePath(path: string) {
  const p = resolve(path);
  if (!existsSync(p) || !lstatSync(p).isFile() || lstatSync(p).isSymbolicLink())
    throw new Error("Source must be a regular database file");
  return p;
}
export function verifyDatabase(path: string) {
  const db = new DatabaseSync(sourcePath(path), { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all();
    if (
      rows.length !== 1 ||
      rows[0].integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Database integrity verification failed");
  } finally {
    db.close();
  }
}
async function copyDatabase(
  source: string,
  destination: string,
  restore: boolean,
) {
  const src = sourcePath(source),
    dest = resolve(destination);
  if (src === dest || existsSync(dest))
    throw new Error("Destination must be a new path");
  verifyDatabase(src);
  mkdirSync(dirname(dest), { recursive: true });
  const temp = join(dirname(dest), `.carahue-${randomUUID()}.sqlite`);
  const db = new DatabaseSync(src, { readOnly: true });
  try {
    await backup(db, temp);
    if (restore) {
      const r = new Store(temp);
      try {
        r.tx(() => {
          r.db.exec(
            "DELETE FROM sessions; DELETE FROM bot_pending; DELETE FROM telegram_codes",
          );
          r.db.exec(
            "UPDATE telegram_inbox SET status='recovery_hold',reason_code='restored_snapshot' WHERE status='pending'",
          );
          r.db.exec(
            "UPDATE telegram_outbox SET status='recovery_hold',reason_code='restored_snapshot' WHERE status IN ('sending','queued')",
          );
          r.db.exec(
            "INSERT OR REPLACE INTO runtime_state VALUES('recovery_required','1')",
          );
        });
      } finally {
        r.db.close();
      }
    }
    verifyDatabase(temp);
    linkSync(temp, dest);
  } finally {
    db.close();
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export function snapshotDatabase(source: string, destination: string) {
  return copyDatabase(source, destination, false);
}
export function restoreDatabase(source: string, destination: string) {
  return copyDatabase(source, destination, true);
}
export function acknowledgeRecovery(path: string) {
  verifyDatabase(path);
  const db = new DatabaseSync(sourcePath(path));
  try {
    db.exec("UPDATE runtime_state SET value='0' WHERE key='recovery_required'");
  } finally {
    db.close();
  }
}
