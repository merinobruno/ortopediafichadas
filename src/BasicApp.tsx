import React, { useEffect, useState } from "react";
import {
  Building2,
  Clock3,
  LogOut,
  Users,
  Plus,
  Pencil,
  ArrowRight,
  Send,
} from "lucide-react";
import "./basic.css";
import SiteLocationPicker from "./SiteLocationPicker";
type Employee = {
  _id: string;
  name: string;
  active: boolean;
  telegramLinked: boolean;
};
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
type Section = "employees" | "sites" | "attendance" | "telegram";
type Operations = {
  inbound: {
    updateId: number;
    status: string;
    receivedAt: number;
    reasonCode?: string;
  }[];
  outbound: {
    status: string;
    attempts: number;
    createdAt: number;
    reasonCode?: string;
  }[];
};
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
  telegram: "Telegram",
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
  const [visibleCode, setVisibleCode] = useState<{
    employeeId: string;
    code: string;
    expiresAt: number;
  } | null>(null);
  const [operations, setOperations] = useState<Operations | null>(null);
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
          {(["employees", "sites", "attendance", "telegram"] as Section[]).map(
            (key) => {
              const Icon =
                key === "employees"
                  ? Users
                  : key === "sites"
                    ? Building2
                    : key === "attendance"
                      ? Clock3
                      : Send;
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
                    setVisibleCode(null);
                    if (key === "telegram")
                      void perform(async () =>
                        setOperations(await request("telegram-operations")),
                      );
                  }}
                >
                  <Icon size={19} aria-hidden="true" />
                  {names[key]}
                </a>
              );
            },
          )}
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
                  : section === "attendance"
                    ? "Entradas y salidas registradas por Telegram."
                    : "Estado reciente de mensajes y respuestas del bot."}
            </p>
          </div>
          {(section === "employees" || section === "sites") && !editing && (
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
        {editing && (section === "employees" || section === "sites") && (
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
                ...(section === "sites"
                  ? {
                      latitude: Number(form.get("latitude")),
                      longitude: Number(form.get("longitude")),
                      radius: Number(form.get("radius")),
                    }
                  : {}),
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
              {section === "sites" && (
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
        {section === "telegram" ? (
          <section className="basic-operations">
            <p>
              Los envíos inciertos requieren revisión. Esta pantalla no reenvía
              mensajes.
            </p>
            <button
              className="basic-secondary"
              disabled={busy}
              onClick={() =>
                void perform(async () =>
                  setOperations(await request("telegram-operations")),
                )
              }
            >
              Actualizar estado
            </button>
            <h2>Mensajes recibidos</h2>
            <ul>
              {operations?.inbound.map((row) => (
                <li key={row.updateId}>
                  Actualización {row.updateId} · {row.status} ·{" "}
                  {date(row.receivedAt)}
                  {row.reasonCode ? ` · ${row.reasonCode}` : ""}
                </li>
              ))}
            </ul>
            <h2>Respuestas del bot</h2>
            <ul>
              {operations?.outbound.map((row, index) => (
                <li key={index}>
                  {row.status} · {row.attempts} intento(s) ·{" "}
                  {date(row.createdAt)}
                  {row.reasonCode ? ` · ${row.reasonCode}` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : section === "attendance" ? (
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
                      : "Las entradas y salidas confirmadas por Telegram aparecerán acá."}
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
                  <th>
                    {section === "employees"
                      ? "Vínculo de Telegram"
                      : "Ubicación"}
                  </th>
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
                        {"telegramLinked" in row
                          ? row.telegramLinked
                            ? "Telegram vinculado"
                            : "Sin vincular"
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
                        {"telegramLinked" in row && (
                          <div className="basic-link-actions">
                            {!row.telegramLinked && row.active && (
                              <button
                                className="basic-secondary"
                                disabled={busy}
                                aria-label={`Generar código para ${row.name}`}
                                onClick={() =>
                                  void perform(async () => {
                                    const issued = await request(
                                      "employees/link-code",
                                      { employeeId: row._id },
                                    );
                                    setVisibleCode({
                                      employeeId: row._id,
                                      code: issued.code,
                                      expiresAt: issued.expiresAt,
                                    });
                                  })
                                }
                              >
                                Generar código
                              </button>
                            )}
                            <button
                              className="basic-secondary"
                              disabled={busy}
                              aria-label={`Revocar vínculo de ${row.name}`}
                              onClick={() =>
                                void perform(async () => {
                                  await request("employees/revoke-link", {
                                    employeeId: row._id,
                                  });
                                  setVisibleCode(null);
                                  await reload();
                                  setNotice("Vínculo revocado.");
                                })
                              }
                            >
                              Revocar
                            </button>
                          </div>
                        )}
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
                    ? "Cargá un empleado y generá un código para vincularlo con el bot de Telegram."
                    : "Definí la ubicación y el radio permitido para registrar asistencia."}
                </p>
              </div>
            )}
          </div>
        )}
        {section === "employees" && visibleCode && (
          <aside className="basic-code" aria-live="polite">
            <h2>Código de vinculación</h2>
            <p>
              Mostrá este código una sola vez al empleado. Debe abrir un chat
              privado con el bot de Telegram y enviarlo antes del vencimiento.
            </p>
            <code>{visibleCode.code}</code>
            <p>Vence el {date(visibleCode.expiresAt)}.</p>
            <button
              className="basic-secondary"
              onClick={() =>
                void navigator.clipboard?.writeText(visibleCode.code)
              }
            >
              Copiar código
            </button>
          </aside>
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
