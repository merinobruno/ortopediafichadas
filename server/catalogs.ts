import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Express } from "express";
import { Store } from "./store";
import { civilDate } from "../shared/validation";
import { enqueueExceptionWork } from "./exception-work";
import { scopedEmployees } from "./auth";
export type CatalogKind = "shift" | "sector" | "tag" | "category" | "holiday";
const kinds = z.enum(["shift", "sector", "tag", "category", "holiday"]);
const name = z.string().trim().min(2).max(120);
const reasonSchema = z.string().trim().min(5).max(1000);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const shiftSchema = z
  .object({
    name,
    start: time,
    end: time,
    tolerance: z.coerce.number().int().min(0).max(120),
  })
  .strict();
class CatalogError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
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
      JSON.stringify(after),
      new Date().toISOString(),
    );
}
export function catalogActive(s: Store, kind: CatalogKind, id: string) {
  return !s.one(
    "SELECT archived FROM catalog_state WHERE kind=? AND entity_id=?",
    kind,
    id,
  )?.archived;
}
export function listCatalog(s: Store, kind: CatalogKind) {
  kinds.parse(kind);
  const rows =
    kind === "shift"
      ? s.all("SELECT * FROM shifts")
      : kind === "holiday"
        ? s.all("SELECT day id,day,name FROM holidays")
        : s.all("SELECT * FROM taxonomy WHERE kind=?", kind);
  return rows
    .map((r) => ({
      ...r,
      kind,
      archived: 0,
      revision: 1,
      ...s.one(
        "SELECT archived,revision,updated_at FROM catalog_state WHERE kind=? AND entity_id=?",
        kind,
        r.id,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function state(
  s: Store,
  kind: CatalogKind,
  id: string,
  archived: number,
  revision: number,
) {
  s.db
    .prepare(
      "INSERT INTO catalog_state VALUES(?,?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET archived=excluded.archived,revision=excluded.revision,updated_at=excluded.updated_at",
    )
    .run(kind, id, archived, revision, new Date().toISOString());
}
function input(kind: CatalogKind, p: any) {
  return kind === "shift"
    ? shiftSchema.parse(p)
    : kind === "holiday"
      ? z.object({ day: civilDate, name }).strict().parse(p)
      : z.object({ name }).strict().parse(p);
}
function insert(s: Store, kind: CatalogKind, p: any) {
  const id = kind === "holiday" ? p.day : randomUUID();
  if (kind === "shift")
    s.db
      .prepare("INSERT INTO shifts VALUES(?,?,?,?,?)")
      .run(id, p.name, p.start, p.end, p.tolerance);
  else if (kind === "holiday") {
    if (s.one("SELECT day FROM holidays WHERE day=?", id))
      throw new CatalogError(
        "La fecha ya existe, incluso si está archivada.",
        409,
      );
    s.db.prepare("INSERT INTO holidays VALUES(?,?)").run(id, p.name);
    enqueueExceptionWork(s, null, id, id);
  } else
    s.db.prepare("INSERT INTO taxonomy VALUES(?,?,?)").run(id, kind, p.name);
  state(s, kind, id, 0, 1);
  return id;
}
export function createCatalog(
  s: Store,
  kind: CatalogKind,
  raw: unknown,
  actor: string,
) {
  kinds.parse(kind);
  const p = input(kind, raw);
  return s.tx(() => {
    const id = insert(s, kind, p);
    audit(s, id, actor, "Catalog created", null, {
      kind,
      id,
      ...p,
      revision: 1,
      archived: 0,
    });
    return { id };
  });
}
export function editCatalog(
  s: Store,
  kind: CatalogKind,
  id: string,
  raw: unknown,
  actor: string,
) {
  kinds.parse(kind);
  const controls = z
    .object({
      expected_revision: z.number().int().positive(),
      reason: reasonSchema,
      archive: z.boolean().optional(),
    })
    .passthrough()
    .parse(raw);
  const { expected_revision, reason, archive, ...fields } = controls;
  return s.tx(() => {
    const before = listCatalog(s, kind).find((r) => r.id === id);
    if (!before) throw new CatalogError("Registro no encontrado.", 404);
    if (before.revision !== expected_revision)
      throw new CatalogError(
        "El registro cambió. Volvé a abrirlo antes de guardar.",
        409,
      );
    if (before.archived)
      throw new CatalogError("El registro está archivado.", 409);
    if (archive !== undefined && archive !== true)
      throw new CatalogError("No se puede reactivar un registro archivado.");
    if (archive && Object.keys(fields).length)
      throw new CatalogError("Archivar no modifica los campos.");
    let destination: string | undefined;
    if (!archive) {
      const p: any = input(kind, fields);
      if (kind === "shift")
        s.db
          .prepare(
            "UPDATE shifts SET name=?,start=?,end=?,tolerance=? WHERE id=?",
          )
          .run(p.name, p.start, p.end, p.tolerance, id);
      else if (kind === "holiday") {
        if (p.day !== id) {
          destination = insert(s, kind, p);
          state(s, kind, id, 1, before.revision + 1);
        } else
          s.db
            .prepare("UPDATE holidays SET name=? WHERE day=?")
            .run(p.name, id);
      } else
        s.db
          .prepare("UPDATE taxonomy SET name=? WHERE id=? AND kind=?")
          .run(p.name, id, kind);
    }
    if (!destination) state(s, kind, id, archive ? 1 : 0, before.revision + 1);
    if (kind === "holiday") enqueueExceptionWork(s, null, id, id);
    const after = listCatalog(s, kind).find((r) => r.id === id);
    audit(s, id, actor, reason, before, {
      ...after,
      replacement_id: destination,
    });
    if (destination)
      audit(s, destination, actor, reason, null, {
        ...listCatalog(s, kind).find((r) => r.id === destination),
        replaces: id,
      });
    return { id: destination || id };
  });
}
export function migrateCatalogs(s: Store) {
  s.tx(() => {
    if (
      s.one(
        "SELECT name FROM migrations WHERE name='catalog_exact_categories_v1'",
      )
    )
      return;
    for (const site of s.all(
      "SELECT id,category FROM sites WHERE category<>''",
    )) {
      let category = s.one(
        "SELECT id FROM taxonomy WHERE kind='category' AND name=?",
        site.category,
      );
      if (!category) {
        category = { id: randomUUID() };
        s.db
          .prepare("INSERT INTO taxonomy VALUES(?,?,?)")
          .run(category.id, "category", site.category);
      }
      s.db
        .prepare("INSERT OR IGNORE INTO site_categories VALUES(?,?)")
        .run(site.id, category.id);
    }
    s.db
      .prepare("INSERT INTO migrations VALUES('catalog_exact_categories_v1',?)")
      .run(new Date().toISOString());
  });
}
export function setSiteCategory(
  s: Store,
  site: string,
  category: string | null,
) {
  const before = s.one(
    "SELECT category_id FROM site_categories WHERE site_id=?",
    site,
  );
  if (category) {
    if (
      !s.one(
        "SELECT id FROM taxonomy WHERE id=? AND kind='category'",
        category,
      ) ||
      (!catalogActive(s, "category", category) &&
        before?.category_id !== category)
    )
      throw new CatalogError("Elegí una categoría activa válida.");
    s.db
      .prepare(
        "INSERT INTO site_categories VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET category_id=excluded.category_id",
      )
      .run(site, category);
  } else s.db.prepare("DELETE FROM site_categories WHERE site_id=?").run(site);
}
export function publicSites(s: Store) {
  return s.all(
    "SELECT s.*,c.category_id,COALESCE(t.name,'') category FROM sites s LEFT JOIN site_categories c ON c.site_id=s.id LEFT JOIN taxonomy t ON t.id=c.category_id ORDER BY s.name",
  );
}
export function setEmployeeAssociation(
  s: Store,
  employee: string,
  tag: string,
  add: boolean,
  reason: string,
  actor: string,
) {
  reason = reasonSchema.parse(reason);
  return s.tx(() => {
    const category = s.one(
      "SELECT * FROM taxonomy WHERE id=? AND kind IN ('sector','tag')",
      tag,
    );
    if (!category || !s.one("SELECT id FROM employees WHERE id=?", employee))
      throw new CatalogError(
        "Elegí una persona y un sector o etiqueta válidos.",
      );
    if (add && !catalogActive(s, category.kind, tag))
      throw new CatalogError("No se pueden asignar registros archivados.");
    const existed = !!s.one(
      "SELECT employee_id FROM employee_tags WHERE employee_id=? AND tag_id=?",
      employee,
      tag,
    );
    if (existed === add) return;
    if (add)
      s.db.prepare("INSERT INTO employee_tags VALUES(?,?)").run(employee, tag);
    else
      s.db
        .prepare("DELETE FROM employee_tags WHERE employee_id=? AND tag_id=?")
        .run(employee, tag);
    audit(
      s,
      employee,
      actor,
      reason,
      { employee_id: employee, tag_id: tag, assigned: existed },
      { employee_id: employee, tag_id: tag, assigned: add },
    );
  });
}
export function catalogRoutes(app: Express, s: Store) {
  app.get("/api/catalogs", (_req, res) => {
    const ids = scopedEmployees(s, res.locals.user);
    res.json({
      catalogs: Object.fromEntries(
        kinds.options.map((k) => [k, listCatalog(s, k)]),
      ),
      associations: s
        .all("SELECT * FROM employee_tags")
        .filter((a) => ids.includes(a.employee_id)),
    });
  });
  app.post("/api/catalogs/:kind/:id", (req, res) => {
    if (!["admin", "hr"].includes(res.locals.user.role)) {
      res.sendStatus(403);
      return;
    }
    res.json(
      editCatalog(
        s,
        kinds.parse(req.params.kind),
        String(req.params.id),
        req.body,
        res.locals.actor,
      ),
    );
  });
  app.post("/api/catalogs/associations", (req, res) => {
    if (!["admin", "hr"].includes(res.locals.user.role)) {
      res.sendStatus(403);
      return;
    }
    const p = z
      .object({
        employee: z.string(),
        tag: z.string(),
        add: z.boolean(),
        reason: reasonSchema,
      })
      .strict()
      .parse(req.body);
    setEmployeeAssociation(
      s,
      p.employee,
      p.tag,
      p.add,
      p.reason,
      res.locals.actor,
    );
    res.json({ ok: true });
  });
}
