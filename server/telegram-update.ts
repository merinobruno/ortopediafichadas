import { z } from "zod";

const id = z.number().int().safe().nonnegative();
const outerSchema = z
  .object({ update_id: id, message: z.unknown().optional() })
  .passthrough();
const messageSchema = z
  .object({
    message_id: id,
    date: id.max(Math.floor(Number.MAX_SAFE_INTEGER / 1000)),
    from: z.object({ id }).passthrough(),
    chat: z
      .object({ id: z.number().int().safe(), type: z.string() })
      .passthrough(),
    text: z.string().max(4096).optional(),
    location: z
      .object({ latitude: z.number(), longitude: z.number() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type TelegramEvent = {
  updateId: number;
  messageId: number;
  userId: string;
  chatId: string;
  timestamp: number;
  kind: "text" | "location";
  text?: string;
  latitude?: number;
  longitude?: number;
};

export function parseTelegramUpdate(value: unknown): TelegramEvent | null {
  const outer = outerSchema.parse(value);
  if (outer.message === undefined || "edited_message" in outer) return null;
  const m = messageSchema.parse(outer.message);
  if (
    m.chat.type !== "private" ||
    m.chat.id !== m.from.id ||
    "forward_origin" in m ||
    "forward_from" in m ||
    "forward_from_chat" in m ||
    "forward_date" in m ||
    "forward_sender_name" in m ||
    "is_automatic_forward" in m ||
    "edit_date" in m ||
    "contact" in m
  )
    return null;
  if (
    m.location &&
    (!Number.isFinite(m.location.latitude) ||
      !Number.isFinite(m.location.longitude) ||
      Math.abs(m.location.latitude) > 90 ||
      Math.abs(m.location.longitude) > 180)
  )
    throw new Error("Invalid location");
  if (m.text === undefined && !m.location) return null;
  if (m.text !== undefined && m.location) throw new Error("Ambiguous message");
  return {
    updateId: outer.update_id,
    messageId: m.message_id,
    userId: String(m.from.id),
    chatId: String(m.chat.id),
    timestamp: m.date * 1000,
    kind: m.location ? "location" : "text",
    ...(m.text !== undefined ? { text: m.text } : {}),
    ...(m.location
      ? { latitude: m.location.latitude, longitude: m.location.longitude }
      : {}),
  };
}

export function linkCodeFromText(text: string): string | null {
  return (
    /^(?:\/START(?:@[A-Z0-9_]+)?\s+)?([A-Z2-7]{10})$/.exec(
      text.trim().toUpperCase(),
    )?.[1] ?? null
  );
}
