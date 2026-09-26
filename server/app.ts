import { operationRoutes } from "./telegram-operations";
import { issueLinkCode, revokeLink } from "./telegram-links";
import { parseTelegramUpdate } from "./telegram-update";
import { receiveTelegramUpdate, processTelegramInbox } from "./telegram";
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
import { randomUUID, timingSafeEqual } from "node:crypto";
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
  role: z.string().min(2),
  site_ids: z.array(z.string()).min(1),
  active: z.coerce.number().min(0).max(1).default(1),
});
export { processTelegramInbox as processInbox } from "./telegram";
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
  app.post(
    "/webhook/telegram",
    (req, res, next) => {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (!secret) return res.sendStatus(503);
      const supplied = req.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (
        Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
      )
        return res.sendStatus(401);
      next();
    },
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
      try {
        const event = parseTelegramUpdate(JSON.parse(req.body.toString()));
        if (event) receiveTelegramUpdate(s, event);
        return res.sendStatus(200);
      } catch {
        return res.sendStatus(400);
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
      employees: s.all("SELECT * FROM employees ORDER BY name").map((e) => ({
        ...e,
        site_ids: JSON.parse(e.site_ids),
        telegram_linked: !!s.one(
          "SELECT 1 FROM telegram_links WHERE employee_id=?",
          e.id,
        ),
      })),
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
        configured: !!process.env.TELEGRAM_WEBHOOK_SECRET,
        sending: process.env.TELEGRAM_SEND_ENABLED === "true",
        demo,
        inbox: s.all(
          "SELECT update_id,status,reason_code,received_at FROM telegram_inbox ORDER BY received_at DESC LIMIT 30",
        ),
        outbox: s.all(
          "SELECT id,status,reason_code,created_at,attempts FROM telegram_outbox ORDER BY created_at DESC LIMIT 30",
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
          "INSERT INTO employees(id,name,role,site_ids,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,site_ids=excluded.site_ids,active=excluded.active",
        )
        .run(id, p.name, p.role, JSON.stringify(p.site_ids), p.active);
      if (!p.active && before?.active) revokeLink(s, id, res.locals.actor);
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
  app.post("/api/employees/:id/telegram-code", (req, res) => {
    if (!["admin", "hr"].includes(res.locals.user.role))
      return res.sendStatus(403);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(issueLinkCode(s, String(req.params.id), res.locals.actor));
  });
  app.post("/api/employees/:id/telegram-revoke", (req, res) => {
    if (!["admin", "hr"].includes(res.locals.user.role))
      return res.sendStatus(403);
    res.setHeader("Cache-Control", "private, no-store");
    revokeLink(s, String(req.params.id), res.locals.actor);
    return res.json({ ok: true });
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
        employeeId: z.string().min(1),
        text: z.string().trim().min(1).max(4000),
      })
      .strict()
      .parse(req.body);
    res.json(simulateEmployeeText(s, p.employeeId, p.text, res.locals.actor));
  });
  app.post("/api/simulate/location", (req, res) => {
    const p = z
      .object({
        employeeId: z.string().min(1),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict()
      .parse(req.body);
    res.json(
      simulateEmployeeMessage(
        s,
        p.employeeId,
        { kind: "location", latitude: p.latitude, longitude: p.longitude },
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
              ? "Ya existe un registro con esos datos."
              : err.message || "No se pudo guardar. Intentá nuevamente.",
      });
    },
  );
  return app;
}
