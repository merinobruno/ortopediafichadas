import { expect, it } from "vitest";
import { parseTelegramUpdate } from "./telegramUpdate";

const message = {
  update_id: 41,
  message: {
    message_id: 7,
    date: 1790000000,
    from: { id: 8 },
    chat: { id: 8, type: "private" },
    text: "entrada",
  },
};
it("accepts only direct private messages from the matching numeric sender", () => {
  expect(parseTelegramUpdate(message)).toMatchObject({
    updateId: 41,
    userId: "8",
    chatId: "8",
    text: "entrada",
  });
  expect(
    parseTelegramUpdate({
      ...message,
      message: { ...message.message, chat: { id: -8, type: "group" } },
    }),
  ).toBeNull();
  expect(
    parseTelegramUpdate({
      ...message,
      message: { ...message.message, from: { id: 9 } },
    }),
  ).toBeNull();
  expect(
    parseTelegramUpdate({
      ...message,
      edited_message: message.message,
      message: undefined,
    }),
  ).toBeNull();
  expect(
    parseTelegramUpdate({
      ...message,
      message: { ...message.message, forward_origin: {} },
    }),
  ).toBeNull();
});
