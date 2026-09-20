import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { Store } from "./store";
const schema = z.object({
  id: z.string().optional(),
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  name: z.string().trim().min(2),
  password: z.string().min(12).max(256).optional(),
  role: z.enum(["admin", "hr", "supervisor"]),
  active: z.boolean(),
  employee_ids: z.array(z.string()).default([]),
});
export const publicUser = (u: any) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  active: !!u.active,
  employee_ids: JSON.parse(u.employee_ids),
});
const hash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
};
const verify = (password: string, value: string) => {
  const [salt, digest] = value.split(":");
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
export function upsertUser(s: Store, input: unknown, actor: string) {
  const p = schema.parse(input);
  return s.tx(() => {
    const before = p.id ? s.one("SELECT * FROM users WHERE id=?", p.id) : null;
    if (p.id && !before) throw new Error("Usuario no encontrado.");
    if (!before && !p.password)
      throw new Error("Ingresá una contraseña de al menos 12 caracteres.");
    if (
      p.employee_ids.some(
        (id) => !s.one("SELECT id FROM employees WHERE id=?", id),
      )
    )
      throw new Error("La asignación contiene empleados inexistentes.");
    if (
      before?.active &&
      before.role === "admin" &&
      (!p.active || p.role !== "admin") &&
      s.one("SELECT COUNT(*) AS n FROM users WHERE active=1 AND role='admin'")
        .n <= 1
    )
      throw new Error("Debe quedar al menos un administrador activo.");
    const id = p.id || randomUUID();
    s.db
      .prepare(
        "INSERT INTO users VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,password_hash=excluded.password_hash,role=excluded.role,active=excluded.active,employee_ids=excluded.employee_ids",
      )
      .run(
        id,
        p.email,
        p.name,
        p.password ? hash(p.password) : before.password_hash,
        p.role,
        p.active ? 1 : 0,
        JSON.stringify(p.role === "supervisor" ? p.employee_ids : []),
      );
    s.db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        id,
        actor,
        "User access updated",
        JSON.stringify(before ? publicUser(before) : null),
        JSON.stringify(publicUser(s.one("SELECT * FROM users WHERE id=?", id))),
        new Date().toISOString(),
      );
    return id;
  });
}
export function scopedEmployees(s: Store, user: any) {
  return user.role === "supervisor"
    ? (JSON.parse(user.employee_ids) as string[])
    : s.all("SELECT id FROM employees").map((e) => e.id);
}
export function scopePayload(s: Store, user: any, data: any) {
  if (user.role !== "supervisor") return data;
  const ids = new Set(scopedEmployees(s, user));
  const visits = new Set(
    s
      .all("SELECT id,employee_id FROM visits")
      .filter((v) => ids.has(v.employee_id))
      .map((v) => v.id),
  );
  for (const key of [
    "employees",
    "visits",
    "alerts",
    "leaves",
    "assignments",
    "employeeTags",
  ])
    if (data[key])
      data[key] = data[key].filter((r: any) =>
        ids.has(key === "employees" ? r.id : r.employee_id),
      );
  for (const key of ["breaks", "overtime"])
    if (data[key])
      data[key] = data[key].filter((r: any) => visits.has(r.visit_id));
  if (data.sites) {
    const allowed = new Set(
      s
        .all("SELECT * FROM employees")
        .filter((e) => ids.has(e.id))
        .flatMap((e) => JSON.parse(e.site_ids)),
    );
    data.sites = data.sites.filter((r: any) => allowed.has(r.id));
  }
  if (data.audit)
    data.audit = data.audit.filter((a: any) => {
      try {
        const record = JSON.parse(a.after_json);
        if (record?.private_receipt) return false;
        const id =
          record?.employee_id ||
          record?.employee ||
          (record?.visit_id
            ? s.one(
                "SELECT employee_id FROM visits WHERE id=?",
                record.visit_id,
              )?.employee_id
            : null) ||
          (record?.visit
            ? s.one("SELECT employee_id FROM visits WHERE id=?", record.visit)
                ?.employee_id
            : null);
        return id && ids.has(id);
      } catch {
        return false;
      }
    });
  if (data.integration)
    data.integration = { ...data.integration, inbox: [], outbox: [] };
  return data;
}
export function installAuth(app: Express, s: Store) {
  if (!s.one("SELECT id FROM users LIMIT 1") && process.env.ADMIN_PASSWORD) {
    upsertUser(
      s,
      {
        email: process.env.ADMIN_EMAIL || "admin@carahue.local",
        name: "Administrador",
        password: process.env.ADMIN_PASSWORD,
        role: "admin",
        active: true,
        employee_ids: [],
      },
      "bootstrap",
    );
    s.db.prepare("DELETE FROM sessions WHERE user_id IS NULL").run();
  }
  const attempts = new Map<string, { count: number; until: number }>();
  app.post("/api/login", (req, res) => {
    const key = req.ip || "local";
    const now = Date.now();
    let bucket = attempts.get(key);
    if (!bucket || bucket.until < now) {
      bucket = { count: 0, until: now + 900000 };
      attempts.set(key, bucket);
    }
    if (bucket.count >= 10) {
      res
        .status(429)
        .json({ error: "Demasiados intentos. Esperá 15 minutos." });
      return;
    }
    bucket.count++;
    const email = String(
      req.body.email || process.env.ADMIN_EMAIL || "admin@carahue.local",
    )
      .trim()
      .toLowerCase();
    const user = s.one("SELECT * FROM users WHERE email=? AND active=1", email);
    const password = req.body.password;
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    if (
      typeof password !== "string" ||
      password.length > 256 ||
      !verify(password, user?.password_hash || dummy) ||
      !user
    ) {
      res.status(401).json({ error: "Correo o contraseña incorrectos." });
      return;
    }
    attempts.delete(key);
    const token = randomBytes(32).toString("hex");
    s.db
      .prepare(
        "INSERT INTO sessions(token,actor,expires_at,user_id) VALUES(?,?,?,?)",
      )
      .run(
        token,
        user.email,
        new Date(now + 8 * 3600000).toISOString(),
        user.id,
      );
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 3600000,
    });
    res.json({ ok: true, user: publicUser(user) });
  });
  app.use("/api", (req, res, next) => {
    const user = s.one(
      "SELECT u.* FROM users u JOIN sessions ss ON ss.user_id=u.id WHERE ss.token=? AND ss.expires_at>? AND u.active=1",
      req.cookies.session || "",
      new Date().toISOString(),
    );
    if (!user) {
      res.status(401).json({ error: "Iniciá sesión para continuar." });
      return;
    }
    res.locals.actor = user.email;
    res.locals.user = user;
    const path = req.path.toLowerCase().replace(/\/+$/, "") || "/";
    const denied = () =>
      res
        .status(403)
        .json({ error: "No tenés permiso para acceder a estos datos." });
    if (path.startsWith("/users") && user.role !== "admin") {
      denied();
      return;
    }
    if (
      user.role === "supervisor" &&
      req.method !== "GET" &&
      path !== "/logout"
    ) {
      const ids = scopedEmployees(s, user);
      let employee: string | undefined;
      if (/^\/leaves\/[^/]+\/decision$/.test(path))
        employee = s.one(
          "SELECT employee_id FROM leaves WHERE id=?",
          path.split("/")[2],
        )?.employee_id;
      else if (/^\/hr\/overtime\/[^/]+$/.test(path))
        employee = s.one(
          "SELECT v.employee_id FROM overtime o JOIN visits v ON v.id=o.visit_id WHERE o.id=?",
          path.split("/")[3],
        )?.employee_id;
      if (!employee || !ids.includes(employee)) {
        denied();
        return;
      }
    }
    if (path === "/state" || path === "/hr") {
      const original = res.json.bind(res);
      res.json = ((body: any) =>
        original(
          scopePayload(
            s,
            user,
            path === "/state" ? { ...body, user: publicUser(user) } : body,
          ),
        )) as typeof res.json;
    }
    next();
  });
  app.get("/api/users", (_req, res) =>
    res.json(s.all("SELECT * FROM users ORDER BY name").map(publicUser)),
  );
  app.post("/api/users", (req, res) => {
    try {
      res.json({ id: upsertUser(s, req.body, res.locals.actor) });
    } catch (e) {
      res.status(400).json({
        error:
          e instanceof z.ZodError
            ? "Revisá los datos; la contraseña debe tener al menos 12 caracteres."
            : (e as Error).message.includes("UNIQUE")
              ? "Ya existe una cuenta con ese correo."
              : (e as Error).message,
      });
    }
  });
}
