import { useState, useEffect, useRef, type FormEvent } from "react";
import { Download } from "lucide-react";
import { reportingDay } from "../shared/reporting";
type Row = Record<string, any>;
const statuses: Row = {
  open: "En sede",
  complete: "Completa",
  corrected: "Corregida",
  exit_unknown: "Salida desconocida",
};
const origin: Row = {
  manual_hr: "Carga manual RRHH",
  simulator: "Simulador",
  demo: "Demo",
  telegram: "Telegram",
  whatsapp: "WhatsApp (histórico)",
};
const when = (value: string) =>
  value
    ? new Date(value).toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hourCycle: "h23",
      })
    : "—";
export default function Reports({
  employees,
  sites,
}: {
  employees: Row[];
  sites: Row[];
}) {
  const today = reportingDay(new Date().toISOString());
  const [draft, setDraft] = useState({
      from: today.slice(0, 8) + "01",
      to: today,
      employee: "",
      site: "",
      status: "",
      search: "",
    }),
    [applied, setApplied] = useState(draft),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = async (filters: typeof draft) => {
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/reports/summary?" + new URLSearchParams(filters),
      );
      const body = await response.json();
      if (id !== generation.current) return;
      if (!response.ok) throw new Error(body.error);
      setData(body);
      setApplied(filters);
    } catch (e) {
      if (id === generation.current) setError((e as Error).message);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    load(draft);
    return () => {
      generation.current++;
    };
  }, []);
  const change = (key: keyof typeof draft, value: string) =>
    setDraft({ ...draft, [key]: value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    load({ ...draft });
  };
  const query = new URLSearchParams(applied).toString();
  const canExport = !busy && Boolean(applied.from && applied.to);
  const groupTable = (title: string, groups: Row[]) => (
    <section className="panel">
      <div className="section-heading">
        <h2>{title}</h2>
        <span className="muted">Días según fecha de entrada</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{title === "Por empleado" ? "Empleado" : "Sede"}</th>
              <th>Visitas</th>
              <th>Días</th>
              <th>Medibles</th>
              <th>Horas netas</th>
              <th>Abiertas</th>
              <th>Salida desconocida</th>
              <th>Pausa sin fin</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <strong>{g.name}</strong>
                </td>
                <td>{g.visits}</td>
                <td>{g.entryDays}</td>
                <td>{g.measurableVisits}</td>
                <td className="numbers">{g.netHours.toFixed(2)}</td>
                <td>{g.openVisits}</td>
                <td>{g.unknownExits}</td>
                <td>{g.unknownPauses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!groups.length && (
        <p className="empty">No hay resultados para estos filtros.</p>
      )}
    </section>
  );
  return (
    <>
      <section className="panel report-filters">
        <h2>Reporte del período</h2>
        <p>
          Filtrá y consultá para actualizar tablas y descargas. Las fechas se
          atribuyen al ingreso en Buenos Aires; una visita nocturna no se divide
          entre días.
        </p>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field">
              <span>Desde</span>
              <input
                type="date"
                value={draft.from}
                onChange={(e) => change("from", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Hasta</span>
              <input
                type="date"
                value={draft.to}
                onChange={(e) => change("to", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Empleado</span>
              <select
                value={draft.employee}
                onChange={(e) => change("employee", e.target.value)}
              >
                <option value="">Todos los empleados a cargo</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Sede</span>
              <select
                value={draft.site}
                onChange={(e) => change("site", e.target.value)}
              >
                <option value="">Todas las sedes</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Estado de visita</span>
              <select
                value={draft.status}
                onChange={(e) => change("status", e.target.value)}
              >
                <option value="">Todos los estados</option>
                {Object.entries(statuses).map(([id, label]) => (
                  <option key={id} value={id}>
                    {String(label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Buscar nombre</span>
              <input
                value={draft.search}
                onChange={(e) => change("search", e.target.value)}
                placeholder="Nombre del empleado"
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const all = {
                  from: "",
                  to: "",
                  employee: "",
                  site: "",
                  status: "",
                  search: "",
                };
                setDraft(all);
                load(all);
              }}
            >
              Ver todo el historial
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Consultando…" : "Consultar reporte"}
            </button>
          </div>
        </form>
        {error && (
          <p className="error" role="alert">
            {error} Los resultados anteriores no se actualizaron.
          </p>
        )}
      </section>
      {data && (
        <>
          <div className="report-applied">
            <p>
              Resultados aplicados: {applied.from || "inicio del historial"} a{" "}
              {applied.to || "último registro"} ·{" "}
              {employees.find((e) => e.id === applied.employee)?.name ||
                "todos los empleados"}{" "}
              ·{" "}
              {sites.find((s) => s.id === applied.site)?.name ||
                "todas las sedes"}{" "}
              · {statuses[applied.status] || "todos los estados"}
              {applied.search ? ` · nombre contiene “${applied.search}”` : ""}
            </p>
            <div className="inline-actions">
              {(["xlsx", "pdf"] as const).map((format) => (
                <a
                  key={format}
                  className="secondary"
                  href={
                    canExport
                      ? "/api/reports/summary." + format + "?" + query
                      : undefined
                  }
                  aria-disabled={!canExport}
                  tabIndex={canExport ? 0 : -1}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download size={15} />
                  {format === "xlsx" ? "Excel (.xlsx)" : "PDF"}
                </a>
              ))}
              <a
                className="secondary"
                href={"/api/reports/summary.csv?" + query}
              >
                <Download size={15} />
                Resumen CSV
              </a>
              <a className="secondary" href={"/api/export?" + query}>
                <Download size={15} />
                Detalle CSV
              </a>
            </div>
          </div>
          {(!applied.from || !applied.to) && (
            <p className="report-export-note">
              Seleccioná un período para exportar Excel o PDF. CSV conserva el
              modo historial.
            </p>
          )}
          <p className="report-export-note">
            Excel admite hasta 10.000 visitas y PDF hasta 2.000. La descarga
            puede demorar hasta 30 segundos; si no se puede generar, el motivo
            aparece en otra pestaña y este reporte se conserva.
          </p>
          <section className="report-totals" aria-label="Resumen del período">
            {[
              [data.overall.visits, "Visitas"],
              [data.overall.entryDays, "Días con entradas"],
              [data.overall.measurableVisits, "Visitas medibles"],
              [data.overall.netHours.toFixed(2), "Horas netas conocidas"],
            ].map(([value, label]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </section>
          <div className="report-exceptions">
            <span>
              <b>{data.overall.openVisits}</b> visitas abiertas
            </span>
            <span>
              <b>{data.overall.unknownExits}</b> salidas desconocidas
            </span>
            <span>
              <b>{data.overall.unknownPauses}</b> visitas cerradas con pausa sin
              fin
            </span>
          </div>
          <p className="report-explanation">
            Las pausas completas se descuentan una vez. Las visitas incompletas
            no aportan horas estimadas. Horas extra aprobadas:{" "}
            <strong>{data.approvedOvertimeMinutes} minutos</strong>, informados
            por separado y no sumados al total. Este reporte no realiza
            liquidación.
          </p>
          {groupTable("Por empleado", data.byEmployee)}
          {groupTable("Por sede", data.bySite)}
          <section className="panel">
            <div className="section-heading">
              <h2>Detalle de las visitas incluidas</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Sede</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Estado</th>
                    <th>Horas netas</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.details.map((v: Row) => (
                    <tr key={v.id}>
                      <td>{v.employee_name}</td>
                      <td>{v.site_name}</td>
                      <td>{when(v.entry_at)}</td>
                      <td>{when(v.exit_at)}</td>
                      <td>{statuses[v.status]}</td>
                      <td>
                        {v.netHours === null
                          ? "No medible"
                          : v.netHours.toFixed(2)}
                      </td>
                      <td>{origin[v.source] || v.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.details.length && (
              <p className="empty">No hay visitas para este período.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
