import type { Express } from "express";
import type { Store } from "./store";
import type { WorkerLifecycle } from "./lifecycle";
export function installHealth(app: Express, s: Store, worker: WorkerLifecycle) {
  app.get("/health/live", (_req, res) => res.json({ status: "live" }));
  app.get("/health/ready", (_req, res) => {
    let ready = worker.ready();
    try {
      s.db.prepare("SELECT 1").get();
    } catch {
      ready = false;
    }
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ready" : "not_ready" });
  });
}
