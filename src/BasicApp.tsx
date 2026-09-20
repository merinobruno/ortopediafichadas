import React, { useEffect, useState } from "react";
import {
  Building2,
  Clock3,
  LogOut,
  Users,
  Plus,
  Pencil,
  ArrowRight,
} from "lucide-react";
import "./basic.css";
import SiteLocationPicker from "./SiteLocationPicker";
type Employee = { _id: string; name: string; phone: string; active: boolean };
type Site = {
  _id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  active: boolean;
};
type Attendance = {
  _id: string;
  employeeId: string;
  siteId: string;
  employeeName: string;
  siteName: string;
  kind: "entrada" | "salida";
  timestamp: number;
};
type Data = {
  email: string;
  employees: Employee[];
  sites: Site[];
  attendance: Attendance[];
};
type Section = "employees" | "sites" | "attendance";
async function request(path: string, body?: unknown) {
  let response: Response;
  let result;
  try {
    response = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    result = await response.json();
  } catch {
    throw new Error(
      "El servicio no está disponible. Intentá nuevamente en unos minutos.",
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(result.error ?? "No se pudo completar la operación."),
      { status: response.status },
    );
  return result;
}
const names = {
  employees: "Empleados",
  sites: "Sedes",
  attendance: "Fichadas",
};
const date = (timestamp: number) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(timestamp);
export default function BasicApp() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("employees");
  const [editing, setEditing] = useState<Employee | Site | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  async function reload() {
    try {
      setData(await request("data"));
    } catch (e) {
      if ((e as { status?: number }).status === 401) setData(null);
      else throw e;
    }
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 401 && data) {
        setData(null);
        setEditing(null);
      }
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="basic-loading" role="status">
        Cargando Carahue…
      </main>
    );
  if (!data)
    return (
      <main className="basic-login">
        <section className="basic-login-brand">
          <span className="basic-wordmark">
            carahue<span>®</span>
          </span>
          <p>Ortopedia & salud</p>
          <div>
            <span className="basic-eyebrow">ASISTENCIA DEL EQUIPO</span>
            <h1>
              Cada jornada,
              <br />
              en su lugar.
            </h1>
            <p>
              Empleados, sedes y fichadas.
              <br />
              Lo esencial para el día a día.
            </p>
          </div>
          <small>Carahue · Gestión de asistencia</small>
        </section>
        <section className="basic-login-form">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const form = new FormData(event.currentTarget);
              void perform(async () => {
                await request("login", {
                  email: form.get("email"),
                  password: form.get("password"),
                });
                await reload();
              });
            }}
          >
            <span className="basic-eyebrow">ACCESO ADMINISTRATIVO</span>
            <h2>Bienvenido</h2>
            <p>Ingresá con tu cuenta para continuar.</p>
            {error && (
              <p className="basic-error" role="alert">
                {error}
              </p>
            )}
            <label>
              Correo electrónico
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
              />
            </label>
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <button className="basic-primary" disabled={busy}>
              {busy ? "Ingresando…" : "Ingresar"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
        </section>
      </main>
    );
  const selected = editing && editing !== "new" ? editing : null;
  const records = data.attendance.filter((row) =>
    `${row.employeeName} ${row.siteName} ${row.kind}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <div className="basic-shell">
      <aside className="basic-sidebar">
        <div>
          <span className="basic-wordmark">
            carahue<span>®</span>
          </span>
          <p>Asistencia</p>
        </div>
        <nav aria-label="Secciones">
          {(["employees", "sites", "attendance"] as Section[]).map((key) => {
            const Icon =
              key === "employees"
                ? Users
                : key === "sites"
                  ? Building2
                  : Clock3;
            return (
              <a
                key={key}
                href={`#${key}`}
                aria-current={section === key ? "page" : undefined}
                aria-disabled={busy || undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  setSection(key);
                  setEditing(null);
                  setError("");
                  setNotice("");
                  setFilter("");
                }}
              >
                <Icon size={19} aria-hidden="true" />
                {names[key]}
              </a>
            );
          })}
        </nav>
        <div className="basic-account">
          <small>{data.email}</small>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await request("logout", {});
                setData(null);
              })
            }
          >
            <LogOut size={17} aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="basic-main">
        <header>
          <div>
            <span className="basic-eyebrow">CARAHUE / ASISTENCIA</span>
            <h1>{names[section]}</h1>
            <p>
              {section === "employees"
                ? "Las personas que forman parte de tu equipo."
                : section === "sites"
                  ? "Los lugares donde empieza y termina cada jornada."
                  : "Entradas y salidas registradas por WhatsApp."}
            </p>
          </div>
          {section !== "attendance" && !editing && (
            <button
              className="basic-primary"
              disabled={busy}
              onClick={() => {
                setEditing("new");
                setError("");
                setNotice("");
              }}
            >
              <Plus size={18} aria-hidden="true" />
              {section === "employees" ? "Nuevo empleado" : "Nueva sede"}
            </button>
          )}
        </header>
        {error && (
          <p className="basic-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="basic-notice" role="status">
            {notice}
          </p>
        )}
        {editing && section !== "attendance" && (
          <form
            className="basic-editor"
            key={`${section}-${selected?._id ?? "new"}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const form = new FormData(event.currentTarget);
              if (
                section === "sites" &&
                (!form.get("latitude") || !form.get("longitude"))
              ) {
                setError(
                  "Elegí la ubicación de la sede en el mapa antes de guardar.",
                );
                return;
              }
              const value = {
                ...(selected ? { id: selected._id } : {}),
                name: String(form.get("name")),
                active: form.get("active") === "on",
                ...(section === "employees"
                  ? { phone: String(form.get("phone")) }
                  : {
                      latitude: Number(form.get("latitude")),
                      longitude: Number(form.get("longitude")),
                      radius: Number(form.get("radius")),
                    }),
              };
              void perform(async () => {
                await request(section, value);
                await reload();
                setEditing(null);
                setNotice("Cambios guardados.");
              });
            }}
          >
            <h2>
              {selected ? "Editar" : "Agregar"}{" "}
              {section === "employees" ? "empleado" : "sede"}
            </h2>
            <div className="basic-fields">
              <label>
                Nombre
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={selected?.name ?? ""}
                  autoFocus
                />
              </label>
              {section === "employees" ? (
                <label>
                  Teléfono internacional
                  <input
                    name="phone"
                    aria-label="Teléfono internacional"
                    aria-describedby="phone-help"
                    type="tel"
                    required
                    maxLength={32}
                    placeholder="+54 9 11 1234 5678"
                    defaultValue={(selected as Employee | null)?.phone ?? ""}
                  />
                  <small id="phone-help">
                    Incluí el código de país. Debe coincidir con WhatsApp.
                  </small>
                </label>
              ) : (
                <SiteLocationPicker
                  initialLocation={
                    selected && "latitude" in selected
                      ? {
                          latitude: selected.latitude,
                          longitude: selected.longitude,
                        }
                      : undefined
                  }
                  initialRadius={(selected as Site | null)?.radius}
                  disabled={busy}
                />
              )}
            </div>
            <label className="basic-check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={selected?.active ?? true}
              />
              {section === "employees" ? "Empleado activo" : "Sede activa"}
            </label>
            <div className="basic-actions">
              <button className="basic-primary" disabled={busy}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                className="basic-secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
        {section === "attendance" ? (
          <>
            <div className="basic-toolbar">
              <label>
                Buscar fichadas
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Empleado, sede o movimiento"
                />
              </label>
              <button
                className="basic-secondary"
                disabled={busy}
                onClick={() => void perform(reload)}
              >
                {busy ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
            <div className="basic-table-wrap">
              <table>
                <caption className="basic-sr-only">Fichadas recientes</caption>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Movimiento</th>
                    <th>Sede</th>
                    <th>Fecha y hora</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((row) => (
                    <tr key={row._id}>
                      <td>{row.employeeName}</td>
                      <td>
                        <span
                          className={`basic-tag ${row.kind === "salida" ? "muted" : ""}`}
                        >
                          {row.kind === "entrada" ? "Entrada" : "Salida"}
                        </span>
                      </td>
                      <td>{row.siteName}</td>
                      <td>{date(row.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!records.length && (
                <div className="basic-empty">
                  <Clock3 size={28} aria-hidden="true" />
                  <h2>
                    {filter
                      ? "No encontramos coincidencias"
                      : "Todavía no hay fichadas"}
                  </h2>
                  <p>
                    {filter
                      ? "Probá con otro empleado o sede."
                      : "Las entradas y salidas confirmadas por WhatsApp aparecerán acá."}
                  </p>
                </div>
              )}
            </div>
            <p className="basic-footnote">
              Últimos 1.000 movimientos · Horario de Buenos Aires · Historial de
              solo lectura
            </p>
          </>
        ) : (
          <div className="basic-table-wrap">
            <table>
              <caption className="basic-sr-only">{names[section]}</caption>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>{section === "employees" ? "WhatsApp" : "Ubicación"}</th>
                  {section === "sites" && <th>Radio</th>}
                  <th>Estado</th>
                  <th>
                    <span className="basic-sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(section === "employees" ? data.employees : data.sites).map(
                  (row) => (
                    <tr key={row._id}>
                      <td>{row.name}</td>
                      <td>
                        {"phone" in row
                          ? `+${row.phone}`
                          : `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`}
                      </td>
                      {"radius" in row && <td>{row.radius} m</td>}
                      <td>
                        <span
                          className={`basic-tag ${row.active ? "" : "muted"}`}
                        >
                          {row.active ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="basic-edit"
                          disabled={busy}
                          aria-label={`Editar ${row.name}`}
                          onClick={() => {
                            setEditing(row);
                            setError("");
                            setNotice("");
                          }}
                        >
                          <Pencil size={16} aria-hidden="true" />
                          <span>Editar</span>
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {!(section === "employees" ? data.employees : data.sites)
              .length && (
              <div className="basic-empty">
                {section === "employees" ? (
                  <Users size={30} aria-hidden="true" />
                ) : (
                  <Building2 size={30} aria-hidden="true" />
                )}
                <h2>
                  {section === "employees"
                    ? "Tu equipo empieza acá"
                    : "Agregá tu primera sede"}
                </h2>
                <p>
                  {section === "employees"
                    ? "Cargá un empleado con su número de WhatsApp para habilitar sus fichadas."
                    : "Definí la ubicación y el radio permitido para registrar asistencia."}
                </p>
              </div>
            )}
          </div>
        )}
        {section === "sites" && (
          <p className="basic-footnote">
            Cualquier empleado activo puede ingresar en una sede activa. La
            salida debe ser en la misma sede.
          </p>
        )}
      </main>
    </div>
  );
}
