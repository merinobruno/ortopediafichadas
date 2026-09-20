import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Express } from "express";
import { Store } from "./store";
const lane = z.enum(["inbox", "outbox"]);
const states = [
  "pending",
  "processed",
  "rejected",
  "queued",
  "sending",
  "accepted",
  "failed",
  "expired",
  "uncertain",
  "sent",
  "delivered",
  "read",
  "recovery_hold",
] as const;
function authorize(user: any) {
  if (!["admin", "hr"].includes(user?.role))
    throw Object.assign(
      new Error("No tenés permiso para operar estas colas."),
      { status: 403 },
    );
}
const querySchema = z
  .object({
    lane,
    status: z.enum(states).optional(),
    review: z.enum(["unreviewed", "reviewed", "dismissed"]).optional(),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
function safeReason(status: string, error: unknown) {
  if (status === "recovery_hold") return "recovery_quarantine";
  if (status === "uncertain") return "delivery_unknown";
  if (status === "expired") return "reply_window_expired";
  if (status === "rejected") return "processing_rejected";
  if (typeof error === "string" && /^Provider HTTP [1-5]\d\d$/.test(error))
    return error.toLowerCase().replaceAll(" ", "_");
  return error ? "requires_operator_review" : null;
}
export function listOperations(s: Store, user: any, query: unknown) {
  authorize(user);
  const q = querySchema.parse(query);
  let cursor: { time: string; id: string } | undefined;
  if (q.cursor) {
    try {
      cursor = z
        .object({
          time: z.string().datetime(),
          id: z.string().min(1).max(1000),
        })
        .strict()
        .parse(JSON.parse(Buffer.from(q.cursor, "base64url").toString()));
    } catch {
      throw new Error("Cursor inválido.");
    }
  }
  const extra =
    q.lane === "outbox"
      ? "t.attempts,t.next_attempt_at,t.window_until,e.name employee_name,"
      : "NULL attempts,NULL next_attempt_at,NULL window_until,NULL employee_name,";
  const rows = s.all(
    `SELECT t.id,t.status,t.created_at,t.error,${extra} COALESCE(r.revision,0) revision,COALESCE(r.state,'unreviewed') review_state,r.actor review_actor,r.reason review_reason,r.created_at reviewed_at FROM ${q.lane} t LEFT JOIN operation_reviews r ON r.lane=? AND r.entity_id=t.id AND r.revision=(SELECT MAX(revision) FROM operation_reviews WHERE lane=? AND entity_id=t.id) ${q.lane === "outbox" ? "LEFT JOIN employees e ON e.phone=t.phone" : ""} WHERE (?='' OR t.status=?) AND (?='' OR COALESCE(r.state,'unreviewed')=?) AND (?='' OR t.created_at<? OR (t.created_at=? AND t.id<?)) ORDER BY t.created_at DESC,t.id DESC LIMIT 26`,
    q.lane,
    q.lane,
    q.status || "",
    q.status || "",
    q.review || "",
    q.review || "",
    cursor?.time || "",
    cursor?.time || "",
    cursor?.time || "",
    cursor?.id || "",
  );
  const more = rows.length > 25;
  rows.length = Math.min(rows.length, 25);
  const last = rows.at(-1);
  return {
    rows: rows.map(({ error, ...r }) => ({
      ...r,
      reason_code: safeReason(r.status, error),
    })),
    nextCursor: more
      ? Buffer.from(
          JSON.stringify({ time: last.created_at, id: last.id }),
        ).toString("base64url")
      : null,
  };
}
const reviewSchema = z
  .object({
    lane,
    id: z.string().min(1).max(1000),
    expectedRevision: z.number().int().min(0),
    state: z.enum(["reviewed", "dismissed"]),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export function reviewOperation(s: Store, user: any, input: unknown) {
  authorize(user);
  const p = reviewSchema.parse(input);
  return s.tx(() => {
    if (!s.one(`SELECT id FROM ${p.lane} WHERE id=?`, p.id))
      throw new Error("Registro inexistente.");
    const before = s.one(
      "SELECT * FROM operation_reviews WHERE lane=? AND entity_id=? ORDER BY revision DESC LIMIT 1",
      p.lane,
      p.id,
    );
    if ((before?.revision || 0) !== p.expectedRevision)
      throw Object.assign(
        new Error("Otra persona actualizó esta revisión. Actualizá la lista."),
        { status: 409 },
      );
    const now = new Date().toISOString(),
      revision = p.expectedRevision + 1;
    const after = {
      lane: p.lane,
      entity_id: p.id,
      revision,
      state: p.state,
      actor: user.email,
      reason: p.reason,
      created_at: now,
    };
    s.db
      .prepare("INSERT INTO operation_reviews VALUES(?,?,?,?,?,?,?,?)")
      .run(
        p.lane,
        p.id,
        revision,
        p.state,
        user.email,
        p.reason,
        now,
        randomUUID(),
      );
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        "operation_review:" + p.lane + ":" + p.id,
        user.email,
        p.reason,
        JSON.stringify(before || null),
        JSON.stringify(after),
        now,
      );
    return after;
  });
}
export function operationRoutes(app: Express, s: Store) {
  app.get("/api/whatsapp-operations", (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(listOperations(s, res.locals.user, req.query));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/whatsapp-operations/review", (req, res, next) => {
    try {
      res.json(reviewOperation(s, res.locals.user, req.body));
    } catch (e) {
      next(e);
    }
  });
}
