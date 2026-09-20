import { randomUUID, createHash } from "node:crypto";
import express, { type Express } from "express";
import { z } from "zod";
import { Store } from "./store";
import { validatePdf, ReceiptError } from "./pdf-validator";
export const RECEIPT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  batchFiles: 20,
  batchBytes: 50 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
};
const columns =
  "id,batch_id,filename,sha256,byte_count,page_count,employee_id,status,created_at";
const batchSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    liquidation: z.enum([
      "monthly",
      "first_half",
      "second_half",
      "sac_first",
      "sac_second",
      "sac_proportional",
      "vacation",
      "final",
      "other",
    ]),
  })
  .strict();
function audit(
  s: Store,
  id: string,
  actor: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  s.db
    .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
    .run(
      randomUUID(),
      id,
      actor,
      reason,
      JSON.stringify(before),
      JSON.stringify({ private_receipt: true, ...(after as object) }),
      new Date().toISOString(),
    );
}
function editableBatch(s: Store, id: string) {
  const b = s.one("SELECT * FROM receipt_batches WHERE id=?", id);
  if (!b) throw new ReceiptError("Lote no encontrado.", 404);
  if (b.status !== "draft")
    throw new ReceiptError("El lote está archivado y no admite cambios.", 409);
  return b;
}
export function createBatch(s: Store, input: unknown, actor: string) {
  const p = batchSchema.parse(input);
  return s.tx(() => {
    const id = randomUUID();
    s.db
      .prepare("INSERT INTO receipt_batches VALUES(?,?,?,?,'draft',?)")
      .run(id, p.title, p.period, p.liquidation, new Date().toISOString());
    audit(s, id, actor, "Private receipt batch created", null, {
      id,
      ...p,
      status: "draft",
    });
    return { id };
  });
}
export function archiveBatch(
  s: Store,
  id: string,
  reason: string,
  actor: string,
) {
  reason = z.string().trim().min(5).max(1000).parse(reason);
  s.tx(() => {
    const before = s.one("SELECT * FROM receipt_batches WHERE id=?", id);
    if (!before) throw new ReceiptError("Lote no encontrado.", 404);
    if (before.status === "archived") return;
    s.db
      .prepare("UPDATE receipt_batches SET status='archived' WHERE id=?")
      .run(id);
    audit(s, id, actor, reason, before, { ...before, status: "archived" });
  });
}
export function listReceiptDocuments(s: Store, batch: string) {
  return s.all(
    `SELECT ${columns} FROM receipt_documents WHERE batch_id=? ORDER BY created_at`,
    batch,
  );
}
function filename(value: string) {
  const last = value.replaceAll("\\", "/").split("/").pop() || "documento.pdf";
  const clean = last
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
  return (
    (clean.toLowerCase().endsWith(".pdf") ? clean : clean + ".pdf") ||
    "documento.pdf"
  );
}
function quota(
  s: Store,
  batch: string,
  size: number,
  limits: typeof RECEIPT_LIMITS,
) {
  const usage = s.one(
      "SELECT COUNT(*) n,COALESCE(SUM(byte_count),0) bytes FROM receipt_documents WHERE batch_id=?",
      batch,
    ),
    total = s.one(
      "SELECT COALESCE(SUM(byte_count),0) bytes FROM receipt_documents",
    );
  if (
    usage.n >= limits.batchFiles ||
    usage.bytes + size > limits.batchBytes ||
    total.bytes + size > limits.totalBytes
  )
    throw new ReceiptError(
      "Se alcanzó el límite de archivos o almacenamiento. Los lotes archivados también ocupan espacio.",
      413,
    );
}
export async function addDocument(
  s: Store,
  batch: string,
  bytes: Buffer,
  name: string,
  actor: string,
  limits = RECEIPT_LIMITS,
) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > limits.fileBytes
  )
    throw new ReceiptError("El PDF debe ocupar hasta 5 MiB.", 413);
  editableBatch(s, batch);
  quota(s, batch, bytes.length, limits);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (
    s.one(
      "SELECT id FROM receipt_documents WHERE batch_id=? AND sha256=?",
      batch,
      sha,
    )
  )
    throw new ReceiptError("Ese PDF ya existe en este lote.", 409);
  const { pages } = await validatePdf(bytes);
  return s.tx(() => {
    editableBatch(s, batch);
    quota(s, batch, bytes.length, limits);
    if (
      s.one(
        "SELECT id FROM receipt_documents WHERE batch_id=? AND sha256=?",
        batch,
        sha,
      )
    )
      throw new ReceiptError("Ese PDF ya existe en este lote.", 409);
    const id = randomUUID();
    s.db
      .prepare(
        "INSERT INTO receipt_documents VALUES(?,?,?,?,?,?,NULL,'needs_assignment',?,?)",
      )
      .run(
        id,
        batch,
        filename(name),
        sha,
        bytes.length,
        pages,
        new Date().toISOString(),
        bytes,
      );
    const metadata = s.one(
      `SELECT ${columns} FROM receipt_documents WHERE id=?`,
      id,
    );
    audit(s, id, actor, "Private PDF staged; not published", null, metadata);
    return metadata;
  });
}
export function assignDocument(
  s: Store,
  id: string,
  employee: string,
  reason: string,
  actor: string,
) {
  reason = z.string().trim().min(5).max(1000).parse(reason);
  s.tx(() => {
    const before = s.one(
      `SELECT ${columns} FROM receipt_documents WHERE id=?`,
      id,
    );
    if (!before) throw new ReceiptError("Documento no encontrado.", 404);
    editableBatch(s, before.batch_id);
    if (!s.one("SELECT id FROM employees WHERE id=?", employee))
      throw new ReceiptError("Empleado no encontrado.");
    if (before.employee_id === employee) return;
    s.db
      .prepare(
        "UPDATE receipt_documents SET employee_id=?,status='staged' WHERE id=?",
      )
      .run(employee, id);
    audit(s, id, actor, reason, before, {
      ...before,
      employee_id: employee,
      status: "staged",
    });
  });
}
export function receiptRoutes(app: Express, s: Store) {
  const router = express.Router({ caseSensitive: true, strict: true });
  let uploads = 0;
  router.use((_req, res, next) => {
    if (!["admin", "hr"].includes(res.locals.user?.role)) {
      res
        .status(403)
        .json({
          error:
            "Sólo RRHH y administración pueden acceder a recibos privados.",
        });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.post(
    "/batches/:id/documents",
    (req, res, next) => {
      if (
        !req.is("application/pdf") ||
        !["identity", undefined].includes(req.get("content-encoding"))
      ) {
        res
          .status(415)
          .json({
            error: "Subí un PDF como application/pdf, sin compresión HTTP.",
          });
        return;
      }
      if (uploads >= 2) {
        res
          .status(503)
          .json({ error: "Hay dos cargas en curso. Intentá nuevamente." });
        return;
      }
      uploads++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          uploads--;
        }
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    },
    express.raw({
      type: "application/pdf",
      limit: RECEIPT_LIMITS.fileBytes,
      inflate: false,
    }),
    async (req, res) => {
      let name = req.get("x-filename") || "documento.pdf";
      try {
        name = decodeURIComponent(name);
      } catch {
        throw new ReceiptError("Nombre de archivo inválido.");
      }
      const doc = await addDocument(
        s,
        String(req.params.id),
        req.body,
        name,
        res.locals.actor,
      );
      res.status(201).json(doc);
    },
  );
  router.use(express.json({ limit: "100kb" }));
  router.get("/batches", (_req, res) =>
    res.json({
      batches: s.all(
        "SELECT b.*,COUNT(d.id) documents,COALESCE(SUM(d.byte_count),0) bytes FROM receipt_batches b LEFT JOIN receipt_documents d ON d.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC",
      ),
      limits: RECEIPT_LIMITS,
      totalBytes: s.one(
        "SELECT COALESCE(SUM(byte_count),0) bytes FROM receipt_documents",
      ).bytes,
    }),
  );
  router.post("/batches", (req, res) =>
    res.status(201).json(createBatch(s, req.body, res.locals.actor)),
  );
  router.post("/batches/:id/archive", (req, res) => {
    const p = z.object({ reason: z.string() }).strict().parse(req.body);
    archiveBatch(s, String(req.params.id), p.reason, res.locals.actor);
    res.json({ ok: true });
  });
  router.get("/batches/:id/documents", (req, res) =>
    res.json(listReceiptDocuments(s, String(req.params.id))),
  );
  router.post("/documents/:id/assignment", (req, res) => {
    const p = z
      .object({ employee_id: z.string(), reason: z.string() })
      .strict()
      .parse(req.body);
    assignDocument(
      s,
      String(req.params.id),
      p.employee_id,
      p.reason,
      res.locals.actor,
    );
    res.json({ ok: true });
  });
  router.get("/documents/:id/download", (req, res) => {
    const doc = s.tx(() => {
      const d = s.one(
        `SELECT ${columns},content FROM receipt_documents WHERE id=?`,
        String(req.params.id),
      );
      if (!d) throw new ReceiptError("Documento no encontrado.", 404);
      audit(
        s,
        d.id,
        res.locals.actor,
        "HR accessed private PDF; not employee acknowledgement",
        null,
        {
          id: d.id,
          batch_id: d.batch_id,
          sha256: d.sha256,
          byte_count: d.byte_count,
        },
      );
      return d;
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename(doc.filename)}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(doc.content));
  });
  router.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res
        .status(err.status || 400)
        .json({
          error:
            err.status === 413
              ? "La carga supera los límites permitidos."
              : err instanceof z.ZodError
                ? "Revisá los campos del formulario."
                : err instanceof ReceiptError
                  ? err.message
                  : "No se pudo guardar el recibo privado.",
        }),
  );
  app.use("/api/receipts", router);
}
