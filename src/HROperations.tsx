import Catalogs from "./Catalogs";
import { useState, useEffect, type FormEvent } from "react";
type Row = Record<string, any>;
type Props = {
  employees: Row[];
  visits: Row[];
  shifts: Row[];
  supervisor?: boolean;
};
export default function HROperations({
  employees,
  visits,
  shifts,
  supervisor = false,
}: Props) {
  const [data, setData] = useState<Row>({
      breaks: [],
      assignments: [],
      overtime: [],
      holidays: [],
      taxonomy: [],
      employeeTags: [],
    }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [correcting, setCorrecting] = useState<Row | null>(null),
    [tab, setTab] = useState("breaks");
  const load = async () => {
    const r = await fetch("/api/hr");
    if (!r.ok)
      throw new Error(
        "No se pudo cargar la operación. Volvé a iniciar sesión.",
      );
    setData(await r.json());
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const save = async (path: string, body: any) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/hr/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      await load();
      setNotice("Cambios guardados");
      setCorrecting(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const form = (path: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save(path, Object.fromEntries(new FormData(e.currentTarget)));
  };
  const person = (id: string) => employees.find((e) => e.id === id)?.name || id;
  const employeeSelect = (
    <select aria-label="Empleado" name="employee" required>
      {employees
        .filter((e) => e.active)
        .map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
    </select>
  );
  const format = (t: string) =>
    t
      ? new Date(t).toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          hourCycle: "h23",
        })
      : "Pendiente";
  return (
    <>
      <div className="filters hr-tabs">
        {[
          ["breaks", "Pausas"],
          ["assignments", "Asignaciones"],
          ["overtime", "Horas extra"],
          ["calendar", "Calendario"],
          ["organization", "Sectores y etiquetas"],
        ].map(([id, name]) => (
          <button
            className={tab === id ? "primary" : "secondary"}
            onClick={() => setTab(id)}
            key={id}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="panel settings-panel">
        {tab === "breaks" && (
          <>
            <h2>Pausas dentro de una visita</h2>
            <p>
              Registro administrativo. Se necesita una entrada abierta; una
              pausa sin fin queda incompleta al cambiar de sede.
            </p>
            <form
              hidden={supervisor}
              className="filters"
              onSubmit={form("break")}
            >
              {employeeSelect}
              <select name="action" aria-label="Acción">
                <option value="start">Iniciar pausa</option>
                <option value="end">Finalizar pausa</option>
              </select>
              <button className="primary" disabled={busy}>
                Registrar pausa
              </button>
            </form>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Inicio</th>
                    <th>Fin</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.breaks.map((b: Row) => (
                    <tr key={b.id}>
                      <td>
                        {person(
                          visits.find((v) => v.id === b.visit_id)?.employee_id,
                        )}
                      </td>
                      <td>{format(b.started_at)}</td>
                      <td>{format(b.ended_at)}</td>
                      <td>
                        {b.status === "end_unknown"
                          ? "Fin desconocido"
                          : b.status === "open"
                            ? "En pausa"
                            : "Completa"}
                      </td>
                      <td>
                        {!supervisor && b.status === "end_unknown" && (
                          <button
                            className="text-button"
                            onClick={() => setCorrecting(b)}
                          >
                            Confirmar fin
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {correcting && !supervisor && (
              <form
                className="editor settings-panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  save("break/" + correcting.id + "/correct", {
                    time: new Date(String(f.get("time"))).toISOString(),
                    reason: f.get("reason"),
                  });
                }}
              >
                <h3>Confirmar fin de pausa</h3>
                <p>
                  Inicio: {format(correcting.started_at)}. El fin debe estar
                  dentro de la visita o antes de la siguiente entrada.
                </p>
                <div className="form-grid">
                  <label className="field">
                    <span>Fin confirmado (hora de tu dispositivo)</span>
                    <input
                      name="time"
                      type="datetime-local"
                      step="1"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Motivo de la corrección</span>
                    <input name="reason" minLength={5} required />
                  </label>
                </div>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setCorrecting(null)}
                  >
                    Cancelar
                  </button>
                  <button className="primary" disabled={busy}>
                    Guardar fin confirmado
                  </button>
                </div>
              </form>
            )}
            <p>
              Los reportes descuentan las pausas completas. Una pausa sin fin
              deja las horas de esa visita pendientes.
            </p>
          </>
        )}
        {tab === "assignments" && (
          <>
            <h2>Asignaciones con vigencia</h2>
            <p>
              Gestioná los turnos, descansos y rotaciones desde Calendario y
              rotaciones. Las asignaciones anteriores se conservaron desde la
              fecha de migración, sin inferir jornadas pasadas.
            </p>
          </>
        )}
        {tab === "overtime" && (
          <>
            <h2>Horas extra para revisión</h2>
            <p>
              RRHH indica los minutos adicionales de una visita completa. No se
              calculan automáticamente ni se suman a liquidación.
            </p>
            <form
              hidden={supervisor}
              className="form-grid"
              onSubmit={form("overtime")}
            >
              <label className="field">
                <span>Visita completa</span>
                <select name="visit" required>
                  {visits
                    .filter((v) => v.exit_at)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {person(v.employee_id)} · {format(v.entry_at)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Minutos adicionales</span>
                <input
                  type="number"
                  name="minutes"
                  min={1}
                  max={1440}
                  required
                />
              </label>
              <label className="field">
                <span>Motivo</span>
                <input name="reason" minLength={5} required />
              </label>
              <button className="primary" disabled={busy}>
                Solicitar aprobación
              </button>
            </form>
            {data.overtime.map((o: Row) => (
              <div className="setting-row" key={o.id}>
                <span>
                  {person(visits.find((v) => v.id === o.visit_id)?.employee_id)}{" "}
                  · {o.minutes} minutos<small>{o.reason}</small>
                </span>
                {o.status === "pending" ? (
                  <div className="inline-actions">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        save("overtime/" + o.id, { status: "approved" })
                      }
                    >
                      Aprobar
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() =>
                        save("overtime/" + o.id, { status: "rejected" })
                      }
                    >
                      Rechazar
                    </button>
                  </div>
                ) : (
                  <strong>
                    {o.status === "approved" ? "Aprobadas" : "Rechazadas"}
                  </strong>
                )}
              </div>
            ))}
          </>
        )}
        {tab === "calendar" && (
          <>
            <h2>Feriados de la organización</h2>
            <p>
              Calendario propio usado como contexto para revisar turnos. No
              carga feriados automáticamente.
            </p>
            <form
              hidden={supervisor}
              className="filters"
              onSubmit={form("holiday")}
            >
              <input type="date" name="day" aria-label="Fecha" required />
              <input
                name="name"
                aria-label="Nombre del feriado"
                placeholder="Nombre del feriado"
                required
                minLength={2}
              />
              <button className="primary" disabled={busy}>
                Guardar feriado
              </button>
            </form>
            <Catalogs
              kinds={["holiday"]}
              employees={employees}
              supervisor={supervisor}
              version={data}
              onChange={load}
            />
          </>
        )}
        {tab === "organization" && (
          <>
            <h2>Organización del equipo</h2>
            <p>
              Catálogo de sectores, etiquetas y categorías. Asociá sectores o
              etiquetas a personas para identificarlas.
            </p>
            <form
              hidden={supervisor}
              className="filters"
              onSubmit={form("taxonomy")}
            >
              <select name="kind" aria-label="Tipo">
                <option value="sector">Sector</option>
                <option value="tag">Etiqueta</option>
                <option value="category">Categoría de sede</option>
              </select>
              <input
                name="name"
                aria-label="Nombre"
                placeholder="Nombre"
                required
                minLength={2}
              />
              <button className="primary" disabled={busy}>
                Agregar
              </button>
            </form>
            <form
              hidden={supervisor}
              className="filters"
              onSubmit={form("tag")}
            >
              {employeeSelect}
              <select name="tag" aria-label="Sector o etiqueta" required>
                {data.taxonomy
                  .filter((t: Row) => t.kind !== "category" && !t.archived)
                  .map((t: Row) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              <button
                className="primary"
                disabled={busy || !data.taxonomy.length}
              >
                Asociar a empleado
              </button>
            </form>
            <Catalogs
              kinds={["sector", "tag", "category"]}
              employees={employees}
              supervisor={supervisor}
              version={data}
              onChange={load}
            />
          </>
        )}
      </section>
    </>
  );
}
