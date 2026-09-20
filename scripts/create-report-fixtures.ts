import { mkdirSync, writeFileSync } from "node:fs";
import { Store } from "../server/store";
import { selectExportReport } from "../server/reports";
import { renderXlsx, renderPdf } from "../server/report-renderers.mjs";
const s = new Store(":memory:");
try {
  s.db.exec(
    "INSERT INTO sites(id,name,address,lat,lon,radius) VALUES('s','Sede ficticia Ñandú - Administración y atención de prueba','Synthetic',0,0,100),('b','Depósito ficticio - Equipo de logística','Synthetic',1,1,100)",
  );
  for (let i = 0; i < 3; i++)
    s.db
      .prepare("INSERT INTO employees(id,name,phone) VALUES(?,?,?)")
      .run(
        "e" + i,
        [
          "María Álvarez - PERSONA FICTICIA - Coordinación de atención y acompañamiento",
          "José Núñez - PERSONA FICTICIA - Logística y administración de sedes",
          "Érica Suárez - PERSONA FICTICIA - Equipo de prueba de reportes",
        ][i],
        "50000" + i,
      );
  for (let i = 0; i < 70; i++) {
    const entry = new Date(
      Date.UTC(2026, 8, 1 + Math.floor(i / 3), 12 + (i % 3)),
    );
    s.db
      .prepare("INSERT INTO visits VALUES(?,?,?,?,?,?,?)")
      .run(
        "v" + i,
        "e" + (i % 3),
        i % 2 ? "b" : "s",
        entry.toISOString(),
        i % 17 === 0
          ? null
          : new Date(entry.getTime() + 3 * 3600000).toISOString(),
        i % 17 === 0 ? "exit_unknown" : "complete",
        "demo",
      );
  }
  s.db.exec(
    "INSERT INTO breaks VALUES('pause','v1','2026-09-01T14:00:00Z','2026-09-01T14:30:00Z','complete');INSERT INTO overtime VALUES('extra','v1',25,'Synthetic only','approved')",
  );
  mkdirSync("tmp/reports", { recursive: true });
  const snapshot = selectExportReport(
    s,
    { role: "admin" },
    { from: "2026-09-01", to: "2026-09-30" },
    "pdf",
  );
  snapshot.asOf = "2026-09-30T23:00:00.000Z";
  writeFileSync(
    "tmp/reports/reporte-ficticio-multipagina.pdf",
    await renderPdf(snapshot),
  );
  writeFileSync(
    "tmp/reports/reporte-ficticio.xlsx",
    await renderXlsx(snapshot),
  );
  const empty = selectExportReport(
    s,
    { role: "admin" },
    { from: "2026-10-01", to: "2026-10-02" },
    "pdf",
  );
  empty.asOf = snapshot.asOf;
  writeFileSync(
    "tmp/reports/reporte-ficticio-vacio.pdf",
    await renderPdf(empty),
  );
  console.log("Synthetic PDF/XLSX fixtures created in tmp/reports");
} finally {
  s.db.close();
}
