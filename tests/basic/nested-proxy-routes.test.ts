import { afterEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import issueRoute from "../../api/employees/link-code";
import revokeRoute from "../../api/employees/revoke-link";
import operationsRoute from "../../api/[...path]";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ["/api/employees/link-code", issueRoute],
  ["/api/employees/revoke-link", revokeRoute],
] as const)(
  "serves nested route %s through the authenticated proxy",
  async (path, route) => {
    vi.stubEnv("APP_ORIGIN", "https://attendance.example");
    vi.stubEnv("CONVEX_SITE_URL", "https://deployment.convex.site");
    vi.stubEnv("PROXY_SECRET", "private-proxy-secret");
    const upstream = vi.fn(async (request: Request) => {
      expect(request.url).toBe(`https://deployment.convex.site${path}`);
      expect(request.method).toBe("POST");
      expect(request.headers.get("cookie")).toBe(
        "attendance_session=test-session",
      );
      expect(request.headers.get("x-proxy-secret")).toBe(
        "private-proxy-secret",
      );
      expect(await request.json()).toEqual({ employeeId: "employee-id" });
      return Response.json({ code: "TESTCODE23" });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await route.fetch(
      new Request(`https://attendance.example${path}`, {
        method: "POST",
        headers: {
          origin: "https://attendance.example",
          cookie: "attendance_session=test-session",
        },
        body: JSON.stringify({ employeeId: "employee-id" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "TESTCODE23" });
    expect(upstream).toHaveBeenCalledOnce();
    const rejected = await route.fetch(
      new Request(`https://attendance.example${path}`, {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
        body: "{}",
      }),
    );
    expect(rejected.status).toBe(403);
    expect(upstream).toHaveBeenCalledOnce();
  },
);

it("keeps the existing one-segment Telegram operations route", async () => {
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  vi.stubEnv("CONVEX_SITE_URL", "https://deployment.convex.site");
  vi.stubEnv("PROXY_SECRET", "private-proxy-secret");
  const upstream = vi.fn(async () =>
    Response.json({ inbound: [], outbound: [] }),
  );
  vi.stubGlobal("fetch", upstream);

  const response = await operationsRoute.fetch(
    new Request("https://attendance.example/api/telegram-operations"),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ inbound: [], outbound: [] });
  expect(upstream).toHaveBeenCalledOnce();
});

it("loads emitted nested functions with native Node ESM resolution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "attendance-routes-"));
  try {
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    await build({
      entryPoints: [
        "api/[...path].ts",
        "api/employees/link-code.ts",
        "api/employees/revoke-link.ts",
      ],
      outbase: "api",
      outdir: directory,
      bundle: false,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    for (const name of ["link-code", "revoke-link"]) {
      const url = pathToFileURL(join(directory, "employees", `${name}.js`));
      execFileSync(process.execPath, [
        "--input-type=module",
        "-e",
        "const route = await import(process.argv[1]); if (typeof route.default?.fetch !== 'function') process.exit(1)",
        url.href,
      ]);
    }
  } finally {
    const tempRoot = realpathSync(tmpdir());
    const target = realpathSync(directory);
    if (!target.startsWith(`${tempRoot}${sep}`))
      throw new Error("Unexpected temporary directory");
    rmSync(target, { recursive: true, force: true });
  }
});
