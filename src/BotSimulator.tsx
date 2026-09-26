import { useEffect, useState, useRef } from "react";
type Row = Record<string, any>;
export default function BotSimulator({
  employee,
  site,
  onChange,
}: {
  employee: Row | undefined;
  site: Row | undefined;
  onChange: () => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [history, setHistory] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const currentEmployee = useRef(employee?.id);
  currentEmployee.current = employee?.id;
  async function load() {
    if (!employee) {
      setHistory([]);
      return;
    }
    const r = await fetch("/api/simulate/text/" + employee.id);
    if (!r.ok) throw new Error("No se pudo cargar la conversación local.");
    const rows = await r.json();
    if (currentEmployee.current === employee.id) setHistory(rows);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [employee?.id]);
  async function send(location = false) {
    if (!employee) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/simulate/" + (location ? "location" : "text"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            location
              ? {
                  employeeId: employee.id,
                  latitude: site?.lat,
                  longitude: site?.lon,
                }
              : { employeeId: employee.id, text },
          ),
        },
      );
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setText("");
      await load();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel bot-simulator">
      <h2>Conversación de prueba local</h2>
      <p>
        Usá el empleado y la sede seleccionados en «Prepará una fichada». Esta
        conversación tiene intenciones separadas de Telegram y nunca genera
        mensajes para enviar.
      </p>
      <p>
        <strong>Comandos:</strong> entrada, salida, pausa, finpausa, cancelar,
        ayuda.
      </p>
      <p>
        Licencia:{" "}
        <code>
          solicitar licencia 17/09/2026 18/09/2026 | Vacaciones | Viaje familiar
        </code>
        . Queda pendiente de RRHH.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <fieldset disabled={busy || !employee}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label>
            Mensaje de {employee?.name || "empleado"}
            <input
              required
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribí ayuda para empezar"
            />
          </label>
          <div className="comm-actions">
            <button className="primary">Simular mensaje</button>
            <button
              type="button"
              className="secondary"
              disabled={!site}
              onClick={() => void send(true)}
            >
              Compartir ubicación simulada · {site?.name || "seleccionar sede"}
            </button>
          </div>
        </form>
      </fieldset>
      <div className="bot-simulator-history" aria-live="polite">
        {history.length === 0 ? (
          <p>Sin mensajes locales de este empleado.</p>
        ) : (
          history.map((row, i) => (
            <article key={i}>
              <strong>{row.input_text}</strong>
              <p>{row.reply}</p>
              <small>
                Simulador ·{" "}
                {new Date(row.time).toLocaleString("es-AR", {
                  timeZone: "America/Argentina/Buenos_Aires",
                  hourCycle: "h23",
                })}
              </small>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
