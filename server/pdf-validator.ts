import { Worker } from "node:worker_threads";
export class ReceiptError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
let active = 0;
export function validatePdf(bytes: Buffer): Promise<{ pages: number }> {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    return Promise.reject(
      new ReceiptError("El PDF debe ocupar hasta 5 MiB.", 413),
    );
  if (active >= 2)
    return Promise.reject(
      new ReceiptError(
        "Hay dos validaciones en curso. Intentá nuevamente.",
        503,
      ),
    );
  active++;
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: Worker;
    let timer: ReturnType<typeof setTimeout>;
    const finish = async (error: Error | null, value?: { pages: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await worker?.terminate();
      } finally {
        active--;
        error ? reject(error) : resolve(value!);
      }
    };
    try {
      worker = new Worker(
        new URL("./pdf-validator-worker.mjs", import.meta.url),
        {
          workerData: { bytes },
          resourceLimits: {
            maxOldGenerationSizeMb: 128,
            maxYoungGenerationSizeMb: 16,
            stackSizeMb: 4,
          },
        },
      );
      timer = setTimeout(
        () =>
          void finish(
            new ReceiptError("El PDF excedió el tiempo de validación."),
          ),
        5000,
      );
      worker.on(
        "message",
        (v) =>
          void finish(
            v?.ok && Number.isInteger(v.pages)
              ? null
              : new ReceiptError(
                  "PDF inválido, cifrado o con más de 40 páginas.",
                ),
            v?.ok ? { pages: v.pages } : undefined,
          ),
      );
      worker.on(
        "error",
        () =>
          void finish(
            new ReceiptError(
              "No se pudo validar el PDF dentro de los límites.",
            ),
          ),
      );
      worker.on("exit", () => {
        if (!settled)
          void finish(
            new ReceiptError("La validación del PDF se interrumpió."),
          );
      });
    } catch {
      void finish(new ReceiptError("No se pudo iniciar la validación.", 503));
    }
  });
}
