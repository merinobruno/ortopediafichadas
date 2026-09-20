import { useState, useEffect, type FormEvent } from "react";
type Row = Record<string, any>;
const types: Row = {
  circular: "Circular",
  notification: "Notificación",
  warning: "Apercibimiento",
  memo: "Memorándum",
  request: "Solicitud",
  other: "Otro",
};
const initial = {
  name: "",
  description: "",
  type: "circular",
  order: 0,
  subject: "",
  body: "",
  variables: ["nombre"],
  requires_signature: false,
  channel: "whatsapp",
  selection: {
    mode: "all",
    employee_ids: [] as string[],
    sector_id: null as string | null,
  },
  template_id: null,
  template_revision: null,
};
async function api(path: string, body?: unknown) {
  const r = await fetch(
    "/api/communications" + path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok)
    throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}
export default function Communications({ employees }: { employees: Row[] }) {
  const [data, setData] = useState<Row>({ templates: [], campaigns: [] }),
    [tab, setTab] = useState("drafts"),
    [form, setForm] = useState<Row | null>(null),
    [preview, setPreview] = useState<Row | null>(null),
    [frozen, setFrozen] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Row[]>([]),
    [onboarding, setOnboarding] = useState<Row | null>(null),
    [person, setPerson] = useState("");
  const sectors = data.sectors || [];
  const load = async () => setData(await api(""));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const change = (key: string, value: any) => {
    setForm((f) => ({ ...f, [key]: value }));
    setPreview(null);
    setFrozen(false);
  };
  const open = (row?: Row) => {
    setForm(
      row
        ? {
            ...initial,
            ...row.document,
            id: row.id,
            expected_revision: row.revision,
          }
        : { ...initial, selection: { ...initial.selection } },
    );
    setPreview(null);
    setHistory([]);
    setNotice("");
    setError("");
  };
  const switchTab = (value: string) => {
    setTab(value);
    setForm(null);
    setPreview(null);
    setHistory([]);
    setError("");
    setNotice("");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    await run(async () => {
      const {
        name,
        description,
        order,
        channel,
        selection,
        template_id,
        template_revision,
        ...common
      } = form;
      common.variables = common.variables
        .map((v: string) => v.trim())
        .filter(Boolean);
      const saved = await api(
        tab === "templates" ? "/templates" : "/drafts",
        tab === "templates"
          ? { ...common, name, description, order }
          : { ...common, channel, selection, template_id, template_revision },
      );
      setForm({ ...form, id: saved.id, expected_revision: saved.revision });
      await load();
      if (tab === "drafts") {
        setPreview(await api("/drafts/" + saved.id + "/preview"));
        setFrozen(false);
      }
      setNotice(
        tab === "templates"
          ? "Revisión local guardada."
          : "Borrador guardado. La vista previa no envía mensajes.",
      );
    });
  };
  return (
    <fieldset
      className="communications comm-operation"
      disabled={busy}
      aria-busy={busy}
      aria-label="Comunicaciones locales"
    >
      <div className="info-line">
        Preparación local · Los canales y la firma son intenciones del borrador.
        No hay envío, aprobación de Meta ni firma habilitados.
      </div>
      <div className="comm-tabs" role="tablist" aria-label="Comunicaciones">
        {[
          ["drafts", "Borradores"],
          ["templates", "Plantillas locales"],
          ["onboarding", "Instrucciones de fichada"],
        ].map(([id, label]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            className={tab === id ? "primary" : "secondary"}
            onClick={() => switchTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="info-line">
          {notice}
        </p>
      )}
      {tab === "onboarding" ? (
        <section className="panel comm-panel">
          <h2>Preparar instrucciones para un empleado</h2>
          <p>
            Vista previa para RRHH. No envía invitaciones ni verifica identidad,
            DNI, términos o firma.
          </p>
          <label>
            Empleado activo
            <select
              value={person}
              onChange={(e) => {
                setPerson(e.target.value);
                setOnboarding(null);
              }}
            >
              <option value="">Seleccionar</option>
              {employees
                .filter((e) => e.active)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={!person || busy}
            onClick={() =>
              void run(async () =>
                setOnboarding(await api("/onboarding/" + person)),
              )
            }
          >
            Ver instrucciones
          </button>
          {onboarding && (
            <>
              <p>
                {onboarding.bot_number
                  ? "Número público configurado: +" + onboarding.bot_number
                  : "Número público pendiente de configuración por el operador."}
              </p>
              <pre className="comm-preview">{onboarding.text}</pre>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="panel comm-panel">
            <div className="section-heading">
              <div>
                <h2>
                  {tab === "templates"
                    ? "Biblioteca de plantillas"
                    : "Comunicaciones en preparación"}
                </h2>
                <p>
                  {tab === "templates"
                    ? "Cada guardado conserva una revisión inmutable. Son plantillas locales, no plantillas aprobadas por Meta."
                    : "Preparar congela destinatarios y textos. Nunca autoriza ni ejecuta un envío."}
                </p>
              </div>
              <button className="primary" onClick={() => open()}>
                Crear {tab === "templates" ? "plantilla" : "borrador"}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tab === "templates" ? "Nombre" : "Asunto"}</th>
                    <th>Tipo / revisión</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === "templates" ? data.templates : data.campaigns).map(
                    (x: Row) => (
                      <tr key={x.id}>
                        <td>
                          {tab === "templates"
                            ? x.document.name
                            : x.document.subject}
                        </td>
                        <td>
                          {types[x.document.type]} · v{x.revision}
                        </td>
                        <td>
                          {tab === "templates"
                            ? x.archived
                              ? "Archivada"
                              : "Activa"
                            : x.status === "prepared"
                              ? "Preparada · sin envío"
                              : "Borrador"}
                        </td>
                        <td>
                          <div className="comm-actions">
                            <button
                              className="secondary"
                              onClick={() => open(x)}
                            >
                              Editar
                            </button>
                            {tab === "templates" ? (
                              <>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await api(
                                        "/templates/" + x.id + "/archive",
                                        { archived: !x.archived },
                                      );
                                      await load();
                                    })
                                  }
                                >
                                  {x.archived ? "Restaurar" : "Archivar"}
                                </button>
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    void run(async () =>
                                      setHistory(
                                        await api(
                                          "/templates/" + x.id + "/revisions",
                                        ),
                                      ),
                                    )
                                  }
                                >
                                  Revisiones
                                </button>
                              </>
                            ) : (
                              x.preparation_id && (
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    void run(async () => {
                                      const rows = await api(
                                        "/drafts/" + x.id + "/preparations",
                                      );
                                      setPreview(
                                        rows.find(
                                          (r: Row) => r.id === x.preparation_id,
                                        ).snapshot,
                                      );
                                      setFrozen(true);
                                      setForm(null);
                                    })
                                  }
                                >
                                  Ver preparación
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {(tab === "templates" ? data.templates : data.campaigns).length ===
              0 && (
              <p className="empty">
                Todavía no hay{" "}
                {tab === "templates" ? "plantillas" : "borradores"}.
              </p>
            )}
          </section>
          {history.length > 0 && (
            <section className="panel comm-panel">
              <h2>Revisiones conservadas</h2>
              {history.map((x) => (
                <details key={x.revision}>
                  <summary>
                    v{x.revision} · {x.document.name} · {x.actor}
                  </summary>
                  <p>{x.document.subject}</p>
                  <pre className="comm-preview">{x.document.body}</pre>
                </details>
              ))}
            </section>
          )}
          {form && (
            <form className="panel comm-panel" onSubmit={save}>
              <h2>
                {form.id ? "Editar" : "Crear"}{" "}
                {tab === "templates" ? "plantilla local" : "borrador"}
              </h2>
              <p>
                Texto simple. HTML pegado se muestra literalmente, sin
                ejecutarse. Editar un borrador invalida su preparación actual;
                las anteriores se conservan.
              </p>
              <div className="comm-grid">
                {tab === "templates" ? (
                  <>
                    <label>
                      Nombre
                      <input
                        required
                        minLength={2}
                        maxLength={100}
                        value={form.name}
                        onChange={(e) => change("name", e.target.value)}
                      />
                    </label>
                    <label>
                      Orden
                      <input
                        type="number"
                        min={0}
                        max={9999}
                        value={form.order}
                        onChange={(e) =>
                          change("order", Number(e.target.value))
                        }
                      />
                    </label>
                    <label className="wide">
                      Descripción
                      <input
                        maxLength={500}
                        value={form.description}
                        onChange={(e) => change("description", e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Partir de una plantilla
                      <select
                        value={form.template_id || ""}
                        onChange={(e) => {
                          const t = data.templates.find(
                            (x: Row) => x.id === e.target.value,
                          );
                          if (t) {
                            const { name, description, order, ...document } =
                              t.document;
                            setForm({
                              ...form,
                              ...document,
                              template_id: t.id,
                              template_revision: t.revision,
                            });
                            setPreview(null);
                          } else {
                            setForm({
                              ...form,
                              template_id: null,
                              template_revision: null,
                            });
                            setPreview(null);
                          }
                        }}
                      >
                        <option value="">Texto propio</option>
                        {data.templates
                          .filter((x: Row) => !x.archived)
                          .map((x: Row) => (
                            <option key={x.id} value={x.id}>
                              {x.document.name} · v{x.revision}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Canal previsto
                      <select
                        value={form.channel}
                        onChange={(e) => change("channel", e.target.value)}
                      >
                        <option value="whatsapp">WhatsApp · pendiente</option>
                        <option value="email">Email · pendiente</option>
                        <option value="both">Ambos · pendientes</option>
                      </select>
                    </label>
                  </>
                )}
                <label>
                  Tipo
                  <select
                    value={form.type}
                    onChange={(e) => change("type", e.target.value)}
                  >
                    {Object.entries(types).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="comm-check">
                  <input
                    type="checkbox"
                    checked={form.requires_signature}
                    onChange={(e) =>
                      change("requires_signature", e.target.checked)
                    }
                  />
                  Requiere firma (intención; sin integración)
                </label>
                <label className="wide">
                  Asunto
                  <input
                    required
                    maxLength={200}
                    value={form.subject}
                    onChange={(e) => change("subject", e.target.value)}
                  />
                </label>
                <label className="wide">
                  Contenido de texto
                  <textarea
                    required
                    maxLength={20000}
                    rows={7}
                    value={form.body}
                    onChange={(e) => change("body", e.target.value)}
                  />
                </label>
                <label className="wide">
                  Variables declaradas, separadas por comas
                  <input
                    value={form.variables.join(", ")}
                    onChange={(e) =>
                      change(
                        "variables",
                        e.target.value
                          .split(",")
                          .map((v: string) => v.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                  <small>
                    Disponibles: nombre, telefono, sedes, empresa, fecha.
                    Ejemplo: {"Hola {{nombre}}"}.
                  </small>
                </label>
                {tab === "drafts" && (
                  <fieldset className="wide">
                    <legend>Destinatarios</legend>
                    <label>
                      Selección
                      <select
                        value={form.selection.mode}
                        onChange={(e) =>
                          change("selection", {
                            mode: e.target.value,
                            employee_ids: [],
                            sector_id: null,
                          })
                        }
                      >
                        <option value="all">Todos los empleados activos</option>
                        <option value="sector">Por sector</option>
                        <option value="individual">Selección individual</option>
                      </select>
                    </label>
                    {form.selection.mode === "sector" && (
                      <label>
                        Sector
                        <select
                          required
                          value={form.selection.sector_id || ""}
                          onChange={(e) =>
                            change("selection", {
                              ...form.selection,
                              sector_id: e.target.value,
                            })
                          }
                        >
                          <option value="">Seleccionar sector</option>
                          {sectors.map((x: Row) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {form.selection.mode === "individual" && (
                      <div className="comm-recipient-list">
                        {employees
                          .filter((e) => e.active)
                          .map((e) => (
                            <label className="comm-check" key={e.id}>
                              <input
                                type="checkbox"
                                checked={form.selection.employee_ids.includes(
                                  e.id,
                                )}
                                onChange={(event) =>
                                  change("selection", {
                                    ...form.selection,
                                    employee_ids: event.target.checked
                                      ? [...form.selection.employee_ids, e.id]
                                      : form.selection.employee_ids.filter(
                                          (id: string) => id !== e.id,
                                        ),
                                  })
                                }
                              />
                              {e.name}
                            </label>
                          ))}
                      </div>
                    )}
                  </fieldset>
                )}
              </div>
              <div className="comm-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setForm(null)}
                >
                  Cerrar editor
                </button>
                <button className="primary" disabled={busy}>
                  {tab === "templates"
                    ? "Guardar nueva revisión"
                    : "Guardar y ver destinatarios"}
                </button>
              </div>
            </form>
          )}
          {preview && (
            <section className="panel comm-panel">
              <h2>
                {frozen
                  ? "Preparación conservada · sin envío"
                  : "Vista previa de destinatarios"}
              </h2>
              <p>
                {preview.recipients.length} destinatarios únicos · revisión{" "}
                {preview.revision} · {preview.channel} ·{" "}
                {preview.requires_signature
                  ? "Firma prevista, no habilitada"
                  : "Sin firma prevista"}
              </p>
              {!frozen && form?.id && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api(
                        "/drafts/" + form.id + "/prepare",
                        { expected_revision: form.expected_revision },
                      );
                      const rows = await api(
                        "/drafts/" + form.id + "/preparations",
                      );
                      setPreview(
                        rows.find((r: Row) => r.id === result.id).snapshot,
                      );
                      setFrozen(true);
                      await load();
                      setNotice(
                        "Preparación guardada. No se envió ningún mensaje.",
                      );
                    })
                  }
                >
                  Preparar sin enviar
                </button>
              )}
              <p>
                {frozen
                  ? "Los nombres, teléfonos y textos corresponden al momento de preparación. No se actualizan al modificar empleados."
                  : "Revisá la selección antes de conservar una preparación. No se envían mensajes."}
              </p>
              {preview.recipients.map((r: Row) => (
                <details key={r.employee_id}>
                  <summary>
                    {r.name} · +{r.phone}
                  </summary>
                  <h3>{r.subject}</h3>
                  <pre className="comm-preview">{r.body}</pre>
                </details>
              ))}
            </section>
          )}
        </>
      )}
    </fieldset>
  );
}
