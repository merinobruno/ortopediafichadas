import { parentPort, workerData } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";
try {
  const pdf = await PDFDocument.load(new Uint8Array(workerData.bytes), {
    ignoreEncryption: false,
    throwOnInvalidObject: true,
    updateMetadata: false,
  });
  const pages = pdf.getPageCount();
  if (pdf.isEncrypted || pages < 1 || pages > 40)
    throw new Error("Invalid PDF");
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      throw new Error("Invalid page");
  }
  parentPort.postMessage({ ok: true, pages });
} catch {
  parentPort.postMessage({ ok: false });
}
