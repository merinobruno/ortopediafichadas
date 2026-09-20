import { Store } from "./store";
import { randomUUID } from "node:crypto";
export function seed(s: Store) {
  if (s.one("SELECT id FROM employees LIMIT 1")) return;
  s.tx(() => {
    for (const a of [
      [
        "centro",
        "Casa Central",
        "Av. Corrientes 1450, CABA",
        -34.604,
        -58.386,
        120,
        "Administración",
      ],
      [
        "palermo",
        "Sede Palermo",
        "Av. Santa Fe 3200, CABA",
        -34.588,
        -58.412,
        100,
        "Atención",
      ],
      [
        "deposito",
        "Depósito Norte",
        "Av. Cabildo 4200, CABA",
        -34.547,
        -58.47,
        180,
        "Logística",
      ],
    ])
      s.db
        .prepare("INSERT INTO sites VALUES(?,?,?,?,?,?,?,1)")
        .run(...(a as any[]));
    const people = [
      ["Lucía Fernández", "Atención al cliente"],
      ["Martín Suárez", "Logística"],
      ["Camila Ríos", "Administración"],
      ["Tomás Acosta", "Atención al cliente"],
      ["Valentina Costa", "Administración"],
      ["Nicolás Méndez", "Logística"],
      ["Sofía Molina", "Atención al cliente"],
      ["Julián Torres", "Administración"],
    ];
    people.forEach(([name, role], i) =>
      s.db
        .prepare("INSERT INTO employees VALUES(?,?,?,?,?,1)")
        .run(
          "demo-" + i,
          name,
          "54911000000" + String(i + 10),
          role,
          '["centro","palermo","deposito"]',
        ),
    );
    const now = new Date();
    const at = (days: number, hours: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      d.setHours(hours, 0, 0, 0);
      if (d > now) d.setDate(d.getDate() - 1);
      return d.toISOString();
    };
    for (let day = 0; day < 5; day++)
      for (let i = 0; i < 8; i++) {
        const status =
          day === 0
            ? i === 2
              ? "exit_unknown"
              : i < 5
                ? "open"
                : "complete"
            : "complete";
        const id = randomUUID();
        s.db
          .prepare("INSERT INTO visits VALUES(?,?,?,?,?,?,?)")
          .run(
            id,
            "demo-" + i,
            ["centro", "palermo", "deposito"][i % 3],
            at(day, 8),
            status === "complete" ? at(day, 12) : null,
            status,
            "demo",
          );
        if (status === "exit_unknown")
          s.db
            .prepare("INSERT INTO alerts VALUES(?,?,?,?,?,NULL)")
            .run(randomUUID(), id, "demo-" + i, "exit_unknown", at(day, 11));
      }
    s.db
      .prepare("INSERT INTO shifts VALUES(?,?,?,?,?)")
      .run(randomUUID(), "Jornada mañana", "08:00", "16:00", 10);
    s.db
      .prepare("INSERT INTO shifts VALUES(?,?,?,?,?)")
      .run(randomUUID(), "Atención tarde", "12:00", "20:00", 10);
    s.db
      .prepare("INSERT INTO leaves VALUES(?,?,?,?,?,?,'pending')")
      .run(
        randomUUID(),
        "demo-6",
        "Vacaciones",
        now.toISOString().slice(0, 10),
        new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10),
        "Solicitud de demostración para revisión de RRHH.",
      );
  });
}
