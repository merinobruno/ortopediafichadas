import { useState, type FormEvent } from "react";
type Row = Record<string, any>;
export default function ManualAttendance({
  employees,
  sites,
  onSaved,
}: {
  employees: Row[];
  sites: Row[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [employee, setEmployee] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const person = employees.find((e) => e.id === employee);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const value = {
        ...Object.fromEntries(f),
        entry_at: new Date(String(f.get("entry_at"))).toISOString(),
        exit_at: new Date(String(f.get("exit_at"))).toISOString(),
      };
      const r = await fetch("/api/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setOpen(false);
      setNotice(
        "Visita registrada como Carga manual RRHH. Se conservó el motivo y tu usuario en la auditoría.",
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="manual-entry">
      <button
        className="secondary"
        onClick={() => {
          setOpen(!open);
          setError("");
          setNotice("");
        }}
      >
        {open ? "Cerrar carga manual" : "Carga manual RRHH"}
      </button>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {open && (
        <section className="editor">
          <div className="section-heading">
            <h2>Registrar una visita confirmada</h2>
          </div>
          <form onSubmit={submit}>
            <p className="form-note">
              Cargá entrada y salida históricas verificadas. No se registra
              ubicación ni se simula un mensaje de WhatsApp. Los horarios
              corresponden a la zona de tu dispositivo.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-grid">
              <label className="field">
                <span>Empleado</span>
                <select
                  name="employee_id"
                  value={employee}
                  onChange={(e) => setEmployee(e.target.value)}
                  required
                >
                  <option value="">Seleccionar empleado</option>
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
                <span>Sede autorizada</span>
                <select key={employee} name="site_id" required defaultValue="">
                  <option value="">Seleccionar sede</option>
                  {sites
                    .filter((s) => s.active && person?.site_ids.includes(s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Entrada confirmada</span>
                <input
                  type="datetime-local"
                  step="1"
                  name="entry_at"
                  required
                />
              </label>
              <label className="field">
                <span>Salida confirmada</span>
                <input type="datetime-local" step="1" name="exit_at" required />
              </label>
              <label className="field">
                <span>Motivo y fuente de confirmación</span>
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  placeholder="Explicá cómo se verificaron los horarios"
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                Guardar visita confirmada
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
