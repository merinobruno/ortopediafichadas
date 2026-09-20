import { parentPort, workerData } from "node:worker_threads";
import { renderXlsx, renderPdf } from "./report-renderers.mjs";
try {
  const bytes = await (workerData.format === "xlsx"
    ? renderXlsx(workerData.snapshot)
    : renderPdf(workerData.snapshot, workerData.maxBytes));
  if (bytes.length > workerData.maxBytes)
    throw Object.assign(
      new Error("El archivo supera 20 MiB. Reducí los filtros."),
      { status: 413 },
    );
  parentPort.postMessage({ ok: true, bytes });
} catch (e) {
  parentPort.postMessage({
    ok: false,
    status: [413, 422].includes(e.status) ? e.status : 503,
    error: [413, 422].includes(e.status)
      ? e.message
      : "No se pudo generar el reporte dentro de los límites.",
  });
}
