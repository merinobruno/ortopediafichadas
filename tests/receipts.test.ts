import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Store } from "../server/store";
import {
  createBatch,
  archiveBatch,
  addDocument,
  assignDocument,
  listReceiptDocuments,
  RECEIPT_LIMITS,
} from "../server/receipts";
import { validatePdf } from "../server/pdf-validator";
const pdf = readFileSync(
  new URL("./fixtures/recibo-ficticio-qa.pdf", import.meta.url),
);
function setup() {
  const s = new Store(":memory:");
  s.db.exec(
    "INSERT INTO employees(id,name,role) VALUES('e','Synthetic','5491100000011'),('other','Other synthetic','5491100000012')",
  );
  return s;
}
const batch = (s: Store) =>
  createBatch(
    s,
    { title: "Synthetic batch", period: "2026-09", liquidation: "monthly" },
    "hr",
  );
test("PDF parser verifies pages and rejects malformed content and page limits", async () => {
  assert.equal((await validatePdf(pdf)).pages, 1);
  await assert.rejects(() => validatePdf(Buffer.from("%PDF-1.7 fake body")));
  const { PDFDocument } = await import("pdf-lib");
  const p = await PDFDocument.create();
  for (let i = 0; i < 41; i++) p.addPage();
  const bytes = Buffer.from(await p.save());
  await assert.rejects(() => validatePdf(bytes));
});
test("receipt staging preserves bytes privately and assignment/archive metadata is audited", async () => {
  const s = setup();
  try {
    const b = batch(s),
      d = await addDocument(s, b.id, pdf, "../../fake\r\nname.pdf", "hr");
    assert.equal(d.status, "needs_assignment");
    assert.equal(d.filename.includes("\r"), false);
    assert.equal(d.filename.includes("/"), false);
    assert.equal("content" in d, false);
    assert.equal("content" in listReceiptDocuments(s, b.id)[0], false);
    assert.deepEqual(
      Buffer.from(s.one("SELECT content FROM receipt_documents").content),
      pdf,
    );
    assignDocument(s, d.id, "e", "Confirmed by HR", "hr");
    assignDocument(s, d.id, "other", "Corrected recipient", "hr");
    assert.equal(
      s.one("SELECT employee_id FROM receipt_documents").employee_id,
      "other",
    );
    assert.equal(
      s.one("SELECT status FROM receipt_documents").status,
      "staged",
    );
    const audits = s.all(
      "SELECT after_json FROM audit WHERE entity_id=?",
      d.id,
    );
    assert.ok(audits.every((a) => !a.after_json.includes("content")));
    archiveBatch(s, b.id, "Archive test batch", "hr");
    assert.equal(s.one("SELECT COUNT(*) n FROM receipt_documents").n, 1);
    assert.throws(() =>
      assignDocument(s, d.id, "e", "No change allowed", "hr"),
    );
    await assert.rejects(() => addDocument(s, b.id, pdf, "same.pdf", "hr"));
    assert.equal(s.one("SELECT COUNT(*) n FROM telegram_outbox").n, 0);
  } finally {
    s.db.close();
  }
});
test("duplicate hashes quota boundaries and audit failures cannot partly persist documents", async () => {
  const s = setup();
  try {
    const b = batch(s);
    await addDocument(s, b.id, pdf, "one.pdf", "hr");
    await assert.rejects(() =>
      addDocument(s, b.id, pdf, "different-name.pdf", "hr"),
    );
    const other = batch(s);
    await assert.rejects(() =>
      addDocument(s, other.id, pdf, "two.pdf", "hr", {
        ...RECEIPT_LIMITS,
        totalBytes: pdf.length,
      }),
    );
    await assert.rejects(() =>
      addDocument(s, other.id, pdf, "two.pdf", "hr", {
        ...RECEIPT_LIMITS,
        batchBytes: pdf.length - 1,
      }),
    );
    await assert.rejects(() =>
      addDocument(s, other.id, pdf, "two.pdf", "hr", {
        ...RECEIPT_LIMITS,
        batchFiles: 0,
      }),
    );
    s.db.exec(
      "CREATE TRIGGER fail_receipt_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    await assert.rejects(() => addDocument(s, other.id, pdf, "two.pdf", "hr"));
    assert.equal(
      s.one(
        "SELECT COUNT(*) n FROM receipt_documents WHERE batch_id=?",
        other.id,
      ).n,
      0,
    );
  } finally {
    s.db.close();
  }
});

test("encrypted PDFs are rejected and simultaneous validators have bounded admission", async () => {
  const encrypted = readFileSync(
    new URL("./fixtures/recibo-ficticio-encrypted.pdf", import.meta.url),
  );
  await assert.rejects(() => validatePdf(encrypted));
  const first = validatePdf(pdf),
    second = validatePdf(pdf);
  await assert.rejects(
    () => validatePdf(pdf),
    (error: any) => error.status === 503,
  );
  assert.equal((await first).pages, 1);
  assert.equal((await second).pages, 1);
});
test("archive and duplicate races recheck state after asynchronous PDF validation", async () => {
  const s = setup();
  try {
    const b = batch(s);
    const pending = addDocument(s, b.id, pdf, "late.pdf", "hr");
    archiveBatch(s, b.id, "Archived during validation", "hr");
    await assert.rejects(
      () => pending,
      (e: any) => e.status === 409,
    );
    assert.equal(listReceiptDocuments(s, b.id).length, 0);
    const second = batch(s);
    const results = await Promise.allSettled([
      addDocument(s, second.id, pdf, "one.pdf", "hr"),
      addDocument(s, second.id, pdf, "two.pdf", "hr"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(listReceiptDocuments(s, second.id).length, 1);
  } finally {
    s.db.close();
  }
});
