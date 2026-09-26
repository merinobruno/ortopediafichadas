import { catalogActive, listCatalog } from "./catalogs";
import { BOT_HELP } from "./employee-bot";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { Store } from "./store";
import { reportingDay } from "../shared/reporting";
const types = z.enum([
  "circular",
  "notification",
  "warning",
  "memo",
  "request",
  "other",
]);
const variables = z
  .array(z.enum(["nombre", "sedes", "empresa", "fecha"]))
  .max(4);
const content = {
  type: types,
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  variables,
  requires_signature: z.boolean(),
};
const templateSchema = z
  .object({
    ...content,
    id: z.string().optional(),
    expected_revision: z.number().int().positive().optional(),
    name: z.string().trim().min(2).max(100),
    description: z.string().max(500),
    order: z.number().int().min(0).max(9999),
  })
  .strict();
const campaignSchema = z
  .object({
    ...content,
    id: z.string().optional(),
    expected_revision: z.number().int().positive().optional(),
    channel: z.enum(["telegram", "email", "both"]),
    template_id: z.string().nullable().optional(),
    template_revision: z.number().int().positive().nullable().optional(),
    selection: z
      .object({
        mode: z.enum(["all", "sector", "individual"]),
        employee_ids: z.array(z.string()).max(1000),
        sector_id: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
function checkPlaceholders(p: {
  subject: string;
  body: string;
  variables: string[];
}) {
  for (const text of [p.subject, p.body]) {
    const tokens = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]);
    if (
      tokens.some((t) => !p.variables.includes(t)) ||
      text.replace(/\{\{[^{}]+\}\}/g, "").includes("{{") ||
      text.replace(/\{\{[^{}]+\}\}/g, "").includes("}}")
    )
      throw new Error(
        "Revisá las variables: usá sólo los nombres declarados entre dobles llaves.",
      );
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
export function saveTemplate(s: Store, input: unknown, actor: string) {
  const p = templateSchema.parse(input);
  checkPlaceholders(p);
  return s.tx(() => {
    const before = p.id
      ? s.one("SELECT * FROM communication_templates WHERE id=?", p.id)
      : null;
    if (p.id && (!before || before.revision !== p.expected_revision))
      throw new Error("La plantilla cambió. Volvé a abrirla antes de guardar.");
    const id = p.id || randomUUID(),
      revision = (before?.revision || 0) + 1;
    const { id: _id, expected_revision: _expected, ...document } = p;
    s.db
      .prepare(
        "INSERT INTO communication_templates VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision",
      )
      .run(id, revision);
    s.db
      .prepare("INSERT INTO communication_template_revisions VALUES(?,?,?,?,?)")
      .run(
        id,
        revision,
        JSON.stringify(document),
        actor,
        new Date().toISOString(),
      );
    audit(s, id, actor, "Local template revision saved", before, {
      id,
      revision,
      document,
    });
    return { id, revision };
  });
}
export function archiveTemplate(
  s: Store,
  id: string,
  archived: boolean,
  actor: string,
) {
  s.tx(() => {
    const before = s.one(
      "SELECT * FROM communication_templates WHERE id=?",
      id,
    );
    if (!before) throw new Error("Plantilla no encontrada.");
    if (!!before.archived === archived) return;
    s.db
      .prepare("UPDATE communication_templates SET archived=? WHERE id=?")
      .run(archived ? 1 : 0, id);
    audit(s, id, actor, "Local template archive updated", before, {
      ...before,
      archived,
    });
  });
}
export function saveCampaign(s: Store, input: unknown, actor: string) {
  const p = campaignSchema.parse(input);
  checkPlaceholders(p);
  return s.tx(() => {
    const before = p.id
      ? s.one("SELECT * FROM communication_campaigns WHERE id=?", p.id)
      : null;
    if (p.id && (!before || before.revision !== p.expected_revision))
      throw new Error("El borrador cambió. Volvé a abrirlo antes de guardar.");
    if (p.template_id) {
      if (
        !p.template_revision ||
        !s.one(
          "SELECT r.template_id FROM communication_template_revisions r JOIN communication_templates t ON t.id=r.template_id WHERE t.id=? AND r.revision=? AND t.archived=0",
          p.template_id,
          p.template_revision,
        )
      )
        throw new Error("Elegí una revisión de plantilla activa.");
    } else if (p.template_revision)
      throw new Error("La revisión requiere una plantilla.");
    if (
      p.selection.mode === "sector" &&
      !catalogActive(s, "sector", p.selection.sector_id!)
    )
      throw new Error("Elegí un sector activo.");
    if (
      p.selection.mode === "sector" &&
      !s.one(
        "SELECT id FROM taxonomy WHERE id=? AND kind='sector'",
        p.selection.sector_id,
      )
    )
      throw new Error("Elegí un sector válido.");
    if (
      p.selection.employee_ids.some(
        (id) => !s.one("SELECT id FROM employees WHERE id=?", id),
      )
    )
      throw new Error("La selección incluye empleados inexistentes.");
    if (p.selection.mode === "individual" && !p.selection.employee_ids.length)
      throw new Error("Seleccioná al menos un empleado.");
    const id = p.id || randomUUID(),
      revision = (before?.revision || 0) + 1;
    const { id: _id, expected_revision: _expected, ...document } = p;
    document.selection = {
      ...p.selection,
      employee_ids: [...new Set(p.selection.employee_ids)].sort(),
    };
    s.db
      .prepare(
        "INSERT INTO communication_campaigns VALUES(?,?,?,'draft',NULL,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,document_json=excluded.document_json,status='draft',preparation_id=NULL,updated_at=excluded.updated_at",
      )
      .run(id, revision, JSON.stringify(document), new Date().toISOString());
    audit(s, id, actor, "Communication draft saved", before, {
      id,
      revision,
      document,
    });
    return { id, revision };
  });
}
const escapeText = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
function sites(s: Store, e: any) {
  const ids = JSON.parse(e.site_ids);
  return s
    .all("SELECT id,name FROM sites WHERE active=1 ORDER BY name")
    .filter((x) => ids.includes(x.id))
    .map((x) => x.name);
}
export function previewCampaign(s: Store, id: string) {
  const c = s.one("SELECT * FROM communication_campaigns WHERE id=?", id);
  if (!c) throw new Error("Borrador no encontrado.");
  if (c.status === "incompatible")
    throw new Error(
      "Este borrador usa datos de teléfono anteriores. Creá uno nuevo para Telegram.",
    );
  const p = JSON.parse(c.document_json),
    selection = p.selection;
  let employees = s.all("SELECT * FROM employees ORDER BY name,id");
  if (selection.mode === "individual") {
    employees = employees.filter((e) => selection.employee_ids.includes(e.id));
    if (employees.some((e) => !e.active))
      throw new Error(
        "La selección individual contiene empleados inactivos. Revisá los destinatarios.",
      );
  } else {
    employees = employees.filter((e) => e.active);
    if (selection.mode === "sector") {
      if (!catalogActive(s, "sector", selection.sector_id))
        throw new Error("El sector está archivado; revisá los destinatarios.");
      const ids = new Set(
        s
          .all(
            "SELECT employee_id FROM employee_tags WHERE tag_id=?",
            selection.sector_id,
          )
          .map((x) => x.employee_id),
      );
      employees = employees.filter((e) => ids.has(e.id));
    }
  }
  if (employees.length > 1000)
    throw new Error(
      "La preparación local admite hasta 1000 destinatarios. Dividí la selección.",
    );
  const day = reportingDay(new Date().toISOString());
  const recipients = employees.map((e) => {
    const values: Record<string, string> = {
      nombre: e.name,
      sedes: sites(s, e).join(", ") || "Sin sedes autorizadas",
      empresa: "Carahue",
      fecha: day,
    };
    const render = (text: string) =>
      text.replace(/\{\{([^{}]+)\}\}/g, (_match, key) => values[key]);
    const subject = render(p.subject),
      body = render(p.body);
    return {
      employee_id: e.id,
      name: e.name,
      subject,
      body,
      body_escaped: escapeText(body),
      subject_escaped: escapeText(subject),
    };
  });
  return {
    campaign_id: id,
    revision: c.revision,
    document: p,
    recipients,
    channel: p.channel,
    requires_signature: p.requires_signature,
    dispatch_available: false,
    provider_approved: false,
    signature_available: false,
  };
}
export function prepareCampaign(
  s: Store,
  id: string,
  expectedRevision: number,
  actor: string,
) {
  return s.tx(() => {
    const c = s.one("SELECT * FROM communication_campaigns WHERE id=?", id);
    if (!c || c.revision !== expectedRevision)
      throw new Error("El borrador cambió. Actualizá la vista previa.");
    const selection = JSON.parse(c.document_json).selection;
    if (
      selection.mode === "sector" &&
      !catalogActive(s, "sector", selection.sector_id)
    )
      throw new Error("El sector está archivado; revisá los destinatarios.");
    const existing = s.one(
      "SELECT * FROM communication_preparations WHERE campaign_id=? AND revision=?",
      id,
      c.revision,
    );
    if (existing) return { id: existing.id, revision: c.revision };
    const snapshot = previewCampaign(s, id);
    if (!snapshot.recipients.length)
      throw new Error("No hay destinatarios activos para preparar.");
    const preparation = randomUUID();
    s.db
      .prepare("INSERT INTO communication_preparations VALUES(?,?,?,?,?,?)")
      .run(
        preparation,
        id,
        c.revision,
        JSON.stringify(snapshot),
        actor,
        new Date().toISOString(),
      );
    s.db
      .prepare(
        "UPDATE communication_campaigns SET status='prepared',preparation_id=? WHERE id=?",
      )
      .run(preparation, id);
    audit(s, id, actor, "Local preparation frozen; no dispatch", null, {
      preparation_id: preparation,
      revision: c.revision,
      recipient_count: snapshot.recipients.length,
    });
    return { id: preparation, revision: c.revision };
  });
}
export function onboardingPreview(s: Store, employeeId: string) {
  const e = s.one(
    "SELECT * FROM employees WHERE id=? AND active=1",
    employeeId,
  );
  if (!e) throw new Error("Elegí un empleado activo.");
  const authorized = sites(s, e);
  return {
    employee_id: e.id,
    dispatch_available: false,
    identity_verified: false,
    text: `Hola ${e.name}. RRHH te dará un código de un solo uso para vincularte en el chat privado del bot de Telegram. Enviá /start seguido del código dentro de los 15 minutos.\nAl entrar escribí entrada y compartí tu ubicación actual en Telegram. Al salir escribí salida y volvé a compartir tu ubicación.\nSedes autorizadas: ${authorized.join(", ") || "ninguna; contactá a RRHH"}.\nPodés registrar varias visitas en distintas sedes y volver a una sede durante el día. Si entrás en otra sede sin cerrar la anterior, se registra la nueva entrada y RRHH recibe una alerta de salida desconocida.\n${BOT_HELP}\nEstas instrucciones no verifican identidad ni registran aceptación de términos o firma.`,
  };
}
export function communicationRoutes(app: Express, s: Store) {
  app.use("/api/communications", (_req, res, next) => {
    if (!["admin", "hr"].includes(res.locals.user?.role)) {
      res.status(403).json({
        error: "Sólo RRHH y administración pueden gestionar comunicaciones.",
      });
      return;
    }
    next();
  });
  app.get("/api/communications", (_req, res) =>
    res.json({
      sectors: listCatalog(s, "sector").filter((t) => !t.archived),
      templates: s
        .all(
          "SELECT t.*,r.document_json FROM communication_templates t JOIN communication_template_revisions r ON r.template_id=t.id AND r.revision=t.revision",
        )
        .map((x) => ({
          ...x,
          document: JSON.parse(x.document_json),
          document_json: undefined,
        })),
      campaigns: s
        .all("SELECT * FROM communication_campaigns ORDER BY updated_at DESC")
        .map((x) => ({
          ...x,
          document: JSON.parse(x.document_json),
          document_json: undefined,
        })),
      dispatch_available: false,
    }),
  );
  app.post("/api/communications/templates", (req, res) =>
    res.json(saveTemplate(s, req.body, res.locals.actor)),
  );
  app.post("/api/communications/templates/:id/archive", (req, res) => {
    const p = z.object({ archived: z.boolean() }).strict().parse(req.body);
    archiveTemplate(s, String(req.params.id), p.archived, res.locals.actor);
    res.json({ ok: true });
  });
  app.get("/api/communications/templates/:id/revisions", (req, res) =>
    res.json(
      s
        .all(
          "SELECT * FROM communication_template_revisions WHERE template_id=? ORDER BY revision DESC",
          String(req.params.id),
        )
        .map((x) => ({
          ...x,
          document: JSON.parse(x.document_json),
          document_json: undefined,
        })),
    ),
  );
  app.post("/api/communications/drafts", (req, res) =>
    res.json(saveCampaign(s, req.body, res.locals.actor)),
  );
  app.get("/api/communications/drafts/:id/preview", (req, res) =>
    res.json(previewCampaign(s, String(req.params.id))),
  );
  app.get("/api/communications/drafts/:id/preparations", (req, res) =>
    res.json(
      s
        .all(
          "SELECT * FROM communication_preparations WHERE campaign_id=? ORDER BY revision DESC",
          String(req.params.id),
        )
        .map((x) => ({
          ...x,
          snapshot: JSON.parse(x.snapshot_json),
          snapshot_json: undefined,
        })),
    ),
  );
  app.post("/api/communications/drafts/:id/prepare", (req, res) => {
    const p = z
      .object({ expected_revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    res.json(
      prepareCampaign(
        s,
        String(req.params.id),
        p.expected_revision,
        res.locals.actor,
      ),
    );
  });
  app.get("/api/communications/onboarding/:employee", (req, res) =>
    res.json(onboardingPreview(s, String(req.params.employee))),
  );
}
