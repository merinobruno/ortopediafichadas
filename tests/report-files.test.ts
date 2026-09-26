import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { selectExportReport, selectReport } from "../server/reports";
function setup() {
  const s = new Store(":memory:");
  s.db.exec(
    `INSERT INTO employees(id,name,role) VALUES('e','=SUM(1,2) Álvarez','123'),('x','Hidden','456');INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('s','Sede Ñandú','Address',0,0,100),('b','Other site','Address',1,1,100);INSERT INTO visits VALUES('v','e','s','2026-09-15T02:00:00Z','2026-09-15T04:00:00Z','complete','demo'),('other','e','b','2026-09-15T12:00:00Z',NULL,'open','demo'),('hidden','x','s','2026-09-15T01:00:00Z',NULL,'open','demo');INSERT INTO breaks VALUES('pause','v','2026-09-15T02:30:00Z','2026-09-15T03:00:00Z','complete');INSERT INTO overtime VALUES('extra','v',30,'Separate approved minutes','approved')`,
  );
  return s;
}
test("bounded exports use the same scoped applied filters BA entry day and shared totals", () => {
  const s = setup();
  try {
    const user = { role: "supervisor", employee_ids: '["e"]' },
      filters = {
        from: "2026-09-14",
        to: "2026-09-14",
        site: "s",
        status: "complete",
        search: "ÁLVAREZ",
      };
    const ordinary = selectReport(s, user, filters),
      snapshot = selectExportReport(s, user, filters, "xlsx");
    assert.deepEqual(snapshot.details, ordinary.details);
    assert.deepEqual(snapshot.overall, ordinary.overall);
    assert.equal(snapshot.overall.netHours, 1.5);
    assert.equal(snapshot.approvedOvertimeMinutes, 30);
    assert.equal(snapshot.details.length, 1);
    assert.equal(
      selectExportReport(
        s,
        { role: "supervisor", employee_ids: "[]" },
        filters,
        "pdf",
      ).details.length,
      0,
    );
    assert.throws(
      () => selectExportReport(s, user, { ...filters, employee: "x" }, "pdf"),
      (e: any) => e.status === 403,
    );
    assert.throws(() =>
      selectExportReport(s, user, { from: "2026-09-01" }, "pdf"),
    );
    assert.throws(() =>
      selectExportReport(
        s,
        user,
        { from: "2025-01-01", to: "2026-01-02" },
        "pdf",
      ),
    );
    assert.doesNotThrow(() =>
      selectExportReport(
        s,
        user,
        { from: "2025-01-01", to: "2026-01-01" },
        "pdf",
      ),
    );
  } finally {
    s.db.close();
  }
});
import ExcelJS from "exceljs";
import { renderXlsx, renderPdf } from "../server/report-renderers.mjs";
import { ExportPool } from "../server/report-export";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
test("Excel preserves literal formula-looking text typed dates numbers zero and unknown blanks", async () => {
  const s = setup();
  try {
    s.db.exec(
      "INSERT INTO visits VALUES('zero','e','s','2026-09-14T05:00:00Z','2026-09-14T05:00:00Z','corrected','manual_hr'),('unknown','e','s','2026-09-14T04:00:00Z',NULL,'exit_unknown','demo')",
    );
    const snapshot = selectExportReport(
      s,
      { role: "admin" },
      { from: "2026-09-14", to: "2026-09-14" },
      "xlsx",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await renderXlsx(snapshot)) as any);
    assert.deepEqual(
      workbook.worksheets.map((s) => s.name),
      ["Resumen", "Empleados", "Sedes", "Detalle"],
    );
    const detail = workbook.getWorksheet("Detalle")!;
    assert.equal(detail.getCell("A2").value, "=SUM(1,2) Álvarez");
    assert.equal(detail.getCell("A2").type, ExcelJS.ValueType.String);
    assert.ok(detail.getCell("D2").value instanceof Date);
    assert.equal(detail.getCell("G2").value, 1.5);
    assert.equal(detail.getCell("G4").value, 0);
    assert.equal(detail.getCell("G5").value, null);
    assert.equal(workbook.getWorksheet("Resumen")!.getCell("B9").value, 30);
    for (const sheet of workbook.worksheets)
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          assert.notEqual(cell.type, ExcelJS.ValueType.Formula);
          assert.notEqual(cell.type, ExcelJS.ValueType.Hyperlink);
        }),
      );
    snapshot.details[0].employee_name = "姓名";
    await assert.rejects(
      () => renderPdf(snapshot),
      (e: any) => e.status === 422,
    );
    const unicode = new ExcelJS.Workbook();
    await unicode.xlsx.load((await renderXlsx(snapshot)) as any);
    assert.equal(unicode.getWorksheet("Detalle")!.getCell("A2").value, "姓名");
  } finally {
    s.db.close();
  }
});
test("export row limits reject before loading dependent tables and never truncate", () => {
  const s = setup();
  try {
    s.tx(() => {
      for (let i = 0; i < 2001; i++)
        s.db
          .prepare(
            "INSERT INTO visits VALUES(?,?,?,'2026-09-16T12:00:00Z','2026-09-16T13:00:00Z','complete','demo')",
          )
          .run("many" + i, "e", "s");
    });
    const all = s.all.bind(s);
    let dependencies = 0;
    s.all = ((sql: string, ...args: any[]) => {
      if (sql.includes("FROM breaks")) dependencies++;
      return all(sql, ...args);
    }) as typeof s.all;
    assert.throws(
      () =>
        selectExportReport(
          s,
          { role: "admin" },
          { from: "2026-09-16", to: "2026-09-16" },
          "pdf",
        ),
      (e: any) => e.status === 413,
    );
    assert.equal(dependencies, 0);
    assert.equal(
      selectExportReport(
        s,
        { role: "admin" },
        { from: "2026-09-16", to: "2026-09-16" },
        "xlsx",
      ).details.length,
      2001,
    );
  } finally {
    s.db.close();
  }
});
test("worker account/global bounds timeout abort and oversize all release admission slots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carahue-export-worker-"));
  try {
    const file = join(dir, "synthetic-worker.mjs");
    writeFileSync(
      file,
      "import{parentPort,workerData}from'node:worker_threads';setTimeout(()=>parentPort.postMessage({ok:true,bytes:new Uint8Array(workerData.snapshot.size||2)}),workerData.snapshot.delay||1)",
    );
    const url = pathToFileURL(file),
      pool = new ExportPool(url, 2000, 10);
    const a = pool.render({ delay: 300 }, "pdf", "a"),
      b = pool.render({ delay: 300 }, "pdf", "b");
    await assert.rejects(
      () => pool.render({}, "pdf", "a"),
      (e: any) => e.status === 429,
    );
    await assert.rejects(
      () => pool.render({}, "pdf", "c"),
      (e: any) => e.status === 503,
    );
    await Promise.all([a, b]);
    await assert.rejects(
      () => pool.render({ size: 11 }, "pdf", "a"),
      (e: any) => e.status === 413,
    );
    assert.equal((await pool.render({}, "pdf", "a")).length, 2);
    const abort = new AbortController();
    const cancelled = pool.render({ delay: 5000 }, "pdf", "a", abort.signal);
    abort.abort();
    await assert.rejects(
      () => cancelled,
      (e: any) => e.status === 499,
    );
    assert.equal((await pool.render({}, "pdf", "a")).length, 2);
    const short = new ExportPool(url, 80, 10);
    await assert.rejects(
      () => short.render({ delay: 5000 }, "pdf", "a"),
      (e: any) => e.status === 503,
    );
    await assert.rejects(
      () => short.render({ delay: 5000 }, "pdf", "a"),
      (e: any) => e.status === 503 && e.message.includes("segundos"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { createApp } from "../server/app";
import { upsertUser } from "../server/auth";
import { PDFDocument } from "pdf-lib";
test("authenticated file routes return scoped private attachments and existing CSV bytes remain compatible", async () => {
  process.env.ADMIN_PASSWORD = "Report-file-test-2026";
  const s = setup(),
    app = createApp(s);
  upsertUser(
    s,
    {
      email: "report-supervisor@example.test",
      name: "Supervisor",
      role: "supervisor",
      active: true,
      employee_ids: ["e"],
      password: "Report-supervisor-2026",
    },
    "admin",
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    query = "from=2026-09-14&to=2026-09-14&site=s&status=complete";
  try {
    assert.equal(
      (await fetch(base + "/api/reports/summary.pdf?" + query)).status,
      401,
    );
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "report-supervisor@example.test",
        password: "Report-supervisor-2026",
      }),
    });
    const cookie = login.headers.get("set-cookie")!;
    for (const format of ["xlsx", "pdf"]) {
      assert.equal(
        (
          await fetch(
            base +
              "/api/reports/summary." +
              format +
              "?" +
              query +
              "&employee=x",
            { headers: { cookie } },
          )
        ).status,
        403,
      );
      const r = await fetch(
        base + "/api/reports/summary." + format + "?" + query,
        { headers: { cookie } },
      );
      assert.equal(r.status, 200);
      assert.match(r.headers.get("cache-control")!, /private, no-store/);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.match(r.headers.get("content-disposition")!, /attachment;/);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (format === "xlsx") {
        assert.match(r.headers.get("content-type")!, /spreadsheetml/);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(bytes as any);
        assert.equal(wb.getWorksheet("Detalle")!.rowCount, 2);
      } else {
        assert.match(r.headers.get("content-type")!, /application\/pdf/);
        assert.ok((await PDFDocument.load(bytes)).getPageCount() > 0);
      }
    }
    const csv = await (
      await fetch(base + "/api/export?" + query, { headers: { cookie } })
    ).text();
    assert.equal(
      csv,
      '"Empleado";"Sede";"Entrada UTC";"Salida UTC";"Estado";"Horas netas conocidas";"Origen"\r\n"\'SUM(1,2) Álvarez";"Sede Ñandú";"2026-09-15T02:00:00Z";"2026-09-15T04:00:00Z";"complete";"1.50";"demo"',
    );
    assert.equal(
      (await fetch(base + "/api/reports/summary.pdf", { headers: { cookie } }))
        .status,
      400,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    s.db.close();
  }
});
test("historical Buenos Aires DST export boundaries match shared civil-day filtering", () => {
  const s = setup();
  try {
    s.db.exec(
      "INSERT INTO visits VALUES('dst-in','e','s','2009-01-01T02:30:00Z','2009-01-01T03:30:00Z','complete','demo'),('dst-out','e','s','2009-01-02T02:30:00Z','2009-01-02T03:30:00Z','complete','demo')",
    );
    const filters = { from: "2009-01-01", to: "2009-01-01" };
    const expected = selectReport(s, { role: "admin" }, filters);
    assert.deepEqual(
      expected.details.map((v) => v.id),
      ["dst-in"],
    );
    assert.deepEqual(
      selectExportReport(s, { role: "admin" }, filters, "xlsx").details,
      expected.details,
    );
  } finally {
    s.db.close();
  }
});
