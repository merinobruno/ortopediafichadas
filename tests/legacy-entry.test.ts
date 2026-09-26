import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "vite";

async function bundledModules(mode: string) {
  const output = await build({ mode, build: { write: false } });
  const chunks = (Array.isArray(output) ? output : [output])
    .flatMap((result) => ("output" in result ? result.output : []))
    .filter((asset) => asset.type === "chunk");
  return new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)));
}

test("actual cloud and legacy builds bundle only their intended app entry", async () => {
  const cloud = await bundledModules("production");
  const legacy = await bundledModules("legacy");
  const includes = (modules: Set<string>, path: string) =>
    [...modules].some((id) => id.replaceAll("\\", "/").endsWith(path));
  assert.ok(includes(cloud, "/src/main.tsx"));
  assert.ok(includes(cloud, "/src/BasicApp.tsx"));
  assert.equal(includes(cloud, "/src/App.tsx"), false);
  assert.ok(includes(legacy, "/src/legacy-main.tsx"));
  assert.ok(includes(legacy, "/src/App.tsx"));
  assert.equal(includes(legacy, "/src/BasicApp.tsx"), false);
});
