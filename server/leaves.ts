import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { civilDate } from "../shared/validation";
const schema = z
  .object({
    employee_id: z.string(),
    type: z.string().trim().min(2).max(100),
    date_from: civilDate,
    date_to: civilDate,
    reason: z.string().trim().min(5).max(2000),
  })
  .strict();
export function createLeaveRequest(
  s: Store,
  input: unknown,
  actor: string,
  source: "hr" | "whatsapp" | "simulator",
  messageId?: string,
) {
  const checked = schema.safeParse(input);
  if (!checked.success)
    throw new Error(
      "Revisá las fechas reales, el tipo de licencia y un motivo de al menos 5 caracteres.",
    );
  const p = checked.data;
  if (p.date_to < p.date_from)
    throw new Error("La fecha final debe ser posterior al inicio.");
  return s.tx(() => {
    if (
      !s.one("SELECT id FROM employees WHERE id=? AND active=1", p.employee_id)
    )
      throw new Error("Elegí un empleado activo.");
    const id = randomUUID();
    s.db
      .prepare("INSERT INTO leaves VALUES(?,?,?,?,?,?,'pending')")
      .run(id, p.employee_id, p.type, p.date_from, p.date_to, p.reason);
    s.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        id,
        actor,
        "Leave requested; pending review",
        "null",
        JSON.stringify({
          ...p,
          id,
          status: "pending",
          source,
          message_id: messageId || null,
        }),
        new Date().toISOString(),
      );
    return id;
  });
}
