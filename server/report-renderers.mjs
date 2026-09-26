import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
const metrics = [
  ["Visitas", "visits"],
  ["Días de entrada BA", "entryDays"],
  ["Visitas medibles", "measurableVisits"],
  ["Horas netas conocidas", "netHours"],
  ["Visitas abiertas", "openVisits"],
  ["Salidas desconocidas", "unknownExits"],
  ["Cerradas con pausa sin fin", "unknownPauses"],
];
const statuses = {
  open: "En sede",
  complete: "Completa",
  corrected: "Corregida",
  exit_unknown: "Salida desconocida",
};
const sources = {
  manual_hr: "Carga manual RRHH",
  simulator: "Simulador",
  demo: "Demo",
  telegram: "Telegram",
  whatsapp: "WhatsApp (histórico)",
};
const day = (value) =>
  new Date(value).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
const text = (v) => String(v ?? "");
const filters = (r) => [
  ["Desde", r.filters.from],
  ["Hasta", r.filters.to],
  ["Empleado", r.filterLabels?.employee || r.filters.employee || "Todos"],
  ["Sede", r.filterLabels?.site || r.filters.site || "Todas"],
  ["Estado", statuses[r.filters.status] || "Todos"],
  ["Nombre contiene", r.filters.search || "Sin búsqueda"],
];
function strings(r) {
  return [
    r.asOf,
    ...filters(r).flat(),
    ...r.byEmployee.map((g) => g.name),
    ...r.bySite.map((g) => g.name),
    ...r.details.flatMap((v) => [
      v.employee_name,
      v.site_name,
      v.entry_at,
      v.exit_at,
      statuses[v.status] || v.status,
      sources[v.source] || v.source,
    ]),
  ].map(text);
}
function safeLength(r) {
  if (strings(r).some((v) => v.length > 32767))
    throw Object.assign(
      new Error(
        "Un texto supera el límite del archivo. Revisá nombres y filtros.",
      ),
      { status: 413 },
    );
}
export async function renderXlsx(r) {
  safeLength(r);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Carahue";
  workbook.created = new Date(r.asOf);
  const styleSheet = (sheet, headers, widths) => {
    sheet.columns = widths.map((width) => ({ width }));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const row = sheet.addRow(headers);
    row.height = 36;
    row.eachCell((c) => {
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF173F3C" },
      };
      c.font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      c.alignment = { vertical: "middle", wrapText: true };
    });
    sheet.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  };
  const add = (sheet, values) => {
    const row = sheet.addRow(values);
    row.alignment = { vertical: "top", wrapText: true };
    row.font = { name: "Calibri", size: 11, color: { argb: "FF253B39" } };
    row.height = Math.min(
      409,
      Math.max(
        24,
        ...values.map(
          (v, i) =>
            Math.ceil(
              text(v).length /
                Math.max(1, (sheet.getColumn(i + 1).width || 20) - 2),
            ) *
              15 +
            6,
        ),
      ),
    );
    if (row.number % 2 === 0)
      row.eachCell(
        (c) =>
          (c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF1F5EF" },
          }),
      );
    return row;
  };
  const summary = workbook.addWorksheet("Resumen");
  styleSheet(summary, ["CARAHUE · Reporte del período", "Valor"], [46, 80]);
  for (const [label, key] of metrics) {
    const row = add(summary, [label, r.overall[key]]);
    if (key === "netHours") row.getCell(2).numFmt = "0.00";
  }
  add(summary, [
    "Minutos extra aprobados (separados)",
    r.approvedOvertimeMinutes,
  ]);
  add(summary, ["Generado UTC", new Date(r.asOf)]).getCell(2).numFmt =
    "yyyy-mm-dd hh:mm:ss";
  for (const pair of filters(r)) add(summary, pair);
  add(summary, [
    "Zona horaria de atribución",
    "America/Argentina/Buenos_Aires",
  ]);
  add(summary, [
    "Criterio",
    "Fecha de entrada BA; las visitas nocturnas no se dividen. Las pausas conocidas se descuentan una vez.",
  ]);
  add(summary, [
    "Exclusiones",
    "Horas desconocidas quedan en blanco. Los minutos extra aprobados no se suman automáticamente. No es liquidación salarial.",
  ]);
  for (const [label, groups] of [
    ["Empleados", r.byEmployee],
    ["Sedes", r.bySite],
  ]) {
    const sheet = workbook.addWorksheet(label);
    styleSheet(
      sheet,
      [
        label === "Empleados" ? "Empleado" : "Sede",
        ...metrics.map((m) => m[0]),
      ],
      [45, 12, 15, 15, 18, 14, 19, 24],
    );
    for (const g of groups) {
      const row = add(sheet, [text(g.name), ...metrics.map((m) => g[m[1]])]);
      row.getCell(5).numFmt = "0.00";
    }
    if (!groups.length) add(sheet, ["Sin resultados"]);
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, sheet.rowCount), column: 8 },
    };
  }
  const detail = workbook.addWorksheet("Detalle");
  styleSheet(
    detail,
    [
      "Empleado",
      "Sede",
      "Fecha entrada BA",
      "Entrada UTC",
      "Salida UTC",
      "Estado",
      "Horas netas conocidas",
      "Origen",
    ],
    [45, 32, 18, 24, 24, 24, 22, 23],
  );
  for (const v of r.details) {
    const row = add(detail, [
      text(v.employee_name),
      text(v.site_name),
      day(v.entry_at),
      new Date(v.entry_at),
      v.exit_at ? new Date(v.exit_at) : null,
      statuses[v.status] || text(v.status),
      v.netHours === null ? null : v.netHours,
      sources[v.source] || text(v.source),
    ]);
    row.getCell(4).numFmt = "yyyy-mm-dd hh:mm:ss";
    row.getCell(5).numFmt = "yyyy-mm-dd hh:mm:ss";
    row.getCell(7).numFmt = "0.00";
  }
  if (!r.details.length) add(detail, ["Sin resultados"]);
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, detail.rowCount), column: 8 },
  };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function renderPdf(r, maxBytes = 20 * 1024 * 1024) {
  safeLength(r);
  if (
    strings(r).some((v) =>
      /[^\x20-\x7E\u00A0-\u00FF\n\r\t\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/u.test(
        v,
      ),
    )
  )
    throw Object.assign(
      new Error(
        "El PDF admite caracteres latinos y acentos. Un nombre contiene otros caracteres: usá XLSX para conservarlo completo.",
      ),
      { status: 422 },
    );
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
      bufferPages: true,
      info: { Title: "Carahue · Reporte de asistencia", Author: "Carahue" },
    });
    const chunks = [];
    let bytes = 0,
      failed = false;
    doc.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes && !failed) {
        failed = true;
        doc.destroy();
        reject(
          Object.assign(
            new Error("El archivo supera 20 MiB. Reducí los filtros."),
            { status: 413 },
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    doc.on("error", reject);
    doc.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    const width = doc.page.width - 72,
      bottom = doc.page.height - 55;
    let y = 36;
    const heading = (title) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#173f3c")
        .text(title, 36, y, { width });
      y += 28;
    };
    const next = (title) => {
      doc.addPage();
      y = 36;
      heading(title);
    };
    heading("CARAHUE / Reporte del período");
    doc.font("Helvetica").fontSize(9).fillColor("#526961");
    const meta = `Generado UTC: ${r.asOf}\n${filters(r)
      .map(([k, v]) => k + ": " + text(v))
      .join(
        "  |  ",
      )}\nAtribución: fecha de entrada · America/Argentina/Buenos_Aires. Visitas nocturnas sin división por jornada.`;
    const mh = doc.heightOfString(meta, { width });
    if (mh > 200) {
      reject(
        Object.assign(
          new Error("Los filtros son demasiado extensos para el PDF."),
          { status: 413 },
        ),
      );
      doc.destroy();
      return;
    }
    doc.text(meta, 36, y, { width });
    y += mh + 18;
    const table = (title, headers, rows, widths) => {
      if (y + 72 > bottom) next(title);
      else heading(title);
      const normalized = widths.map(
        (v) => (v * width) / widths.reduce((a, b) => a + b, 0),
      );
      const measure = (values) =>
        Math.max(
          ...values.map((v, i) =>
            doc.heightOfString(text(v), { width: normalized[i] - 12 }),
          ),
        ) + 14;
      const draw = (values, height, header, index) => {
        doc
          .rect(36, y, width, height)
          .fill(header ? "#173f3c" : index % 2 === 0 ? "#f0f4ee" : "#ffffff");
        let x = 36;
        doc.fillColor(header ? "#ffffff" : "#253b39");
        values.forEach((v, i) => {
          doc.text(text(v), x + 6, y + 7, {
            width: normalized[i] - 12,
            lineGap: 0,
          });
          x += normalized[i];
        });
        y += height;
      };
      doc.font("Helvetica-Bold").fontSize(8);
      let hh = measure(headers);
      draw(headers, hh, true, 0);
      for (let index = 0; index < rows.length; index++) {
        const values = rows[index];
        doc.font("Helvetica").fontSize(8);
        const height = measure(values);
        if (height > bottom - 100)
          throw Object.assign(
            new Error(
              "Una fila es demasiado extensa para el PDF. Usá XLSX o acortá el texto.",
            ),
            { status: 413 },
          );
        if (y + height > bottom) {
          next(title + " · continuación");
          doc.font("Helvetica-Bold").fontSize(8);
          hh = measure(headers);
          draw(headers, hh, true, 0);
          doc.font("Helvetica").fontSize(8);
        }
        draw(values, height, false, index);
      }
      y += 18;
    };
    try {
      table(
        "Resumen",
        ["Indicador", "Valor"],
        [
          ...metrics.map(([label, key]) => [
            label,
            key === "netHours" ? r.overall[key].toFixed(2) : r.overall[key],
          ]),
          ["Minutos extra aprobados (separados)", r.approvedOvertimeMinutes],
        ],
        [3, 1],
      );
      const note =
        "Horas desconocidas: sin valor. Pausas conocidas descontadas una vez. Los minutos extra no se suman automáticamente. No es liquidación salarial.";
      doc.font("Helvetica").fontSize(9);
      if (y + 40 > bottom) next("Criterios");
      doc.fillColor("#526961").text(note, 36, y, { width });
      y += doc.heightOfString(note, { width }) + 20;
      for (const [title, groups] of [
        ["Por empleado", r.byEmployee],
        ["Por sede", r.bySite],
      ])
        table(
          title,
          [
            title === "Por empleado" ? "Empleado" : "Sede",
            ...metrics.map((m) => m[0]),
          ],
          groups.length
            ? groups.map((g) => [
                g.name,
                ...metrics.map(([, key]) =>
                  key === "netHours" ? g[key].toFixed(2) : g[key],
                ),
              ])
            : [["Sin resultados", "", "", "", "", "", "", ""]],
          [3, 1, 1, 1, 1.2, 1, 1.2, 1.5],
        );
      const stamp = (v) =>
        v
          ? new Date(v)
              .toISOString()
              .replace("T", "\n")
              .replace(".000Z", " UTC")
          : "";
      table(
        "Detalle de visitas",
        [
          "Empleado",
          "Sede",
          "Entrada BA",
          "Entrada UTC",
          "Salida UTC",
          "Estado",
          "Horas netas",
          "Origen",
        ],
        r.details.length
          ? r.details.map((v) => [
              v.employee_name,
              v.site_name,
              day(v.entry_at),
              stamp(v.entry_at),
              stamp(v.exit_at),
              statuses[v.status] || v.status,
              v.netHours === null ? "" : v.netHours.toFixed(2),
              sources[v.source] || v.source,
            ])
          : [["Sin resultados", "", "", "", "", "", "", ""]],
        [160, 105, 62, 110, 110, 80, 62, 80],
      );
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#687975")
          .text(
            `Carahue · Asistencia / ${i + 1} de ${range.count}`,
            36,
            doc.page.height - 48,
            { width, align: "right", lineBreak: false },
          );
      }
      doc.end();
    } catch (e) {
      failed = true;
      doc.destroy();
      reject(e);
    }
  });
}
