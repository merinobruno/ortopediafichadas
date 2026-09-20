import { useState, useEffect, useRef } from "react";
import { reportingDay } from "../shared/reporting";
type Row = Record<string, any>;
const names: Row = {
  unscheduled: "Sin planificación",
  rest: "Descanso",
  holiday: "Feriado",
  leave: "Licencia aprobada",
  upcoming: "Próxima jornada",
  awaiting: "Esperando ingreso",
  on_time: "En horario",
  late: "Llegada tarde",
  absent: "Sin ingreso al cierre",
  review_required: "Revisar turno nocturno",
};
const dayPlus = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
const today = reportingDay(new Date().toISOString());
const initialMonday = dayPlus(
  today,
  -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7),
);
export default function WeeklyPlanning({
  employees,
  supervisor,
  onLockChange,
}: {
  employees: Row[];
  supervisor: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const [week, setWeek] = useState(initialMonday),
    [employee, setEmployee] = useState(""),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<Row | null>(null),
    [changes, setChanges] = useState<Record<string, Row>>({}),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState<Row | null>(null);
  const sequence = useRef(0);
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => {
    onLockChange(busy || dirty);
    return () => onLockChange(false);
  }, [busy, dirty, onLockChange]);
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  async function load() {
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    setData(null);
    setHistory(null);
    try {
      const r = await fetch(
        "/api/planning/week?" +
          new URLSearchParams({
            week,
            offset: String(offset),
            limit: "20",
            ...(employee ? { employee } : {}),
          }),
      );
      const result = await r.json();
      if (request !== sequence.current) return;
      if (!r.ok) throw new Error(result.error);
      setData(result);
    } catch (e: any) {
      if (request === sequence.current) setError(e.message);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [week, employee, offset]);
  function original(person: Row, c: Row) {
    return {
      employee_id: person.id,
      day: c.day,
      expected_revision: c.override_revision,
      mode: c.mode,
      shift_id: c.snapshot?.shift?.id || null,
      site_id: c.snapshot?.site?.id || null,
    };
  }
  function edit(person: Row, c: Row, patch: Row) {
    const key = person.id + ":" + c.day,
      base = original(person, c),
      next = { ...(changes[key] || base), ...patch };
    setChanges((old) => {
      const copy = { ...old };
      if (JSON.stringify(next) === JSON.stringify(base)) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    setNotice("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !dirty) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/planning/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week: data.week,
          reason,
          changes: Object.values(changes),
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setChanges({});
      setReason("");
      setNotice(
        `${result.changed} día(s) guardados. Las fichadas originales no cambiaron.`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function showHistory(person: Row, c: Row, start = 0) {
    setBusy(true);
    setError("");
    const request = ++sequence.current;
    try {
      const r = await fetch(
        "/api/planning/history?" +
          new URLSearchParams({
            employee: person.id,
            day: c.day,
            offset: String(start),
          }),
      );
      const result = await r.json();
      if (request !== sequence.current) return;
      if (!r.ok) throw new Error(result.error);
      setHistory({ ...result, person, cell: c, offset: start });
    } catch (e: any) {
      if (request === sequence.current) setError(e.message);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  return (
    <section className="weekly-planning">
      <div className="notice">
        Cambios por fecha, sin reemplazar las rotaciones. La sede prevista es
        orientativa: permite fichar en cualquiera de las sedes autorizadas.
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <fieldset disabled={busy || dirty} className="weekly-controls">
        <label>
          Lunes de la semana
          <input
            type="date"
            value={week}
            onChange={(e) => {
              setWeek(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          Empleado
          <select
            value={employee}
            onChange={(e) => {
              setEmployee(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Todo mi equipo</option>
            {employees.map((e) => (
              <option value={e.id} key={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          type="button"
          onClick={() => setWeek(dayPlus(week, -7))}
          disabled={!week}
        >
          Semana anterior
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => setWeek(dayPlus(week, 7))}
          disabled={!week}
        >
          Semana siguiente
        </button>
        <button className="secondary" type="button" onClick={() => void load()}>
          Recargar
        </button>
      </fieldset>
      {busy && <p role="status">Cargando o guardando la planificación…</p>}
      {dirty && (
        <div className="weekly-dirty">
          <strong>{Object.keys(changes).length} cambios pendientes</strong>
          <p>
            Guardá o descartá los cambios antes de cambiar de semana, página o
            sección.
          </p>
          <button
            className="secondary"
            disabled={busy}
            type="button"
            onClick={() => {
              setChanges({});
              setReason("");
              setError("");
              setNotice(
                "Cambios locales descartados. Recargá para ver la última versión.",
              );
            }}
          >
            Descartar cambios pendientes
          </button>
        </div>
      )}
      {data && (
        <>
          <h2>Semana del {data.week}</h2>
          <p>
            {data.total} empleado(s) en tu alcance · página{" "}
            {Math.floor(data.offset / data.limit) + 1}
          </p>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <div className="weekly-team">
                {data.rows.map((person: Row) => (
                  <article className="weekly-person" key={person.id}>
                    <h3>
                      {person.name}
                      {!person.active ? " · inactivo" : ""}
                    </h3>
                    <div className="weekly-grid">
                      {person.cells.map((c: Row) => {
                        const value =
                          changes[person.id + ":" + c.day] ||
                          original(person, c);
                        const effective = c.effective;
                        return (
                          <section
                            className={
                              "weekly-day " +
                              (changes[person.id + ":" + c.day]
                                ? "changed"
                                : "")
                            }
                            key={c.day}
                          >
                            <h4>
                              {new Date(
                                c.day + "T12:00:00Z",
                              ).toLocaleDateString("es-AR", {
                                weekday: "short",
                                day: "numeric",
                                month: "numeric",
                                timeZone: "America/Argentina/Buenos_Aires",
                              })}
                            </h4>
                            <p>
                              {effective.start
                                ? `${effective.start}–${effective.end} · ${effective.shift_name}`
                                : "Sin horario"}
                              <small>
                                {names[effective.status]} ·{" "}
                                {effective.expectation_origin === "override"
                                  ? "Por fecha"
                                  : effective.expectation_origin === "rotation"
                                    ? "Rotación"
                                    : "Sin base"}
                              </small>
                              {effective.planned_site && (
                                <small>
                                  Sede prevista: {effective.planned_site.name}
                                </small>
                              )}
                            </p>
                            {!supervisor && person.active && (
                              <>
                                <label>
                                  Plan del día
                                  <select
                                    aria-label={`Plan ${person.name} ${c.day}`}
                                    value={
                                      value.mode === "shift"
                                        ? "shift:" + value.shift_id
                                        : value.mode
                                    }
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      edit(
                                        person,
                                        c,
                                        v.startsWith("shift:")
                                          ? {
                                              mode: "shift",
                                              shift_id: v.slice(6),
                                              site_id: null,
                                            }
                                          : {
                                              mode: v,
                                              shift_id: null,
                                              site_id: null,
                                            },
                                      );
                                    }}
                                  >
                                    <option value="inherit">
                                      Heredar rotación
                                    </option>
                                    <option value="rest">Descanso</option>
                                    {c.snapshot?.shift &&
                                      !data.shifts.some(
                                        (s: Row) =>
                                          s.id === c.snapshot.shift.id,
                                      ) && (
                                        <option
                                          disabled
                                          value={"shift:" + c.snapshot.shift.id}
                                        >
                                          {c.snapshot.shift.name} · archivado
                                        </option>
                                      )}
                                    {data.shifts.map((s: Row) => (
                                      <option
                                        value={"shift:" + s.id}
                                        key={s.id}
                                      >
                                        {s.name} {s.start}–{s.end}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {value.mode === "shift" && (
                                  <label>
                                    Sede prevista
                                    <select
                                      aria-label={`Sede ${person.name} ${c.day}`}
                                      value={value.site_id || ""}
                                      onChange={(e) =>
                                        edit(person, c, {
                                          site_id: e.target.value || null,
                                        })
                                      }
                                    >
                                      <option value="">
                                        Sin sede prevista
                                      </option>
                                      {value.site_id &&
                                        !data.sites.some(
                                          (s: Row) =>
                                            s.id === value.site_id &&
                                            person.site_ids.includes(s.id),
                                        ) && (
                                          <option
                                            value={value.site_id}
                                            disabled
                                          >
                                            {c.snapshot?.site?.name ||
                                              "Sede histórica"}{" "}
                                            · histórica
                                          </option>
                                        )}
                                      {data.sites
                                        .filter((s: Row) =>
                                          person.site_ids.includes(s.id),
                                        )
                                        .map((s: Row) => (
                                          <option key={s.id} value={s.id}>
                                            {s.name}
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                )}
                              </>
                            )}
                            <button
                              className="text-button"
                              type="button"
                              disabled={dirty}
                              onClick={() => void showHistory(person, c)}
                            >
                              Historial · v{c.override_revision}
                            </button>
                          </section>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
              {!data.rows.length && (
                <p className="empty">No hay empleados para estos filtros.</p>
              )}
              {dirty && !supervisor && (
                <div className="weekly-save">
                  <label>
                    Motivo común para los cambios
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      minLength={5}
                      maxLength={1000}
                    />
                  </label>
                  <button className="primary">Guardar todos los cambios</button>
                </div>
              )}
            </fieldset>
          </form>
          <fieldset disabled={busy || dirty} className="weekly-controls">
            <button
              className="secondary"
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - data.limit))}
            >
              Página anterior
            </button>
            <button
              className="secondary"
              type="button"
              disabled={offset + data.limit >= data.total}
              onClick={() => setOffset(offset + data.limit)}
            >
              Página siguiente
            </button>
          </fieldset>
        </>
      )}
      {history && (
        <section className="panel weekly-history">
          <h3>
            Historial · {history.person.name} · {history.cell.day}
          </h3>
          <button
            className="secondary"
            disabled={busy}
            type="button"
            onClick={() => setHistory(null)}
          >
            Cerrar historial
          </button>
          {history.rows.map((r: Row) => (
            <article key={r.revision}>
              <strong>
                Versión {r.revision} ·{" "}
                {r.mode === "inherit"
                  ? "Heredar rotación"
                  : r.mode === "rest"
                    ? "Descanso"
                    : r.snapshot.shift.name}
              </strong>
              {r.snapshot?.site && <p>Sede prevista: {r.snapshot.site.name}</p>}
              <p>{r.reason}</p>
              <small>
                {r.actor} ·{" "}
                {new Date(r.created_at).toLocaleString("es-AR", {
                  timeZone: "America/Argentina/Buenos_Aires",
                  hourCycle: "h23",
                })}
              </small>
            </article>
          ))}
          {!history.rows.length && <p>No hay cambios por fecha registrados.</p>}
          <div className="weekly-controls">
            <button
              className="secondary"
              disabled={busy || history.offset === 0}
              onClick={() =>
                void showHistory(
                  history.person,
                  history.cell,
                  Math.max(0, history.offset - 30),
                )
              }
            >
              Anteriores
            </button>
            <button
              className="secondary"
              disabled={busy || history.offset + 30 >= history.total}
              onClick={() =>
                void showHistory(
                  history.person,
                  history.cell,
                  history.offset + 30,
                )
              }
            >
              Más historial
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
