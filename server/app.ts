import { operationRoutes } from "./whatsapp-operations";
import { planningRoutes } from "./weekly-planning";
import {
  catalogRoutes,
  migrateCatalogs,
  listCatalog,
  publicSites,
  setSiteCategory,
  createCatalog,
} from "./catalogs";
import { receiptRoutes } from "./receipts";
import { createLeaveRequest } from "./leaves";
import { simulateEmployeeText, simulateEmployeeMessage } from "./employee-bot";
import { communicationRoutes } from "./communications";
import { exceptionRoutes } from "./attendance-exceptions";
import { enqueueExceptionWork } from "./exception-work";
import { reportingDay } from "../shared/reporting";
import { reportRoutes } from "./reports";
import { installAuth, scopedEmployees } from "./auth";
import express from "express";
import cookieParser from "cookie-parser";
import {
  randomUUID,
  createHmac,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { Store } from "./store";
import { applyAction, correctExit } from "./domain";
import { filterVisits, workedHours } from "../shared/reporting";
import { hrRoutes } from "./hr";
import { scheduleRoutes, migrateLegacySchedules } from "./schedules";
import { civilDate } from "../shared/validation";
import { manualRoutes } from "./manual";
const siteSchema = z.object({
  name: z.string().trim().min(2),
  address: z.string().trim().min(3),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(10).max(1000),
  category_id: z.string().nullable().optional(),
  active: z.coerce.number().min(0).max(1).default(1),
});
const personSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().regex(/^\d{10,15}$/),
  role: z.string().min(2),
  site_ids: z.array(z.string()).min(1),
  active: z.coerce.number().min(0).max(1).default(1),
});
export { processInbox } from "./whatsapp";
export function createApp(s: Store) {
  const app = express();
  app.enable("case sensitive routing");
  app.enable("strict routing");
  const demo =
    process.env.DEMO_MODE === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.DEMO_MODE !== "false");
  app.get("/api/config", (_req, res) =>
    res.json({
      demo,
      defaultPassword:
        process.env.NODE_ENV !== "production" &&
        process.env.ADMIN_PASSWORD === "Carahue-demo-2026",
    }),
  );
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.get("/webhook/whatsapp", (req, res) => {
    if (
      process.env.WHATSAPP_VERIFY_TOKEN &&
      req.query["hub.mode"] === "subscribe" &&
      req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
    )
      res.send(req.query["hub.challenge"]);
    else res.sendStatus(403);
  });
  app.post(
    "/webhook/whatsapp",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res) => {
      const secret = process.env.WHATSAPP_APP_SECRET;
      if (!secret) {
        res.status(503).json({ error: "Webhook sin configurar" });
        return;
      }
      const actual = req.get("x-hub-signature-256") || "";
      if (!Buffer.isBuffer(req.body)) {
        res.sendStatus(415);
        return;
      }
      const expected =
        "sha256=" + createHmac("sha256", secret).update(req.body).digest("hex");
      if (
        Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      ) {
        res.sendStatus(401);
        return;
      }
      try {
        const payload = JSON.parse(req.body.toString());
        s.tx(() => {
          for (const e of payload.entry || [])
            for (const c of e.changes || []) {
              const businessId = c.value?.metadata?.phone_number_id;
              if (
                process.env.WHATSAPP_PHONE_NUMBER_ID &&
                businessId !== process.env.WHATSAPP_PHONE_NUMBER_ID
              )
                continue;
              for (const status of c.value?.statuses || []) {
                if (
                  ["sent", "delivered", "read", "failed"].includes(
                    status.status,
                  )
                )
                  s.db
                    .prepare(
                      "UPDATE outbox SET status=? WHERE provider_id=? AND status NOT IN ('read','delivered')",
                    )
                    .run(status.status, status.id);
              }
              for (const m of c.value?.messages || []) {
                if (
                  typeof m.id !== "string" ||
                  typeof m.from !== "string" ||
                  !/^\d{10,15}$/.test(m.from) ||
                  !Number.isFinite(Number(m.timestamp)) ||
                  !Number.isFinite(
                    new Date(Number(m.timestamp) * 1000).getTime(),
                  )
                )
                  throw new Error("Malformed message");
                const key = (businessId ? businessId + ":" : "") + m.id;
                s.db
                  .prepare(
                    "INSERT OR IGNORE INTO inbox VALUES(?,?,'pending',NULL,?)",
                  )
                  .run(
                    key,
                    JSON.stringify({
                      ...m,
                      provider_message_id: m.id,
                      business_id: businessId,
                      id: key,
                    }),
                    new Date().toISOString(),
                  );
              }
            }
        });
        res.sendStatus(200);
      } catch {
        res.sendStatus(400);
      }
    },
  );
  const json = express.json({ limit: "100kb" });
  app.use((req, res, next) =>
    req.path.toLowerCase().startsWith("/api/receipts")
      ? next()
      : json(req, res, next),
  );
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (
      req.method !== "GET" &&
      origin &&
      new URL(origin).host !== req.get("host")
    ) {
      res.sendStatus(403);
      return;
    }
    next();
  });
  installAuth(app, s);
  migrateLegacySchedules(s);
  migrateCatalogs(s);
  app.post("/api/logout", (req, res) => {
    s.db.prepare("DELETE FROM sessions WHERE token=?").run(req.cookies.session);
    res.clearCookie("session");
    res.json({ ok: true });
  });
  app.get("/api/state", (_req, res) =>
    res.json({
      employees: s
        .all("SELECT * FROM employees ORDER BY name")
        .map((e) => ({ ...e, site_ids: JSON.parse(e.site_ids) })),
      sites: publicSites(s),
      categories: listCatalog(s, "category"),
      visits: s.all("SELECT * FROM visits ORDER BY entry_at DESC"),
      alerts: s.all("SELECT * FROM alerts ORDER BY created_at DESC"),
      audit: s.all("SELECT * FROM audit ORDER BY created_at DESC"),
      leaves: s.all("SELECT * FROM leaves ORDER BY date_from DESC"),
      shifts: listCatalog(s, "shift"),
      breaks: s.all("SELECT * FROM breaks"),
      integration: {
        mode: "local",
        configured: !!process.env.WHATSAPP_APP_SECRET,
        sending: process.env.WHATSAPP_SEND_ENABLED === "true",
        demo,
        inbox: s.all(
          "SELECT id,status,error,created_at FROM inbox ORDER BY created_at DESC LIMIT 30",
        ),
        outbox: s.all(
          "SELECT id,text,status,created_at,error,attempts FROM outbox ORDER BY created_at DESC LIMIT 30",
        ),
      },
    }),
  );
  app.post("/api/employees", (req, res) => {
    const p = personSchema.parse(req.body);
    if (
      p.site_ids.some(
        (id) => !s.one("SELECT id FROM sites WHERE id=? AND active=1", id),
      )
    )
      throw new Error("Elegí sedes activas.");
    const id = req.body.id || randomUUID();
    if (req.body.id && !s.one("SELECT id FROM employees WHERE id=?", id))
      throw new Error("Empleado no encontrado.");
    s.tx(() => {
      const before = s.one("SELECT active FROM employees WHERE id=?", id);
      s.db
        .prepare(
          "INSERT INTO employees VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,role=excluded.role,site_ids=excluded.site_ids,active=excluded.active",
        )
        .run(id, p.name, p.phone, p.role, JSON.stringify(p.site_ids), p.active);
      const today = reportingDay(new Date().toISOString());
      enqueueExceptionWork(s, id, today, today);
      if (before && before.active !== p.active) {
        for (const x of s.all(
          "SELECT DISTINCT day FROM attendance_exceptions WHERE employee_id=?",
          id,
        ))
          enqueueExceptionWork(s, id, x.day, x.day);
        s.db
          .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
          .run(
            randomUUID(),
            id,
            res.locals.actor,
            "Employee activation changed",
            JSON.stringify({ employee_id: id, active: before.active }),
            JSON.stringify({ employee_id: id, active: p.active }),
            new Date().toISOString(),
          );
      }
    });
    res.json({ id });
  });
  app.post("/api/sites", (req, res) => {
    if (Object.hasOwn(req.body, "category"))
      throw new Error("Usá una categoría del catálogo mediante category_id.");
    const p = siteSchema.parse(req.body);
    const id = req.body.id || randomUUID();
    s.tx(() => {
      const before = s.one("SELECT * FROM sites WHERE id=?", id);
      if (req.body.id && !before) throw new Error("Sede no encontrada.");
      s.db
        .prepare(
          "INSERT INTO sites VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,lat=excluded.lat,lon=excluded.lon,radius=excluded.radius,active=excluded.active",
        )
        .run(
          id,
          p.name,
          p.address,
          p.lat,
          p.lon,
          p.radius,
          before?.category || "",
          p.active,
        );
      if (p.category_id !== undefined) setSiteCategory(s, id, p.category_id);
      s.db
        .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          id,
          res.locals.actor,
          "Site configuration updated",
          JSON.stringify(before || null),
          JSON.stringify(publicSites(s).find((site) => site.id === id)),
          new Date().toISOString(),
        );
    });
    res.json({ id });
  });
  app.post("/api/simulate", (req, res) => {
    res.json(
      applyAction(s, {
        ...req.body,
        id: randomUUID(),
        time: new Date().toISOString(),
        source: "simulator",
      }),
    );
  });
  app.post("/api/simulate/text", (req, res) => {
    const p = z
      .object({
        phone: z.string().regex(/^\d{10,15}$/),
        text: z.string().trim().min(1).max(4000),
      })
      .strict()
      .parse(req.body);
    res.json(simulateEmployeeText(s, p.phone, p.text, res.locals.actor));
  });
  app.post("/api/simulate/location", (req, res) => {
    const p = z
      .object({
        phone: z.string().regex(/^\d{10,15}$/),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict()
      .parse(req.body);
    res.json(
      simulateEmployeeMessage(
        s,
        p.phone,
        {
          type: "location",
          location: { latitude: p.latitude, longitude: p.longitude },
        },
        res.locals.actor,
      ),
    );
  });
  app.get("/api/simulate/text/:employee", (req, res) => {
    if (!["admin", "hr"].includes(res.locals.user.role)) {
      res.sendStatus(403);
      return;
    }
    res.json(
      s
        .all(
          "SELECT time,input_text,reply,status FROM employee_bot_results WHERE source='simulator' AND employee_id=? ORDER BY rowid DESC LIMIT 50",
          String(req.params.employee),
        )
        .reverse(),
    );
  });
  app.post("/api/correct", (req, res) =>
    res.json(
      correctExit(
        s,
        req.body.id,
        new Date(req.body.time).toISOString(),
        req.body.reason,
        res.locals.actor,
      ),
    ),
  );
  app.post("/api/leaves", (req, res) =>
    res.json({
      ok: true,
      id: createLeaveRequest(s, req.body, res.locals.actor, "hr"),
    }),
  );
  app.post("/api/leaves/:id/decision", (req, res) => {
    const status = z.enum(["approved", "rejected"]).parse(req.body.status);
    const before = s.one(
      "SELECT * FROM leaves WHERE id=? AND status='pending'",
      req.params.id,
    );
    if (!before) throw new Error("La solicitud ya fue resuelta.");
    s.tx(() => {
      s.db
        .prepare("UPDATE leaves SET status=? WHERE id=?")
        .run(status, req.params.id);
      if (status === "approved")
        enqueueExceptionWork(
          s,
          before.employee_id,
          before.date_from,
          before.date_to,
        );
      s.db
        .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          req.params.id,
          res.locals.actor,
          "Leave decision",
          JSON.stringify(before),
          JSON.stringify({ ...before, status }),
          new Date().toISOString(),
        );
    });
    res.json({ ok: true });
  });
  app.post("/api/shifts", (req, res) => {
    res.json(createCatalog(s, "shift", req.body, res.locals.actor));
  });
  catalogRoutes(app, s);
  receiptRoutes(app, s);
  communicationRoutes(app, s);
  exceptionRoutes(app, s);
  hrRoutes(app, s);
  scheduleRoutes(app, s);
  planningRoutes(app, s);
  manualRoutes(app, s);
  reportRoutes(app, s);
  operationRoutes(app, s);
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.status || 400).json({
        error:
          err instanceof z.ZodError
            ? "Revisá los campos del formulario."
            : String(err.message).includes("UNIQUE")
              ? "Ya existe un empleado con ese teléfono."
              : err.message || "No se pudo guardar. Intentá nuevamente.",
      });
    },
  );
  return app;
}
