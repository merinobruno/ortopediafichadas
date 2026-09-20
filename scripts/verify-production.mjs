// Isolated runtime-only installation. Never uses the project's database or listening ports.
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
const root = resolve("."),
  fixture = mkdtempSync(join(tmpdir(), "carahue-production-"));
let child;
try {
  for (const file of ["package.json", "package-lock.json", "build", "dist"])
    cpSync(join(root, file), join(fixture, file), { recursive: true });
  const install = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--omit=dev", "--ignore-scripts"],
    { cwd: fixture, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (install.status !== 0) throw new Error("Runtime installation failed");
  if (
    existsSync(join(fixture, "node_modules", "vite")) ||
    existsSync(join(fixture, "node_modules", "tsx"))
  )
    throw new Error("Development dependencies present");
  const reserve = createServer();
  await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  let log = "";
  child = spawn(process.execPath, ["build/server.mjs"], {
    cwd: fixture,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_PATH: join(fixture, "nested", "db.sqlite"),
      DEMO_MODE: "false",
      ADMIN_PASSWORD: "Isolated-runtime-proof-123",
      WHATSAPP_SEND_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error("Production process exited");
    try {
      ready =
        (await fetch(`http://127.0.0.1:${port}/health/ready`)).status === 200;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("Production readiness timed out");
  const html = await (await fetch(`http://127.0.0.1:${port}`)).text();
  if (!html.includes("Personas y asistencia"))
    throw new Error("Wrong production HTML");
  if (log.includes("Isolated-runtime-proof-123"))
    throw new Error("Password leaked");
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "Isolated-runtime-proof-123" }),
  });
  const cookie = login.headers.get("set-cookie");
  if (login.status !== 200 || !cookie) throw new Error("Runtime login failed");
  const batchResponse = await fetch(base + "/api/receipts/batches", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Synthetic runtime batch",
      period: "2026-09",
      liquidation: "monthly",
    }),
  });
  if (batchResponse.status !== 201)
    throw new Error("Runtime batch creation failed");
  const batch = await batchResponse.json();
  const pdf = readFileSync(join(root, "tests/fixtures/recibo-ficticio-qa.pdf"));
  const upload = await fetch(
    base + "/api/receipts/batches/" + batch.id + "/documents",
    {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/pdf",
        "X-Filename": "synthetic.pdf",
      },
      body: pdf,
    },
  );
  if (upload.status !== 201)
    throw new Error("Built isolated parser upload failed: " + upload.status);
  const doc = await upload.json();
  const download = await fetch(
    base + "/api/receipts/documents/" + doc.id + "/download",
    { headers: { cookie } },
  );
  if (
    download.status !== 200 ||
    !Buffer.from(await download.arrayBuffer()).equals(pdf)
  )
    throw new Error("Runtime private PDF roundtrip failed");
  console.log(
    "Built PDF worker validated real synthetic upload with runtime-only dependencies",
  );
  async function postFixture(path, body) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Synthetic report setup failed: " + path);
    return response.json();
  }
  const site = await postFixture("/api/sites", {
    name: "Synthetic report site",
    address: "Fixture address",
    lat: 0,
    lon: 0,
    radius: 100,
    active: 1,
  });
  const employee = await postFixture("/api/employees", {
    name: "Synthetic report employee",
    phone: "5491100000098",
    role: "Staff",
    site_ids: [site.id],
    active: 1,
  });
  await postFixture("/api/attendance/manual", {
    employee_id: employee.id,
    site_id: site.id,
    entry_at: "2026-09-01T12:00:00Z",
    exit_at: "2026-09-01T14:00:00Z",
    reason: "Synthetic runtime export verification",
  });
  for (const format of ["xlsx", "pdf"]) {
    const response = await fetch(
      base +
        "/api/reports/summary." +
        format +
        "?from=2026-09-01&to=2026-09-01",
      { headers: { cookie } },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const prefix = format === "pdf" ? "%PDF" : "PK";
    if (
      response.status !== 200 ||
      !bytes.subarray(0, prefix.length).equals(Buffer.from(prefix)) ||
      response.headers.get("Cache-Control") !== "private, no-store"
    )
      throw new Error(
        "Built isolated report export failed: " +
          format +
          " " +
          response.status,
      );
  }
  console.log(
    "Built report worker produced XLSX and PDF with runtime-only dependencies",
  );
  const snapshot = join(fixture, "snapshot.sqlite"),
    restored = join(fixture, "restore.sqlite");
  for (const args of [
    ["backup", join(fixture, "nested", "db.sqlite"), snapshot],
    ["restore", snapshot, restored],
  ]) {
    const result = spawnSync(process.execPath, ["build/ops.mjs", ...args], {
      cwd: fixture,
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error("Built backup/restore CLI failed");
  }
  const blocked = spawnSync(process.execPath, ["build/server.mjs"], {
    cwd: fixture,
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ADMIN_PASSWORD: "Isolated-runtime-proof-123",
      DATABASE_PATH: restored,
      DEMO_MODE: "false",
      WHATSAPP_SEND_ENABLED: "true",
      WHATSAPP_ACCESS_TOKEN: "synthetic",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_API_VERSION: "v23.0",
      WHATSAPP_APP_SECRET: "synthetic",
      WHATSAPP_VERIFY_TOKEN: "synthetic",
    },
  });
  if (
    blocked.status === 0 ||
    !blocked.stderr.includes("offline recovery acknowledgement")
  )
    throw new Error("Restoration did not block startup before sending");
  console.log(
    "Runtime-only production installation, nested database, health and HTML verified",
  );
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await exited;
  }
  if (!fixture.startsWith(join(tmpdir(), "carahue-production-")))
    throw new Error("Unexpected fixture path");
  rmSync(fixture, { recursive: true, force: true });
}
