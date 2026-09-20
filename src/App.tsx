import WhatsAppOperations from "./WhatsAppOperations";
import WeeklyPlanning from "./WeeklyPlanning";
import Catalogs from "./Catalogs";
import Receipts from "./Receipts";
import BotSimulator from "./BotSimulator";
import Communications from "./Communications";
import AttendanceExceptions from "./AttendanceExceptions";
import Reports from "./Reports";
import ManualAttendance from "./ManualAttendance";
import ScheduleCalendar from "./ScheduleCalendar";
import Accounts from "./Accounts";
import HROperations from "./HROperations";
import { filterVisits, workedHours } from "../shared/reporting";
import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import {
  LayoutDashboard,
  Clock3,
  Users,
  MapPin,
  TriangleAlert,
  ChartNoAxesCombined,
  MessageCircle,
  Settings,
  CalendarDays,
  ClipboardList,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Download,
  Search,
  ChevronRight,
  LogOut,
  Check,
  Building2,
  Menu,
  X,
  Navigation,
  Send,
  RefreshCw,
} from "lucide-react";
type Row = Record<string, any>;
type State = {
  employees: Row[];
  sites: Row[];
  visits: Row[];
  alerts: Row[];
  audit: Row[];
  leaves: Row[];
  shifts: Row[];
  categories: Row[];
  user: Row;
  integration: Row;
  breaks: Row[];
};
const nav = [
  ["dashboard", "Resumen", LayoutDashboard],
  ["attendance", "Fichadas", Clock3],
  ["people", "Empleados", Users],
  ["sites", "Sedes", MapPin],
  ["alerts", "Alertas", TriangleAlert],
  ["leaves", "Licencias", CalendarDays],
  ["shifts", "Turnos", ClipboardList],
  ["calendar", "Calendario y rotaciones", CalendarDays],
  ["weekly", "Plan semanal", CalendarDays],
  ["reports", "Reportes", ChartNoAxesCombined],
  ["simulator", "Simulador", MessageCircle],
  ["hr", "Operación de RRHH", ClipboardList],
  ["waOperations", "Operación WhatsApp", MessageCircle],
  ["settings", "Configuración", Settings],
  ["accounts", "Usuarios y permisos", Users],
  ["communications", "Comunicaciones", MessageCircle],
  ["receipts", "Recibos privados", ClipboardList],
] as const;
const labels: Row = {
  open: "En sede",
  complete: "Completa",
  exit_unknown: "Salida desconocida",
  corrected: "Corregida",
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};
const time = (v: string) =>
  v
    ? new Date(v).toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const date = (v: string) =>
  new Date(v).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "short",
  });
const initials = (v: string) =>
  v
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
async function api(path: string, data?: any) {
  const r = await fetch("/api/" + path, {
    method: data ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok) {
    const error = Object.assign(
      new Error(b.error || "No se pudo conectar. Intentá nuevamente."),
      { status: r.status },
    );
    throw error;
  }
  return b;
}
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value}>
      <i />
      {labels[value] || value}
    </span>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export default function App() {
  const [data, setData] = useState<State | null>(null),
    [auth, setAuth] = useState(false),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("dashboard"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(""),
    [siteFilter, setSiteFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [editor, setEditor] = useState<Row | null>(null),
    [sim, setSim] = useState<Row>({
      employee: "demo-0",
      site: "centro",
      action: "entry",
      outside: false,
    }),
    [chat, setChat] = useState<Row[]>([]),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [personFilter, setPersonFilter] = useState("");
  const [planningLocked, setPlanningLocked] = useState(false);
  const [config, setConfig] = useState({ demo: false, defaultPassword: false });
  useEffect(() => {
    api("config")
      .then(setConfig)
      .catch(() => {});
  }, []);
  const refresh = async () => {
    try {
      setData(await api("state"));
      setAuth(true);
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        setAuth(false);
        setData(null);
      } else
        setError(
          "No se pudo actualizar. Tus datos anteriores siguen visibles; intentá nuevamente.",
        );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    setPage("dashboard");
    setEditor(null);
    setMobile(false);
    setSearch("");
    setSiteFilter("");
    setStatusFilter("");
    setFrom("");
    setTo("");
    setPersonFilter("");
    setNotice("");
    setError("");
    setChat([]);
  }, [data?.user?.id, auth]);
  useEffect(() => {
    if (!auth) return;
    const interval = setInterval(() => refresh(), 30000);
    return () => clearInterval(interval);
  }, [auth]);
  const run = async (
    path: string,
    value: any,
    success = "Cambios guardados",
  ) => {
    setBusy(true);
    setError("");
    try {
      const r = await api(path, value);
      await refresh();
      setNotice(success);
      setEditor(null);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const go = (p: string) => {
    if (planningLocked) return;
    setPage(p);
    setSiteFilter("");
    setStatusFilter("");
    setFrom("");
    setTo("");
    setPersonFilter("");
    setEditor(null);
    setSearch("");
    setError("");
    setMobile(false);
  };
  if (loading)
    return <div className="loading">Cargando tu espacio de trabajo…</div>;
  if (!auth)
    return (
      <div className="login">
        <div className="login-brand">
          <Brand />
          <div className="login-message">
            <h1>
              Cada llegada,
              <br />
              bien registrada.
            </h1>
            <p>
              Personas, sedes y asistencia.
              <br />
              Todo en un mismo lugar.
            </p>
          </div>
          <BrandWave />
          <small>Carahue · Gestión de personas</small>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await run(
              "login",
              { email: f.get("email"), password: f.get("password") },
              "Sesión iniciada",
            );
          }}
        >
          <span className="login-icon">
            <Users size={26} />
          </span>
          <h2>Bienvenido a tu equipo</h2>
          <p>Ingresá al espacio de Recursos Humanos.</p>
          <Field label="Correo">
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              defaultValue="admin@carahue.local"
            />
          </Field>
          <Field label="Contraseña">
            <input
              autoFocus
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="Ingresá tu contraseña"
            />
          </Field>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            Ingresar <ArrowRight size={17} />
          </button>
          {config.demo && (
            <div className="demo-note">
              Entorno de demostración local.
              <br />
              {config.defaultPassword && (
                <>
                  Correo: <code>admin@carahue.local</code>
                  <br />
                  Contraseña: <code>Carahue-demo-2026</code>
                </>
              )}
            </div>
          )}
        </form>
      </div>
    );
  if (!data) return null;
  const supervisor = data.user?.role === "supervisor";
  const employee = (id: string) => data.employees.find((e) => e.id === id),
    site = (id: string) => data.sites.find((s) => s.id === id);
  const alerts = data.alerts.filter((a) => !a.resolved_at);
  const active = data.visits.filter((v) => v.status === "open");
  const todayKey = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const todays = data.visits.filter(
    (v) =>
      new Date(v.entry_at).toLocaleDateString("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
      }) === todayKey,
  );
  const filters = {
    from,
    to,
    employee: personFilter,
    site: siteFilter,
    status: statusFilter,
    search,
  };
  const filtered = filterVisits(
    data.visits as any[],
    filters,
    (id) => employee(id)?.name || "",
  );
  const title = nav.find((n) => n[0] === page)?.[1];
  const exportUrl = "/api/export?" + new URLSearchParams(filters);
  const visitTable = (rows: Row[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Empleado</th>
            <th>Sede</th>
            <th>Fecha</th>
            <th>Entrada</th>
            <th>Salida</th>
            <th>Estado</th>
            <th>Origen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id}>
              <td>
                <div className="person">
                  <span className="avatar">
                    {initials(employee(v.employee_id)?.name || "?")}
                  </span>
                  <span>
                    <strong>{employee(v.employee_id)?.name}</strong>
                    <small>{employee(v.employee_id)?.role}</small>
                  </span>
                </div>
              </td>
              <td>{site(v.site_id)?.name}</td>
              <td>{date(v.entry_at)}</td>
              <td className="numbers">{time(v.entry_at)}</td>
              <td className="numbers">{time(v.exit_at)}</td>
              <td>
                <Badge value={v.status} />
              </td>
              <td>
                <span className="source">
                  {v.source === "demo"
                    ? "Demo"
                    : v.source === "simulator"
                      ? "Simulador"
                      : v.source === "manual_hr"
                        ? "Carga manual RRHH"
                        : "WhatsApp"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="empty">
          <Clock3 />
          <h3>No hay fichadas para esta búsqueda</h3>
          <p>Probá con otra fecha, sede o empleado.</p>
        </div>
      )}
    </div>
  );
  const submitEditor = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let value: Row = Object.fromEntries(f.entries());
    if (editor?.kind === "people") {
      value.site_ids = f.getAll("site_ids");
      value.active = f.get("active") ? 1 : 0;
      value.id = editor.id;
      await run("employees", value);
    }
    if (editor?.kind === "sites") {
      value.id = editor.id;
      value.active = f.get("active") ? 1 : 0;
      await run("sites", value);
    }
    if (editor?.kind === "correction")
      await run(
        "correct",
        {
          id: editor.id,
          time: new Date(value.time).toISOString(),
          reason: value.reason,
        },
        "Salida corregida. La modificación quedó auditada.",
      );
    if (editor?.kind === "leaves")
      await run("leaves", value, "Solicitud de licencia creada");
    if (editor?.kind === "shifts") await run("shifts", value, "Turno creado");
  };
  return (
    <div className="app">
      <aside className={mobile ? "sidebar visible" : "sidebar"}>
        <Brand />
        <button
          className="icon-button navigation-close"
          aria-label="Cerrar navegación"
          onClick={() => setMobile(false)}
        >
          <X size={20} />
        </button>
        <div className="workspace">
          <span className="workspace-icon">
            <Building2 size={18} />
          </span>
          <span>
            Carahue<small>Recursos Humanos</small>
          </span>
        </div>
        <nav aria-label="Navegación principal">
          {nav
            .filter(
              ([id]) =>
                (id !== "accounts" || data.user?.role === "admin") &&
                (!supervisor ||
                  ![
                    "simulator",
                    "settings",
                    "communications",
                    "receipts",
                    "waOperations",
                  ].includes(id)),
            )
            .map(([id, name, Icon]) => (
              <button
                key={id}
                disabled={planningLocked}
                className={`${page === id ? "selected" : ""} ${["leaves", "reports", "settings"].includes(id) ? "nav-section-start" : ""}`}
                aria-current={page === id ? "page" : undefined}
                onClick={() => go(id)}
              >
                <Icon size={19} />
                <span>{name}</span>
                {id === "alerts" && alerts.length > 0 && <b>{alerts.length}</b>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="mini-dot" />{" "}
          {data.integration.demo
            ? "Entorno local · Datos de ejemplo"
            : "Espacio de Recursos Humanos"}
        </div>
        <button
          className="profile"
          disabled={planningLocked}
          onClick={() => run("logout", {}, "Sesión cerrada")}
        >
          <span className="avatar">RH</span>
          <span>
            {data.user?.name || "Equipo de RRHH"}
            <small>
              {data.user?.role === "admin"
                ? "Administrador"
                : data.user?.role === "hr"
                  ? "RRHH"
                  : "Supervisor"}
            </small>
          </span>
          <LogOut size={17} />
        </button>
      </aside>
      {mobile && (
        <button
          className="navigation-backdrop"
          aria-label="Cerrar navegación"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="Abrir navegación"
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
          <span>
            Mi organización <ChevronRight size={14} /> <strong>{title}</strong>
          </span>
          <div>
            <span className="local-label">
              {data.integration.demo
                ? "Vista de demostración"
                : "Administración"}
            </span>
            <button
              className="icon-button"
              aria-label="Actualizar datos"
              onClick={() => refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button notification"
              aria-label="Ver alertas"
              disabled={planningLocked}
              onClick={() => go("alerts")}
            >
              <TriangleAlert size={19} />
              {alerts.length > 0 && <i />}
            </button>
            <span className="avatar user">RH</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <BrandWave />
            <div>
              <h1>
                {page === "dashboard" ? "Tu equipo, de un vistazo" : title}
              </h1>
              <p>
                {
                  (
                    {
                      weekly:
                        "Expectativas por fecha, con historial y guardado conjunto.",
                      dashboard: "Lo que está pasando hoy en tus sedes.",
                      receipts:
                        "PDF en preparación privada, con asignación manual y registro de cambios.",
                      communications:
                        "Plantillas y destinatarios listos para revisar, sin envío externo.",
                      attendance: "Cada entrada y salida, con su contexto.",
                      people: "Las personas que forman parte de Carahue.",
                      sites: "Lugares habilitados para registrar asistencia.",
                      alerts: "Revisá las excepciones y completá lo que falta.",
                      leaves: "Solicitudes y ausencias del equipo.",
                      shifts: "Horarios de referencia para tu organización.",
                      waOperations:
                        "Estado de las colas y revisión humana, sin reenvíos manuales.",
                      reports: "Datos claros para tomar mejores decisiones.",
                      simulator:
                        "Probá el circuito de fichadas sin enviar mensajes reales.",
                      settings: "Estado del entorno y conexión con WhatsApp.",
                    } as Row
                  )[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {page === "dashboard" ? (
                <span className="date-pill">
                  <CalendarDays size={17} />
                  {new Date().toLocaleDateString("es-AR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
              ) : !supervisor &&
                ["people", "sites", "leaves", "shifts"].includes(page) ? (
                <button
                  className="primary"
                  onClick={() => setEditor({ kind: page })}
                >
                  <Plus size={17} />
                  {
                    (
                      {
                        people: "Agregar empleado",
                        sites: "Nueva sede",
                        leaves: "Nueva solicitud",
                        shifts: "Nuevo turno",
                      } as Row
                    )[page]
                  }
                </button>
              ) : page === "attendance" ? (
                <a className="primary" href={exportUrl}>
                  <Download size={17} />
                  Exportar CSV
                </a>
              ) : null}
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Cerrar error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              {notice}
              <button aria-label="Cerrar aviso" onClick={() => setNotice("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {editor && (
            <section className="editor">
              <div className="section-heading">
                <h2>
                  {editor.kind === "correction"
                    ? "Completar salida desconocida"
                    : editor.id
                      ? "Editar información"
                      : "Agregar información"}
                </h2>
                <button
                  className="icon-button"
                  aria-label="Cerrar formulario"
                  onClick={() => setEditor(null)}
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={submitEditor}>
                <div className="form-grid">
                  {editor.kind === "people" && (
                    <>
                      <Field label="Nombre completo">
                        <input
                          name="name"
                          defaultValue={editor.name}
                          required
                          minLength={2}
                        />
                      </Field>
                      <Field label="Teléfono con código de país">
                        <input
                          name="phone"
                          defaultValue={editor.phone}
                          placeholder="54911…"
                          pattern="[0-9]{10,15}"
                          required
                        />
                      </Field>
                      <Field label="Puesto">
                        <input
                          name="role"
                          defaultValue={editor.role || "Empleado"}
                          required
                        />
                      </Field>
                      <fieldset>
                        <legend>Sedes autorizadas</legend>
                        {data.sites
                          .filter((s) => s.active)
                          .map((s) => (
                            <label className="checkbox" key={s.id}>
                              <input
                                type="checkbox"
                                name="site_ids"
                                value={s.id}
                                defaultChecked={editor.site_ids?.includes(s.id)}
                              />
                              {s.name}
                            </label>
                          ))}
                      </fieldset>
                      <label className="checkbox">
                        <input
                          name="active"
                          type="checkbox"
                          defaultChecked={editor.active !== 0}
                        />
                        Empleado activo
                      </label>
                    </>
                  )}
                  {editor.kind === "sites" && (
                    <>
                      <Field label="Nombre de sede">
                        <input
                          name="name"
                          defaultValue={editor.name}
                          required
                        />
                      </Field>
                      <Field label="Dirección">
                        <input
                          name="address"
                          defaultValue={editor.address}
                          required
                        />
                      </Field>
                      <Field label="Latitud">
                        <input
                          name="lat"
                          type="number"
                          step="any"
                          min={-90}
                          max={90}
                          defaultValue={editor.lat}
                          required
                        />
                      </Field>
                      <Field label="Longitud">
                        <input
                          name="lon"
                          type="number"
                          step="any"
                          min={-180}
                          max={180}
                          defaultValue={editor.lon}
                          required
                        />
                      </Field>
                      <Field label="Radio permitido (metros)">
                        <input
                          name="radius"
                          type="number"
                          min={10}
                          max={1000}
                          defaultValue={editor.radius || 100}
                          required
                        />
                      </Field>
                      <Field label="Categoría">
                        <select
                          name="category_id"
                          defaultValue={editor.category_id || ""}
                        >
                          <option value="">Sin categoría</option>
                          {(data.categories || [])
                            .filter(
                              (c) => !c.archived || c.id === editor.category_id,
                            )
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {c.archived ? " · archivada" : ""}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <label className="checkbox">
                        <input
                          name="active"
                          type="checkbox"
                          defaultChecked={editor.active !== 0}
                        />
                        Sede activa
                      </label>
                    </>
                  )}
                  {editor.kind === "correction" && (
                    <>
                      <p className="form-note">
                        {employee(editor.employee_id)?.name} · Entrada{" "}
                        {date(editor.entry_at)}, {time(editor.entry_at)}. La
                        observación original se conserva.
                      </p>
                      <Field label="Fecha y hora de salida (hora de tu dispositivo)">
                        <input
                          name="time"
                          type="datetime-local"
                          step="1"
                          required
                        />
                      </Field>
                      <Field label="Motivo de la corrección">
                        <textarea
                          name="reason"
                          minLength={5}
                          required
                          placeholder="Explicá cómo se confirmó este horario"
                        />
                      </Field>
                    </>
                  )}
                  {editor.kind === "leaves" && (
                    <>
                      <Field label="Empleado">
                        <select name="employee_id">
                          {data.employees.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Tipo de licencia">
                        <select name="type">
                          <option>Vacaciones</option>
                          <option>Enfermedad</option>
                          <option>Personal</option>
                          <option>Estudio</option>
                        </select>
                      </Field>
                      <Field label="Desde">
                        <input name="date_from" type="date" required />
                      </Field>
                      <Field label="Hasta">
                        <input name="date_to" type="date" required />
                      </Field>
                      <Field label="Motivo">
                        <textarea name="reason" minLength={5} required />
                      </Field>
                    </>
                  )}
                  {editor.kind === "shifts" && (
                    <>
                      <Field label="Nombre del turno">
                        <input name="name" required />
                      </Field>
                      <Field label="Entrada">
                        <input name="start" type="time" required />
                      </Field>
                      <Field label="Salida">
                        <input name="end" type="time" required />
                      </Field>
                      <Field label="Tolerancia (minutos)">
                        <input
                          name="tolerance"
                          type="number"
                          min={0}
                          max={120}
                          defaultValue={10}
                          required
                        />
                      </Field>
                    </>
                  )}
                </div>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditor(null)}
                  >
                    Cancelar
                  </button>
                  <button className="primary" disabled={busy}>
                    {busy ? "Guardando…" : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </section>
          )}
          {page === "dashboard" && (
            <>
              <section className="overview">
                <div className="overview-main">
                  <h2>Asistencia en este momento</h2>
                  <div className="presence-number">
                    {active.length}
                    <span>personas en sede</span>
                  </div>
                  <p>
                    De {data.employees.filter((e) => e.active).length} empleados
                    activos en la organización
                  </p>
                  <button onClick={() => go("attendance")}>
                    Ver asistencia <ArrowRight size={17} />
                  </button>
                </div>
                <div className="overview-stats">
                  <div>
                    <span>Visitas registradas hoy</span>
                    <strong>{todays.length.toString().padStart(2, "0")}</strong>
                    <Clock3 size={20} />
                  </div>
                  <div>
                    <span>Sedes habilitadas</span>
                    <strong>
                      {data.sites
                        .filter((s) => s.active)
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                    <MapPin size={20} />
                  </div>
                  <div>
                    <span>Salidas desconocidas</span>
                    <strong className="orange">
                      {alerts.length.toString().padStart(2, "0")}
                    </strong>
                    <TriangleAlert size={20} />
                  </div>
                </div>
              </section>
              <AttendanceExceptions supervisor={supervisor} compact />
              <div className="dashboard-columns">
                <section className="panel">
                  <div className="section-heading">
                    <h2>Ahora en cada sede</h2>
                    <span className="muted">Presencia actual</span>
                  </div>
                  {data.sites.map((s, i) => (
                    <div className="site-row" key={s.id}>
                      <span className={"site-icon tone-" + i}>
                        <Building2 size={21} />
                      </span>
                      <span>
                        <strong>{s.name}</strong>
                        <small>{s.category}</small>
                      </span>
                      <b>
                        {active.filter((v) => v.site_id === s.id).length}
                        <small>en sede</small>
                      </b>
                    </div>
                  ))}
                </section>
                <section className="attention-panel">
                  <div className="section-heading">
                    <span className="alert-icon">
                      <TriangleAlert size={20} />
                    </span>
                    <span>Pendiente de tu atención</span>
                  </div>
                  <h2>
                    {alerts.length
                      ? `${alerts.length} salida${alerts.length > 1 ? "s" : ""} por completar`
                      : "Todo al día"}
                  </h2>
                  <p>
                    {alerts.length
                      ? "Hay visitas sin horario de salida. Revisalas para mantener los registros completos."
                      : "No hay salidas desconocidas pendientes de revisión."}
                  </p>
                  <button className="secondary" onClick={() => go("alerts")}>
                    Revisar alertas <ArrowUpRight size={16} />
                  </button>
                  <div className="attention-foot">
                    Los horarios desconocidos no se suman a las horas
                    trabajadas.
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Últimas fichadas</h2>
                    <p>El movimiento más reciente del equipo</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => go("attendance")}
                  >
                    Ver todas <ArrowRight size={16} />
                  </button>
                </div>
                {visitTable(data.visits.slice(0, 5))}
              </section>
            </>
          )}
          {page === "attendance" && !supervisor && (
            <ManualAttendance
              employees={data.employees}
              sites={data.sites}
              onSaved={refresh}
            />
          )}
          {page === "attendance" && (
            <section className="panel">
              <div className="filters">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Buscar empleado"
                    placeholder="Buscar empleado…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filtrar sede"
                  value={siteFilter}
                  onChange={(e) => setSiteFilter(e.target.value)}
                >
                  <option value="">Todas las sedes</option>
                  {data.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filtrar estado"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">Todos los estados</option>
                  {["open", "complete", "exit_unknown", "corrected"].map(
                    (x) => (
                      <option key={x} value={x}>
                        {labels[x]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              {visitTable(filtered)}
              <div className="table-footer">
                {filtered.length} visitas · Horarios de Buenos Aires
              </div>
            </section>
          )}
          {page === "people" && (
            <section className="panel">
              <div className="filters">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Buscar empleado"
                    placeholder="Buscar por nombre…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <span className="muted">
                  {data.employees.length} empleados registrados
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>WhatsApp registrado</th>
                      <th>Sedes habilitadas</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.employees
                      .filter((e) =>
                        e.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((e) => (
                        <tr key={e.id}>
                          <td>
                            <div className="person">
                              <span className="avatar">{initials(e.name)}</span>
                              <span>
                                <strong>{e.name}</strong>
                                <small>{e.role}</small>
                              </span>
                            </div>
                          </td>
                          <td className="numbers">+{e.phone}</td>
                          <td>
                            {e.site_ids
                              .map((id: string) => site(id)?.name)
                              .join(", ")}
                          </td>
                          <td>
                            <Badge value={e.active ? "Activo" : "Inactivo"} />
                          </td>
                          <td>
                            <button
                              hidden={supervisor}
                              className="text-button"
                              onClick={() =>
                                setEditor({ ...e, kind: "people" })
                              }
                            >
                              Editar
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {page === "sites" && (
            <div className="sites-grid">
              {data.sites.map((s, i) => (
                <section className="site-card" key={s.id}>
                  <div className="site-card-map">
                    <div className="map-road one" />
                    <div className="map-road two" />
                    <div className="map-road three" />
                    <div className="map-radius">
                      <MapPin size={25} />
                    </div>
                    <span>{s.radius} m de radio</span>
                  </div>
                  <div className="site-card-body">
                    <div className="section-heading">
                      <h2>{s.name}</h2>
                      <Badge value={s.active ? "Activa" : "Inactiva"} />
                    </div>
                    <p>{s.address}</p>
                    <div className="site-meta">
                      <span>
                        <Users size={16} />
                        {
                          data.employees.filter((e) =>
                            e.site_ids.includes(s.id),
                          ).length
                        }{" "}
                        autorizados
                      </span>
                      <span>{s.category}</span>
                    </div>
                    <small className="coordinates">
                      {s.lat.toFixed(5)}, {s.lon.toFixed(5)} · Esquema de
                      geocerca
                    </small>
                    <button
                      className="secondary"
                      hidden={supervisor}
                      onClick={() => setEditor({ ...s, kind: "sites" })}
                    >
                      Configurar sede <ArrowUpRight size={16} />
                    </button>
                  </div>
                </section>
              ))}
            </div>
          )}
          {page === "alerts" && (
            <>
              <AttendanceExceptions supervisor={supervisor} />
              <div className="info-line">
                <TriangleAlert size={18} /> Una entrada en otra sede se registra
                aunque falte la salida anterior. RRHH completa el horario con
                una justificación.
              </div>
              <section className="panel">
                {alerts.length === 0 ? (
                  <div className="empty">
                    <Check />
                    <h2>No hay salidas pendientes</h2>
                    <p>Las visitas del equipo están al día.</p>
                  </div>
                ) : (
                  alerts.map((a) => {
                    const v = data.visits.find((v) => v.id === a.visit_id)!;
                    return (
                      <div className="alert-row" key={a.id}>
                        <span className="alert-icon">
                          <TriangleAlert size={21} />
                        </span>
                        <div>
                          <h3>{employee(a.employee_id)?.name}</h3>
                          <p>Salida desconocida · {site(v.site_id)?.name}</p>
                          <small>
                            Entrada: {date(v.entry_at)}, {time(v.entry_at)}
                          </small>
                        </div>
                        <button
                          className="secondary"
                          hidden={supervisor}
                          onClick={() =>
                            setEditor({ ...v, kind: "correction" })
                          }
                        >
                          Completar salida <ArrowRight size={16} />
                        </button>
                      </div>
                    );
                  })
                )}
              </section>
              <section className="panel audit">
                <div className="section-heading">
                  <h2>Historial de correcciones</h2>
                </div>
                {data.audit.length === 0 ? (
                  <p className="empty">
                    Todavía no se realizaron correcciones.
                  </p>
                ) : (
                  data.audit.map((a) => (
                    <div className="audit-row" key={a.id}>
                      <Check size={17} />
                      <div>
                        <strong>{a.reason}</strong>
                        <small>
                          {a.actor} · {date(a.created_at)} {time(a.created_at)}
                        </small>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
          {page === "leaves" && (
            <section className="panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Licencia</th>
                      <th>Desde / hasta</th>
                      <th>Motivo</th>
                      <th>Estado</th>
                      <th>Revisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaves.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{employee(l.employee_id)?.name}</strong>
                        </td>
                        <td>{l.type}</td>
                        <td>
                          {l.date_from} / {l.date_to}
                        </td>
                        <td>{l.reason}</td>
                        <td>
                          <Badge value={l.status} />
                        </td>
                        <td>
                          {l.status === "pending" && (
                            <div className="inline-actions">
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  run(
                                    `leaves/${l.id}/decision`,
                                    { status: "approved" },
                                    "Licencia aprobada",
                                  )
                                }
                              >
                                Aprobar
                              </button>
                              <button
                                className="text-button danger"
                                disabled={busy}
                                onClick={() =>
                                  run(
                                    `leaves/${l.id}/decision`,
                                    { status: "rejected" },
                                    "Licencia rechazada",
                                  )
                                }
                              >
                                Rechazar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.leaves.length && (
                <div className="empty">No hay solicitudes de licencia.</div>
              )}
            </section>
          )}
          {page === "shifts" && (
            <>
              <div className="info-line">
                <Clock3 size={18} />
                Catálogo de horarios de referencia. Asigná empleados en
                Operación de RRHH; allí podés revisar la tolerancia de ingreso.
              </div>
              <Catalogs
                kinds={["shift"]}
                employees={data.employees}
                supervisor={supervisor}
                version={data.shifts}
                onChange={refresh}
              />
            </>
          )}
          {page === "waOperations" && !supervisor && (
            <WhatsAppOperations onLockChange={setPlanningLocked} />
          )}
          {page === "reports" && (
            <Reports employees={data.employees} sites={data.sites} />
          )}
          {page === "simulator" && (
            <div className="simulator-layout">
              <section className="panel simulator-controls">
                <h2>Prepará una fichada</h2>
                <p>
                  Usa las mismas reglas de asistencia que el receptor de
                  WhatsApp.
                </p>
                <Field label="Empleado">
                  <select
                    value={sim.employee}
                    onChange={(e) =>
                      setSim({ ...sim, employee: e.target.value })
                    }
                  >
                    {data.employees
                      .filter((e) => e.active)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Sede de la ubicación">
                  <select
                    value={sim.site}
                    onChange={(e) => setSim({ ...sim, site: e.target.value })}
                  >
                    {data.sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Acción explícita">
                  <select
                    value={sim.action}
                    onChange={(e) => setSim({ ...sim, action: e.target.value })}
                  >
                    <option value="entry">Entrada / presente</option>
                    <option value="exit">Salida</option>
                  </select>
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={sim.outside}
                    onChange={(e) =>
                      setSim({ ...sim, outside: e.target.checked })
                    }
                  />
                  Probar ubicación fuera de la sede
                </label>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const s = site(sim.site),
                      e = employee(sim.employee);
                    try {
                      setChat((c) => [
                        ...c,
                        {
                          type: "sent",
                          text: `${sim.action === "entry" ? "Presente" : "Salida"} · ${e?.name}`,
                          location: s?.name,
                        },
                      ]);
                      const r = await api("simulate", {
                        phone: e?.phone,
                        action: sim.action,
                        siteId: sim.site,
                        lat: sim.outside ? 0 : s?.lat,
                        lon: sim.outside ? 0 : s?.lon,
                      });
                      setChat((c) => [
                        ...c,
                        {
                          type: "received",
                          text: r.message,
                        },
                      ]);
                      await refresh();
                    } catch (e) {
                      setChat((c) => [
                        ...c,
                        { type: "received", text: (e as Error).message },
                      ]);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Send size={17} />
                  Simular fichada
                </button>
                <p className="muted">
                  Los registros se guardan con origen «Simulador». No se envía
                  ningún WhatsApp.
                </p>
              </section>
              <section className="chat">
                <div className="chat-header">
                  <span className="chat-logo">
                    <MessageCircle size={22} />
                  </span>
                  <div>
                    <strong>Carahue Asistencia</strong>
                    <small>Conversación de prueba · sin conexión</small>
                  </div>
                </div>
                <div className="chat-body">
                  <span className="chat-date">SIMULACIÓN LOCAL</span>
                  <div className="bubble received">
                    Hola. Enviá entrada o salida y compartí tu ubicación para
                    registrar tu visita.
                  </div>
                  {chat.map((c, i) => (
                    <div key={i} className={"bubble " + c.type}>
                      {c.text}
                      {c.location && (
                        <div className="shared-location">
                          <Navigation size={22} />
                          <span>
                            Ubicación simulada<strong>{c.location}</strong>
                          </span>
                        </div>
                      )}
                      <small>{time(new Date().toISOString())}</small>
                    </div>
                  ))}
                </div>
                <div className="chat-footer">
                  <MapPin size={17} />
                  La ubicación se elige desde el simulador
                </div>
              </section>
            </div>
          )}
          {page === "simulator" && !supervisor && (
            <BotSimulator
              employee={employee(sim.employee)}
              site={site(sim.site)}
              onChange={refresh}
            />
          )}
          {page === "weekly" && (
            <WeeklyPlanning
              employees={data.employees}
              supervisor={supervisor}
              onLockChange={setPlanningLocked}
            />
          )}
          {page === "calendar" && (
            <ScheduleCalendar
              employees={data.employees}
              shifts={data.shifts.filter((s) => !s.archived)}
              supervisor={supervisor}
            />
          )}
          {page === "receipts" && !supervisor && (
            <Receipts employees={data.employees} />
          )}
          {page === "communications" && !supervisor && (
            <Communications employees={data.employees} />
          )}
          {page === "accounts" && data.user?.role === "admin" && (
            <Accounts employees={data.employees} />
          )}
          {page === "hr" && (
            <HROperations
              supervisor={supervisor}
              employees={data.employees}
              visits={data.visits}
              shifts={data.shifts.filter((s) => !s.archived)}
            />
          )}
          {page === "settings" && (
            <>
              <section className="panel settings-panel">
                <div className="section-heading">
                  <div>
                    <h2>WhatsApp Business</h2>
                    <p>Receptor preparado; conexión de producción pendiente.</p>
                  </div>
                  <Badge value="Sin conexión activa" />
                </div>
                <div className="setting-row">
                  <span>
                    Receptor de mensajes firmados
                    <small>Webhook de Meta con verificación de firma</small>
                  </span>
                  <strong>
                    {data.integration.configured
                      ? "Configurado"
                      : "Falta configurar"}
                  </strong>
                </div>
                <div className="setting-row">
                  <span>
                    Envío de confirmaciones
                    <small>
                      {data.integration.sending
                        ? "Habilitado por configuración del servidor"
                        : "No se envían mensajes externos en este entorno"}
                    </small>
                  </span>
                  <strong>
                    {data.integration.sending ? "Habilitado" : "Desactivado"}
                  </strong>
                </div>
                <div className="setting-row">
                  <span>
                    Almacenamiento local
                    <small>SQLite persistente · una instancia</small>
                  </span>
                  <strong>Activo</strong>
                </div>
                <div className="setting-row">
                  <span>Zona horaria de los reportes</span>
                  <strong>Buenos Aires · UTC−3</strong>
                </div>
                <div className="setting-row">
                  <span>
                    Salida anterior desconocida
                    <small>No se inventan horarios al cambiar de sede</small>
                  </span>
                  <strong>Generar alerta</strong>
                </div>
              </section>
              <section className="panel settings-panel">
                <h2>Cola de mensajes</h2>
                <p>
                  {data.integration.inbox.length} recibidos ·{" "}
                  {data.integration.outbox.length} respuestas en historial
                </p>
                {data.integration.inbox.map((m: Row) => (
                  <div className="setting-row" key={m.id}>
                    <span>
                      {m.id}
                      <small>{m.error || "Procesamiento durable"}</small>
                    </span>
                    <Badge value={m.status} />
                  </div>
                ))}
                {data.integration.outbox.map((m: Row) => (
                  <div className="setting-row" key={"out-" + m.id}>
                    <span>
                      Respuesta · {m.id}
                      <small>{m.text}</small>
                      {m.error && (
                        <small>
                          {m.error} · Revisar en el proveedor antes de
                          reintentar.
                        </small>
                      )}
                    </span>
                    <Badge value={m.status} />
                  </div>
                ))}
              </section>
              <div className="info-line">
                Para operar 24/7 faltan el despliegue HTTPS, credenciales de
                Meta y controles de operación. Consultá README.md y
                docs/ROADMAP.md.
              </div>
            </>
          )}
          <footer>
            Carahue · Personas y asistencia{" "}
            <span>
              {data.integration.demo
                ? "Datos ficticios de demostración · "
                : ""}
              Horarios de Buenos Aires
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <svg className="brand-symbol" viewBox="0 0 44 42" aria-hidden="true">
        <path
          d="M38 3C19 0 1 14 3 28c2 13 20 16 35 8C19 39 10 29 17 17 21 10 30 5 38 3Z"
          fill="currentColor"
        />
        <path d="M39 3C27 5 18 11 15 21 24 12 33 10 42 10Z" fill="#ff8a00" />
      </svg>
      <span>
        carahue<small>PERSONAS Y ASISTENCIA</small>
      </span>
    </div>
  );
}
function BrandWave() {
  return (
    <svg
      className="brand-wave"
      viewBox="0 0 1000 400"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0 320C230 115 340 410 590 220S850 60 1000 0V400H0Z"
        fill="#00aa83"
      />
      <path
        d="M0 355C260 185 370 440 630 260S870 180 1000 80V400H0Z"
        fill="#ff8a00"
      />
      <path
        d="M0 375C260 220 390 470 660 290S880 205 1000 120V400H0Z"
        fill="#005b4c"
      />
    </svg>
  );
}
