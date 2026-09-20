import { copyFileSync } from "node:fs";
copyFileSync(
  "server/pdf-validator-worker.mjs",
  "build/pdf-validator-worker.mjs",
);
copyFileSync("server/report-worker.mjs", "build/report-worker.mjs");
copyFileSync("server/report-renderers.mjs", "build/report-renderers.mjs");
