import { useEffect, useState } from "react";
type Row = Record<string, any>;
const names: Row = { late: "Tardanzas", absent: "Ausencias" };
const reasons: Row = {
  late: "Entrada después de la tolerancia",
  absent: "Sin entrada al finalizar el turno",
  holiday: "Feriado",
  leave: "Licencia aprobada",
  rest: "Descanso",
  unscheduled: "Sin planificación",
  inactive: "Empleado inactivo",
  on_time: "Entrada en horario",
  upcoming: "Jornada futura",
  awaiting: "Turno en curso",
  review_required: "Turno nocturno: revisión manual",
};
const when = (t: string) =>
  t
    ? new Date(t).toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hourCycle: "h23",
      })
    : "—";
export default function AttendanceExceptions({
  supervisor,
  compact = false,
}: {
  supervisor: boolean;
  compact?: boolean;
}) {
  const [data, setData] = useState<Row | null>(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [reason, setReason] = useState("");
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch("/api/attendance-exceptions?offset=" + offset);
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (live) {
          setData(b);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [offset, revision]);
  async function post(path: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/attendance-exceptions/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setRevision((v) => v + 1);
      setSelected(null);
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel exception-panel">
      <div className="section-heading">
        <div>
          <h2>
            {compact ? "Excepciones de jornada" : "Tardanzas y ausencias"}
          </h2>
          <p>
            Revisar una excepción no corrige las fichadas ni calcula descuentos.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {data ? (
        <>
          <div className="exception-counts">
            <div>
              <strong>{data.counts.activeUnreviewed}</strong>
              <span>Activas sin revisar</span>
            </div>
            <div>
              <strong>{data.counts.activeReviewed}</strong>
              <span>Activas revisadas</span>
            </div>
            <div>
              <strong>{data.counts.resolved}</strong>
              <span>Condición resuelta</span>
            </div>
          </div>
          <p className="exception-progress" role="status">
            {data.reconciliation.pending
              ? `Reconciliación pendiente · procesando desde ${data.reconciliation.nextDay}. Los conteos pueden cambiar.`
              : "Sin trabajos pendientes. Evaluación periódica; las ausencias aparecen sólo después del fin del turno."}
          </p>
          {!compact && (
            <>
              {!supervisor && (
                <div className="exception-rules">
                  {data.rules.map((r: Row) => (
                    <form
                      key={r.type}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void post("rules/" + r.type, {
                          enabled: f.get("enabled") === "on",
                          priority: f.get("priority"),
                        });
                      }}
                    >
                      <h3>{names[r.type]}</h3>
                      <label className="exception-toggle">
                        <input
                          name="enabled"
                          type="checkbox"
                          defaultChecked={!!r.enabled}
                          key={String(r.enabled)}
                        />
                        Detectar desde hoy
                      </label>
                      <label>
                        Prioridad
                        <select
                          name="priority"
                          defaultValue={r.priority}
                          key={r.priority}
                        >
                          <option value="low">Baja</option>
                          <option value="normal">Normal</option>
                          <option value="high">Alta</option>
                        </select>
                      </label>
                      <button className="secondary" disabled={busy}>
                        Guardar regla
                      </button>
                    </form>
                  ))}
                </div>
              )}
              <p>
                Una nueva activación no revisa días anteriores. Desactivar
                conserva las excepciones y su revisión. No se envían
                notificaciones externas.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado / fecha</th>
                      <th>Tipo / prioridad</th>
                      <th>Evidencia actual</th>
                      <th>Condición / revisión</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((x: Row) => (
                      <tr key={x.id}>
                        <td>
                          <strong>{x.employee_name}</strong>
                          <small>{x.day}</small>
                        </td>
                        <td>
                          {names[x.type]}
                          <small>
                            {
                              { low: "Baja", normal: "Normal", high: "Alta" }[
                                x.priority as "low"
                              ]
                            }
                          </small>
                        </td>
                        <td>
                          {x.current_evidence.shift_name || "Sin turno"}
                          <small>
                            {x.current_evidence.start || "—"} –{" "}
                            {x.current_evidence.end || "—"} · tolerancia{" "}
                            {x.current_evidence.tolerance ?? "—"} min
                          </small>
                          <small>
                            Primera entrada:{" "}
                            {when(x.current_evidence.first_entry)}
                          </small>
                          <small>
                            {reasons[x.condition_reason] || x.condition_reason}
                          </small>
                        </td>
                        <td>
                          <span
                            className={
                              "badge " +
                              (x.condition === "active"
                                ? "exit_unknown"
                                : "complete")
                            }
                          >
                            {x.condition === "active" ? "Activa" : "Resuelta"}
                          </span>
                          <small>
                            {x.ack_at
                              ? `Revisada por ${x.ack_actor} · ${when(x.ack_at)}`
                              : "Sin revisar"}
                          </small>
                          {x.ack_reason && <small>{x.ack_reason}</small>}
                        </td>
                        <td>
                          {!supervisor && !x.ack_at ? (
                            <button
                              className="secondary"
                              onClick={() => {
                                setSelected(x);
                                setReason("");
                              }}
                            >
                              Revisar
                            </button>
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.rows.length === 0 && (
                  <p className="empty">
                    No hay excepciones registradas para tu equipo.
                  </p>
                )}
              </div>
              <div className="exception-pagination">
                <button
                  className="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Anterior
                </button>
                <span>
                  {data.total} registros · página {Math.floor(offset / 50) + 1}
                </span>
                <button
                  className="secondary"
                  disabled={offset + 50 >= data.total}
                  onClick={() => setOffset(offset + 50)}
                >
                  Siguiente
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <p>Cargando excepciones…</p>
      )}
      {selected && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exception-review-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelected(null);
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void post(selected.id + "/ack", { reason });
            }}
          >
            <h2 id="exception-review-title">
              Revisar {names[selected.type].toLowerCase()}
            </h2>
            <p>
              {selected.employee_name} · {selected.day}. La condición seguirá
              activa mientras la evidencia la sostenga.
            </p>
            <label>
              Motivo de la revisión
              <textarea
                autoFocus
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setSelected(null)}
              >
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                Confirmar revisión
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
