import { frontendFiles } from "./dev-files";
import { processExceptions } from "./attendance-exceptions";
import express from "express";
import { Store } from "./store";
import { createApp } from "./app";
import { seed } from "./seed";
import { processTelegramInbox, sendTelegramOutbox } from "./telegram";
import { readConfig, prepareDatabasePath } from "./config";
import { WorkerLifecycle } from "./lifecycle";
import { installHealth } from "./health";
const config = readConfig();
const s = new Store(prepareDatabasePath(config.database));
if (
  s.one("SELECT value FROM runtime_state WHERE key='recovery_required'")
    ?.value === "1"
) {
  s.db.close();
  throw new Error(
    "Restored database requires offline recovery acknowledgement before startup",
  );
}
if (config.demo) seed(s);
if (!process.env.ADMIN_PASSWORD)
  process.env.ADMIN_PASSWORD = "Carahue-demo-2026";
const worker = new WorkerLifecycle(async () => {
  processTelegramInbox(s);
  processExceptions(s);
  await sendTelegramOutbox(
    s,
    fetch,
    process.env,
    Date.now,
    () => worker.draining,
  );
});
const app = express();
installHealth(app, s, worker);
app.use((_req, res, next) =>
  worker.draining
    ? res.status(503).json({ error: "Service draining" })
    : next(),
);
app.use(createApp(s));
let vite: { close: () => Promise<void> } | undefined;
if (config.production) {
  app.use(express.static("dist-legacy"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile("index.html", { root: "dist-legacy" }),
  );
} else {
  const { createServer } = await import("vite");
  const dev = await createServer({
    mode: "legacy",
    server: { middlewareMode: true },
    appType: "spa",
  });
  vite = dev;
  app.use(frontendFiles(process.cwd(), config.database));
  app.use(dev.middlewares);
}
s.db
  .prepare(
    "UPDATE telegram_outbox SET status='uncertain',reason_code='interrupted_send' WHERE status='sending'",
  )
  .run();
const timer = setInterval(() => {
  void worker
    .tick()
    .catch(() =>
      console.error(
        "Message worker failed; queued messages preserved for review.",
      ),
    );
}, 2000);
const server = app.listen(config.port, config.host, () =>
  console.log(`Carahue available at http://${config.host}:${config.port}`),
);
let shutdown: Promise<void> | undefined;
function stop() {
  if (shutdown) return shutdown;
  clearInterval(timer);
  const drained = worker.drain();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  shutdown = (async () => {
    await Promise.allSettled([drained, closed]);
    await vite?.close();
    s.db.close();
  })();
  return shutdown;
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void stop().catch(() => {
      console.error("Shutdown failed");
      process.exitCode = 1;
    });
  });
