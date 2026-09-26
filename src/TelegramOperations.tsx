import { useEffect, useState, type FormEvent } from "react";
const labels: Record<string, string> = {
  pending: "Pendiente",
  processed: "Procesado",
  rejected: "Rechazado",
  queued: "En cola",
  sending: "Enviando",
  accepted: "Aceptado por proveedor",
  failed: "Fallido",
  expired: "Ventana vencida",
  uncertain: "Resultado incierto",
  sent: "Enviado por proveedor",
  delivered: "Entregado",
  read: "Leído",
  recovery_hold: "Cuarentena de recuperación",
  unreviewed: "Sin revisar",
  reviewed: "Revisado",
  dismissed: "Apartado de revisión",
};
const time = (v: string) =>
  v
    ? new Date(v).toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hourCycle: "h23",
      })
    : "No registrado";
export default function TelegramOperations({
  onLockChange,
}: {
  onLockChange: (locked: boolean) => void;
}) {
  const [lane, setLane] = useState("inbox"),
    [status, setStatus] = useState(""),
    [review, setReview] = useState(""),
    [data, setData] = useState<any>({ rows: [], nextCursor: null }),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<any>(null);
  const [cursor, setCursor] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    onLockChange(busy || Boolean(editor));
    return () => onLockChange(false);
  }, [busy, editor, onLockChange]);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const q = new URLSearchParams({ lane });
    if (status) q.set("status", status);
    if (review) q.set("review", review);
    if (cursor) q.set("cursor", cursor);
    fetch("/api/telegram-operations?" + q, { signal: controller.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        return b;
      })
      .then((b) => {
        if (!controller.signal.aborted) setData(b);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [lane, status, review, cursor, refresh]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/telegram-operations/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lane,
          id: editor.id,
          expectedRevision: editor.revision,
          state: form.get("state"),
          reason: form.get("reason"),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setData((d: any) => ({
        ...d,
        rows: d.rows.map((row: any) =>
          row.id === editor.id
            ? {
                ...row,
                revision: b.revision,
                review_state: b.state,
                review_actor: b.actor,
                review_reason: b.reason,
                reviewed_at: b.created_at,
              }
            : row,
        ),
      }));
      setEditor(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wa-operations">
      <section className="panel">
        <h2>Operación Telegram</h2>
        <p>
          Revisar o apartar un registro sólo agrega una anotación. No reenvía
          mensajes, modifica fichadas ni libera cuarentenas. Un resultado
          incierto requiere comprobación externa; no se reintenta desde aquí.
        </p>
        <fieldset disabled={busy || Boolean(editor)} className="wa-controls">
          <label>
            Cola
            <select
              value={lane}
              onChange={(e) => {
                setLane(e.target.value);
                setStatus("");
                setCursor("");
              }}
            >
              <option value="inbox">Recepción</option>
              <option value="outbox">Envío y entrega</option>
            </select>
          </label>
          <label>
            Estado
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setCursor("");
              }}
            >
              <option value="">Todos</option>
              {(lane === "inbox"
                ? ["pending", "processed", "rejected", "recovery_hold"]
                : [
                    "queued",
                    "sending",
                    "accepted",
                    "failed",
                    "expired",
                    "uncertain",
                    "sent",
                    "delivered",
                    "read",
                    "recovery_hold",
                  ]
              ).map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Revisión
            <select
              value={review}
              onChange={(e) => {
                setReview(e.target.value);
                setCursor("");
              }}
            >
              <option value="">Todas</option>
              {["unreviewed", "reviewed", "dismissed"].map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {busy && <p role="status">Consultando o guardando…</p>}
      </section>
      {editor && (
        <section className="panel">
          <h3>Anotar revisión</h3>
          <form key={lane + editor.id} onSubmit={save}>
            <fieldset disabled={busy} className="wa-controls">
              <label>
                Resultado
                <select name="state">
                  <option value="reviewed">Revisado</option>
                  <option value="dismissed">Apartado de revisión</option>
                </select>
              </label>
              <label>
                Motivo
                <input name="reason" required minLength={5} maxLength={500} />
              </label>
              <button className="primary">Guardar anotación</button>
              <button type="button" onClick={() => setEditor(null)}>
                Cancelar
              </button>
            </fieldset>
          </form>
        </section>
      )}
      <section className="panel">
        <p className="muted">
          Hasta 25 registros por página. Las fechas y el número de intentos son
          los almacenados; no hay historial individual de intentos ni
          confirmación de conexión en esta vista.
        </p>
        {data.rows.map((r: any) => (
          <article className="wa-record" key={r.id}>
            <div>
              <strong>{labels[r.status] || "Estado no reconocido"}</strong>
              <span className="badge">{labels[r.review_state]}</span>
            </div>
            <p>
              {r.employee_name || "Sin contexto de empleado disponible"} ·
              Creado: {time(r.created_at)}
            </p>
            <p className="muted">Referencia: {r.id}</p>
            {r.reason_code && <p>Código operativo: {r.reason_code}</p>}
            {lane === "outbox" && (
              <p>
                Intentos: {r.attempts} · Próximo intento:{" "}
                {time(r.next_attempt_at)} · Fin de ventana:{" "}
                {time(r.window_until)}
              </p>
            )}
            {r.review_actor && (
              <p>
                {r.review_reason} — {r.review_actor} · {time(r.reviewed_at)} ·
                revisión {r.revision}
              </p>
            )}
            <button
              disabled={busy || Boolean(editor)}
              onClick={() => setEditor(r)}
            >
              Anotar revisión
            </button>
          </article>
        ))}
        {!busy && !data.rows.length && (
          <p className="empty">No hay registros para estos filtros.</p>
        )}
        <div className="inline-actions">
          <button
            disabled={busy || Boolean(editor)}
            onClick={() => setRefresh((v) => v + 1)}
          >
            Actualizar
          </button>
          <button
            disabled={busy || Boolean(editor) || !cursor}
            onClick={() => setCursor("")}
          >
            Primera página
          </button>
          <button
            disabled={busy || Boolean(editor) || !data.nextCursor}
            onClick={() => setCursor(data.nextCursor)}
          >
            Siguiente página
          </button>
        </div>
      </section>
    </div>
  );
}
