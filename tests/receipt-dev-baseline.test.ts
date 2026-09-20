import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import express from "express";
import { frontendFiles } from "../server/dev-files";
test("development serves frontend but refuses private files via direct encoded and fs paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "carahue-vite-private-"));
  let dev;
  let server;
  try {
    for (const name of ["private", "src", "node_modules"])
      mkdirSync(join(root, name));
    writeFileSync(join(root, "index.html"), "<h1>Fixture</h1>");
    writeFileSync(join(root, "src", "main.js"), "export const fixture=true");
    const db = join(root, "src", "custom-private");
    for (const path of [
      db,
      db + "-wal",
      db + "-shm",
      join(root, "private", "backup.custom"),
    ])
      writeFileSync(path, "SYNTHETIC ONLY");
    dev = await createServer({
      configFile: false,
      root,
      server: { middlewareMode: true, hmr: false },
      logLevel: "silent",
    });
    const app = express();
    app.use(frontendFiles(root, db));
    app.use(dev.middlewares);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    for (const path of [
      "/private/backup.custom",
      "/src/custom-private",
      "/src/custom-private-wal",
      "/src/custom-private-shm",
      "/%70rivate/backup.custom",
      "/@fs/" + join(root, "private", "backup.custom").replaceAll("\\", "/"),
    ])
      assert.equal(
        (await fetch(base + path, { method: "HEAD" })).status,
        403,
        path,
      );
    assert.equal(
      (await fetch(base + "/src/main.js", { method: "HEAD" })).status,
      200,
    );
    assert.equal((await fetch(base + "/", { method: "HEAD" })).status, 200);
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await dev?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
