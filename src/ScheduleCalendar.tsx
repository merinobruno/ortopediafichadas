import { useState, useEffect, type FormEvent } from "react";
import { reportingDay } from "../shared/reporting";
type Row = Record<string, any>;
const labels: Row = {
  unscheduled: "Sin planificación",
  rest: "Descanso",
  holiday: "Feriado",
  leave: "Licencia aprobada",
  upcoming: "Próxima jornada",
  awaiting: "Esperando ingreso",
  on_time: "En horario",
  late: "Llegada tarde",
  absent: "Sin ingreso al cierre",
  review_required: "Revisión de turno nocturno",
};
export default function ScheduleCalendar({
  employees,
  shifts,
  supervisor,
}: {
  employees: Row[];
  shifts: Row[];
  supervisor: boolean;
}) {
  const today = reportingDay(new Date().toISOString());
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [employee, setEmployee] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [plans, setPlans] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [cycle, setCycle] = useState(7),
    [slots, setSlots] = useState<string[]>(Array(7).fill("")),
    [cancel, setCancel] = useState("");
  const load = async () => {
    setError("");
    try {
      const [r, p] = await Promise.all([
        fetch(
          "/api/calendar?" +
            new URLSearchParams({
              from,
              to,
              ...(employee ? { employee } : {}),
            }),
        ),
        fetch("/api/schedules"),
      ]);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (!p.ok) throw new Error("No se pudo cargar la planificación.");
      setRows(body);
      setPlans(await p.json());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const save = async (path: string, value: any) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setNotice("Planificación guardada. Las fichadas originales no cambian.");
      setCreating(false);
      setCancel("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save("schedules", {
      ...Object.fromEntries(f),
      cycle,
      slots: slots.map((s) => s || null),
    });
  };
  const name = (id: string) => employees.find((e) => e.id === id)?.name || id;
  return (
    <>
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
      <div className="info-line">
        Las jornadas se comparan con la primera entrada del día en cualquier
        sede. Feriados y licencias aprobadas suprimen excepciones. Los turnos
        nocturnos requieren revisión manual.
      </div>
      <section className="panel settings-panel">
        <div className="section-heading">
          <h2>Calendario de asistencia</h2>
          {!supervisor && (
            <button className="primary" onClick={() => setCreating(!creating)}>
              Nueva planificación
            </button>
          )}
        </div>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <label className="field">
            <span>Desde</span>
            <input
              type="date"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Hasta</span>
            <input
              type="date"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Empleado</span>
            <select
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
            >
              <option value="">Todos los empleados a cargo</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary">Consultar período</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Empleado</th>
                <th>Turno previsto</th>
                <th>Primera entrada</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id + r.day}>
                  <td>{r.day}</td>
                  <td>{name(r.employee_id)}</td>
                  <td>
                    {r.start ? `${r.start}–${r.end} · ${r.shift_name}` : "—"}
                    <small className="account-email">
                      {r.expectation_origin === "override"
                        ? "Plan por fecha"
                        : r.expectation_origin === "rotation"
                          ? "Rotación"
                          : "Sin base"}
                      {r.planned_site ? " / " + r.planned_site.name : ""}
                    </small>
                  </td>
                  <td>
                    {r.first_entry
                      ? new Date(r.first_entry).toLocaleTimeString("es-AR", {
                          timeZone: "America/Argentina/Buenos_Aires",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (["late", "absent", "review_required"].includes(
                          r.status,
                        )
                          ? "pending"
                          : "")
                      }
                    >
                      {labels[r.status]}
                    </span>
                    {r.note && (
                      <small className="account-email">{r.note}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="empty">No hay empleados para este período.</p>
        )}
      </section>
      {creating && !supervisor && (
        <section className="panel settings-panel">
          <h2>Planificar un ciclo con vigencia</h2>
          <p>
            El día 1 corresponde a la fecha de anclaje. Se repite cada 7 o 14
            días; elegí turno o descanso para cada día. No se permite superponer
            vigencias.
          </p>
          <form onSubmit={submit}>
            <div className="form-grid">
              <label className="field">
                <span>Empleado</span>
                <select name="employee_id" required>
                  {employees
                    .filter((e) => e.active)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Ciclo</span>
                <select
                  value={cycle}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setCycle(n);
                    setSlots(Array(n).fill(""));
                  }}
                >
                  <option value={7}>7 días</option>
                  <option value={14}>14 días</option>
                </select>
              </label>
              <label className="field">
                <span>Vigente desde (inclusive)</span>
                <input name="date_from" type="date" required />
              </label>
              <label className="field">
                <span>Vigente hasta (inclusive)</span>
                <input name="date_to" type="date" required />
              </label>
              <label className="field">
                <span>Anclaje: fecha del día 1</span>
                <input name="anchor" type="date" required />
              </label>
              <label className="field">
                <span>Motivo</span>
                <input name="reason" required minLength={5} />
              </label>
            </div>
            <div className="rotation-slots">
              {slots.map((slot, i) => (
                <label className="field" key={i}>
                  <span>Día {i + 1}</span>
                  <select
                    value={slot}
                    onChange={(e) =>
                      setSlots(
                        slots.map((v, j) => (j === i ? e.target.value : v)),
                      )
                    }
                  >
                    <option value="">Descanso</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.start}–{s.end}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setCreating(false)}
              >
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                Guardar planificación
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="panel settings-panel">
        <h2>Vigencias y referencias</h2>
        <p>
          Finalizar vigencia tiene efecto desde hoy y conserva el historial
          anterior. Las referencias migradas están inactivas hasta que RRHH cree
          un ciclo explícito.
        </p>
        {plans
          .filter((p) => !employee || p.employee_id === employee)
          .map((p) => (
            <div className="schedule-record" key={p.id}>
              <div className="setting-row">
                <span>
                  <strong>{name(p.employee_id)}</strong>
                  <small>
                    {p.status === "draft"
                      ? "Referencia anterior sin días configurados"
                      : `${p.date_from} a ${p.date_to} · ciclo ${p.cycle} días · anclaje ${p.anchor}`}
                  </small>
                  <small>
                    {p.slots
                      .map(
                        (slot: Row | null, i: number) =>
                          `${i + 1}: ${slot?.name || "descanso"}`,
                      )
                      .join(" · ")}
                  </small>
                </span>
                <span>
                  {p.status === "draft"
                    ? "Sin activar"
                    : p.status === "cancelled"
                      ? "Cancelada"
                      : p.date_to < today
                        ? "Finalizada"
                        : "Vigente"}
                  {!supervisor &&
                    p.status === "active" &&
                    p.date_to >= today && (
                      <button
                        className="text-button"
                        onClick={() => setCancel(cancel === p.id ? "" : p.id)}
                      >
                        Finalizar desde hoy
                      </button>
                    )}
                </span>
              </div>
              {cancel === p.id && (
                <form
                  className="filters"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save("schedules/" + p.id + "/cancel", {
                      reason: new FormData(e.currentTarget).get("reason"),
                    });
                  }}
                >
                  <input
                    name="reason"
                    aria-label="Motivo de finalización"
                    placeholder="Motivo de finalización"
                    minLength={5}
                    required
                  />
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setCancel("")}
                  >
                    Volver
                  </button>
                  <button className="primary" disabled={busy}>
                    Confirmar finalización
                  </button>
                </form>
              )}
            </div>
          ))}
        {!plans.length && (
          <p className="empty">
            Todavía no hay planificación. Creá una vigencia para empezar.
          </p>
        )}
      </section>
    </>
  );
}
