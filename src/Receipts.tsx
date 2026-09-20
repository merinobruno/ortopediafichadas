import { useEffect, useState } from "react";
type Row = Record<string, any>;
const liquidation: Row = {
  monthly: "Mensual",
  first_half: "Primera quincena",
  second_half: "Segunda quincena",
  sac_first: "SAC · primer semestre",
  sac_second: "SAC · segundo semestre",
  sac_proportional: "SAC proporcional",
  vacation: "Vacaciones",
  final: "Liquidación final",
  other: "Otro",
};
async function api(path: string, body?: unknown) {
  const r = await fetch(
    "/api/receipts" + path,
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
export default function Receipts({ employees }: { employees: Row[] }) {
  const [data, setData] = useState<Row>({ batches: [], totalBytes: 0 }),
    [selected, setSelected] = useState<Row | null>(null),
    [documents, setDocuments] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [assignment, setAssignment] = useState<Row | null>(null),
    [archive, setArchive] = useState(false);
  const load = async () => setData(await api("/batches"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const open = async (b: Row) => {
    await run(async () => {
      const docs = await api("/batches/" + b.id + "/documents");
      setSelected(b);
      setDocuments(docs);
      setAssignment(null);
      setArchive(false);
    });
  };
  return (
    <div className="receipts">
      <div className="notice">
        <strong>Archivo privado de RRHH</strong>
        <p>
          Los documentos quedan en preparación. No se publican, envían ni
          firman. Cada PDF debe corresponder a una sola persona; la asignación
          es manual.
        </p>
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
      <fieldset disabled={busy} className="receipt-fieldset">
        <section className="panel">
          <div className="panel-heading">
            <h2>Nuevo lote</h2>
            <span>
              {(data.totalBytes / 1048576).toFixed(1)} / 256 MiB utilizados
            </span>
          </div>
          <form
            className="receipt-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              const values = new FormData(f);
              void run(async () => {
                await api("/batches", Object.fromEntries(values));
                f.reset();
                setNotice("Lote privado creado.");
              });
            }}
          >
            <label>
              Nombre del lote
              <input
                name="title"
                required
                minLength={2}
                maxLength={120}
                placeholder="Ej.: Septiembre · equipo"
              />
            </label>
            <label>
              Período
              <input name="period" type="month" required />
            </label>
            <label>
              Liquidación
              <select name="liquidation">
                {Object.entries(liquidation).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary">Crear lote</button>
          </form>
        </section>
        <div className="receipt-layout">
          <section className="panel">
            <div className="panel-heading">
              <h2>Lotes privados</h2>
            </div>
            {!data.batches.length && (
              <p className="empty">Creá un lote para cargar documentos.</p>
            )}
            {data.batches.map((b: Row) => (
              <button
                key={b.id}
                type="button"
                className={
                  "receipt-batch " + (selected?.id === b.id ? "selected" : "")
                }
                onClick={() => void open(b)}
              >
                <strong>{b.title}</strong>
                <span>
                  {b.period} · {liquidation[b.liquidation]}
                </span>
                <small>
                  {b.documents} PDF ·{" "}
                  {b.status === "archived" ? "Archivado" : "En preparación"}
                </small>
              </button>
            ))}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>{selected?.title || "Elegí un lote"}</h2>
            </div>
            {selected && (
              <>
                <p>
                  {selected.period} · {liquidation[selected.liquidation]} ·{" "}
                  {selected.status === "archived"
                    ? "Archivado: conserva los documentos, sin cambios."
                    : "En preparación privada"}
                </p>
                {selected.status === "draft" && (
                  <>
                    <form
                      className="receipt-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = e.currentTarget;
                        const file = (
                          f.elements.namedItem("pdf") as HTMLInputElement
                        ).files?.[0];
                        if (!file) return;
                        void run(async () => {
                          if (file.size > 5 * 1048576)
                            throw new Error("El PDF debe ocupar hasta 5 MiB.");
                          const r = await fetch(
                            "/api/receipts/batches/" +
                              selected.id +
                              "/documents",
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/pdf",
                                "X-Filename": encodeURIComponent(file.name),
                              },
                              body: file,
                            },
                          );
                          const result = await r.json();
                          if (!r.ok) throw new Error(result.error);
                          setDocuments(
                            await api("/batches/" + selected.id + "/documents"),
                          );
                          f.reset();
                          setNotice(
                            "PDF guardado de forma privada. Asigná la persona correspondiente.",
                          );
                        });
                      }}
                    >
                      <label>
                        Documento PDF
                        <input
                          name="pdf"
                          type="file"
                          accept="application/pdf,.pdf"
                          required
                        />
                        <small>
                          Hasta 5 MiB y 40 páginas por PDF. Hasta 20 archivos /
                          50 MiB por lote. No admite PDF cifrados ni ZIP.
                        </small>
                      </label>
                      <button className="btn primary">Cargar PDF</button>
                    </form>
                    <p className="muted">
                      La validación de estructura no elimina contenido activo.
                      Descargá y abrí solamente documentos de confianza.
                    </p>
                  </>
                )}
                {documents.map((d) => (
                  <article className="receipt-document" key={d.id}>
                    <strong>{d.filename}</strong>
                    <span>
                      {d.page_count} página(s) ·{" "}
                      {(d.byte_count / 1024).toFixed(1)} KiB
                    </span>
                    <p>
                      {employees.find((e) => e.id === d.employee_id)?.name ||
                        "Sin asignar"}{" "}
                      ·{" "}
                      {d.status === "staged"
                        ? "Preparado privado"
                        : "Necesita asignación"}
                    </p>
                    <div className="actions">
                      <a
                        className="btn"
                        href={"/api/receipts/documents/" + d.id + "/download"}
                      >
                        Descargar PDF
                      </a>
                      {selected.status === "draft" && (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setAssignment(d)}
                        >
                          Asignar persona
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!documents.length && (
                  <p className="empty">
                    Este lote todavía no tiene documentos.
                  </p>
                )}
                {assignment && (
                  <form
                    key={assignment.id}
                    className="receipt-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const values = Object.fromEntries(
                        new FormData(e.currentTarget),
                      );
                      void run(async () => {
                        await api(
                          "/documents/" + assignment.id + "/assignment",
                          values,
                        );
                        setDocuments(
                          await api("/batches/" + selected.id + "/documents"),
                        );
                        setAssignment(null);
                        setNotice("Asignación guardada y auditada.");
                      });
                    }}
                  >
                    <label>
                      Persona para {assignment.filename}
                      <select
                        name="employee_id"
                        required
                        defaultValue={assignment.employee_id || ""}
                      >
                        <option value="" disabled>
                          Seleccionar persona
                        </option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                            {!e.active ? " · inactiva" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Motivo de asignación
                      <input
                        name="reason"
                        required
                        minLength={5}
                        maxLength={1000}
                      />
                    </label>
                    <button className="btn primary">Guardar asignación</button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setAssignment(null)}
                    >
                      Cancelar
                    </button>
                  </form>
                )}
                {selected.status === "draft" && !archive && (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setArchive(true)}
                  >
                    Archivar lote
                  </button>
                )}
                {archive && (
                  <form
                    className="receipt-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const reason = new FormData(e.currentTarget).get(
                        "reason",
                      );
                      void run(async () => {
                        await api("/batches/" + selected.id + "/archive", {
                          reason,
                        });
                        setSelected({ ...selected, status: "archived" });
                        setArchive(false);
                        setAssignment(null);
                        setNotice(
                          "Lote archivado. Los PDF se conservan y siguen ocupando espacio.",
                        );
                      });
                    }}
                  >
                    <label>
                      Motivo de archivo
                      <input
                        name="reason"
                        required
                        minLength={5}
                        maxLength={1000}
                      />
                    </label>
                    <button className="btn primary">Confirmar archivo</button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setArchive(false)}
                    >
                      Cancelar
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </fieldset>
    </div>
  );
}
