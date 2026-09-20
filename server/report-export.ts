import { Worker } from "node:worker_threads";
export const REPORT_OUTPUT_LIMIT = 20 * 1024 * 1024;
export class ExportError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export class ExportPool {
  private accounts = new Set<string>();
  private active = 0;
  constructor(
    private workerUrl = new URL("./report-worker.mjs", import.meta.url),
    private timeout = 30000,
    private maxBytes = REPORT_OUTPUT_LIMIT,
  ) {}
  async render(
    snapshot: unknown,
    format: "pdf" | "xlsx",
    account: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (signal?.aborted) throw new ExportError("Exportación cancelada.", 499);
    if (this.accounts.has(account))
      throw new ExportError("Ya tenés una exportación en curso.", 429);
    if (this.active >= 2)
      throw new ExportError(
        "Hay dos exportaciones en curso. Intentá nuevamente.",
        503,
      );
    this.active++;
    this.accounts.add(account);
    return new Promise((resolve, reject) => {
      let settled = false,
        worker: Worker | undefined,
        timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () =>
        void finish(new ExportError("Exportación cancelada.", 499));
      const finish = async (error: Error | null, bytes?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        try {
          await worker?.terminate();
        } finally {
          this.active--;
          this.accounts.delete(account);
          error ? reject(error) : resolve(bytes!);
        }
      };
      try {
        worker = new Worker(this.workerUrl, {
          workerData: { snapshot, format, maxBytes: this.maxBytes },
          resourceLimits: {
            maxOldGenerationSizeMb: 256,
            maxYoungGenerationSizeMb: 32,
            stackSizeMb: 4,
          },
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        timer = setTimeout(
          () =>
            void finish(
              new ExportError(
                "La exportación excedió 30 segundos. Reducí los filtros.",
                503,
              ),
            ),
          this.timeout,
        );
        worker.on("message", (message) => {
          if (!message?.ok) {
            void finish(
              new ExportError(
                message?.error || "No se pudo generar el archivo.",
                message?.status || 503,
              ),
            );
            return;
          }
          const bytes = Buffer.from(message.bytes);
          void finish(
            bytes.length > this.maxBytes
              ? new ExportError(
                  "El archivo supera 20 MiB. Reducí los filtros.",
                  413,
                )
              : null,
            bytes,
          );
        });
        worker.on(
          "error",
          () =>
            void finish(
              new ExportError("La generación excedió los límites del proceso."),
            ),
        );
        worker.on("exit", () => {
          if (!settled)
            void finish(new ExportError("La generación se interrumpió."));
        });
      } catch {
        void finish(new ExportError("No se pudo iniciar la exportación."));
      }
    });
  }
}
const pool = new ExportPool();
export const renderReportFile = (
  snapshot: unknown,
  format: "pdf" | "xlsx",
  account: string,
  signal?: AbortSignal,
) => pool.render(snapshot, format, account, signal);
