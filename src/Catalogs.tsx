import { useEffect, useState } from "react";
type Row = Record<string, any>;
const labels: Row = {
  shift: "Turnos",
  sector: "Sectores",
  tag: "Etiquetas",
  category: "Categorías de sede",
  holiday: "Feriados",
};
export default function Catalogs({
  kinds,
  employees,
  supervisor = false,
  version,
  onChange,
}: {
  kinds: string[];
  employees: Row[];
  supervisor?: boolean;
  version: unknown;
  onChange: () => Promise<any>;
}) {
  const [data, setData] = useState<Row>({ catalogs: {}, associations: [] }),
    [editor, setEditor] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = async () => {
    const r = await fetch("/api/catalogs");
    if (!r.ok) throw new Error("No se pudo cargar el catálogo.");
    setData(await r.json());
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [version]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = editor.remove
      ? {
          employee: editor.employee_id,
          tag: editor.tag_id,
          add: false,
          reason: values.reason,
        }
      : editor.archive
        ? {
            expected_revision: editor.revision,
            reason: values.reason,
            archive: true,
          }
        : {
            ...values,
            expected_revision: editor.revision,
            ...(editor.kind === "shift"
              ? { tolerance: Number(values.tolerance) }
              : {}),
          };
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        editor.remove
          ? "/api/catalogs/associations"
          : `/api/catalogs/${editor.kind}/${encodeURIComponent(editor.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await load();
      await onChange();
      setEditor(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="catalogs">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <fieldset disabled={busy}>
        <p className="catalog-note">
          Archivar conserva el historial. Las planificaciones y preparaciones ya
          guardadas mantienen sus datos originales.
        </p>
        {kinds.map((kind) => (
          <section key={kind}>
            <h3>{labels[kind]}</h3>
            {!(data.catalogs[kind] || []).length && <p>No hay registros.</p>}
            {(data.catalogs[kind] || []).map((row: Row) => (
              <article className="catalog-row" key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <small>
                    {row.archived ? "Archivado" : "Activo"} · revisión{" "}
                    {row.revision}
                    {kind === "shift"
                      ? ` · ${row.start}–${row.end} · tolerancia ${row.tolerance} min`
                      : kind === "holiday"
                        ? ` · ${row.day}`
                        : ""}
                  </small>
                  {["sector", "tag"].includes(kind) && (
                    <div className="catalog-associations">
                      {data.associations
                        .filter((a: Row) => a.tag_id === row.id)
                        .map((a: Row) => (
                          <span key={a.employee_id}>
                            {employees.find((e) => e.id === a.employee_id)
                              ?.name || "Empleado"}
                            {!supervisor && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  setEditor({
                                    ...a,
                                    remove: true,
                                    id: row.id + "-" + a.employee_id,
                                    name: row.name,
                                  })
                                }
                              >
                                Quitar asociación
                              </button>
                            )}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
                {!supervisor && !row.archived && (
                  <div className="catalog-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditor(row)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditor({ ...row, archive: true })}
                    >
                      Archivar
                    </button>
                  </div>
                )}
              </article>
            ))}
          </section>
        ))}
        {editor && (
          <form
            key={`${editor.id}-${editor.archive}-${editor.remove}`}
            className="catalog-editor"
            onSubmit={submit}
          >
            <h3>
              {editor.remove
                ? "Quitar asociación"
                : editor.archive
                  ? "Archivar"
                  : "Editar"}{" "}
              · {editor.name}
            </h3>
            {!editor.archive && !editor.remove && (
              <>
                <label>
                  Nombre
                  <input
                    name="name"
                    defaultValue={editor.name}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
                {editor.kind === "holiday" && (
                  <label>
                    Fecha
                    <input
                      name="day"
                      type="date"
                      defaultValue={editor.day}
                      required
                    />
                    <small>
                      Cambiar la fecha archiva el registro anterior y crea otro.
                      No reemplaza fechas ya existentes.
                    </small>
                  </label>
                )}
                {editor.kind === "shift" && (
                  <>
                    <label>
                      Entrada
                      <input
                        name="start"
                        type="time"
                        defaultValue={editor.start}
                        required
                      />
                    </label>
                    <label>
                      Salida
                      <input
                        name="end"
                        type="time"
                        defaultValue={editor.end}
                        required
                      />
                    </label>
                    <label>
                      Tolerancia (minutos)
                      <input
                        name="tolerance"
                        type="number"
                        min={0}
                        max={120}
                        defaultValue={editor.tolerance}
                        required
                      />
                    </label>
                  </>
                )}
              </>
            )}
            <label>
              Motivo
              <input name="reason" required minLength={5} maxLength={1000} />
            </label>
            <div className="catalog-actions">
              <button className="primary">Confirmar cambio</button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditor(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </fieldset>
    </section>
  );
}
