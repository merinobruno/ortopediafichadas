import { z } from "zod";
import { validCoordinates } from "./core";

const id = z.number().int().safe().nonnegative();
const update = z
  .object({ update_id: id, message: z.unknown().optional() })
  .passthrough();
const message = z
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

export function parseTelegramUpdate(input: unknown): TelegramEvent | null {
  const outer = update.parse(input);
  if (outer.message === undefined || "edited_message" in outer) return null;
  const m = message.parse(outer.message);
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
    "contact" in m ||
    ("reply_to_message" in m && !!(m as any).reply_to_message?.forward_origin)
  )
    return null;
  if (
    m.location &&
    !validCoordinates(m.location.latitude, m.location.longitude)
  )
    throw new Error("Invalid location");
  if (m.text === undefined && m.location === undefined) return null;
  if (m.text !== undefined && m.location !== undefined)
    throw new Error("Ambiguous message");
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
  const normalized = text.trim().toUpperCase();
  const match = /^(?:\/START(?:@[A-Z0-9_]+)?\s+)?([A-Z2-7]{10})$/.exec(
    normalized,
  );
  return match?.[1] ?? null;
}
