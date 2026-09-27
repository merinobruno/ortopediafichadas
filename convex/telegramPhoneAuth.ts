const encoder = new TextEncoder();

export class TelegramInitDataError extends Error {
  constructor(readonly code: "invalid" | "expired") {
    super("Invalid Telegram identity");
  }
}

async function hmac(key: Uint8Array | string, value: string) {
  const bytes =
    typeof key === "string" ? encoder.encode(key) : new Uint8Array(key.length);
  if (typeof key !== "string") bytes.set(key);
  const material = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", material, encoder.encode(value)),
  );
}

export async function verifyTelegramInitData(
  raw: string,
  token: string,
  now = Date.now(),
): Promise<string> {
  if (!token || !raw || raw.length > 4096)
    throw new TelegramInitDataError("invalid");
  const fields = new URLSearchParams(raw);
  const values = new Map<string, string>();
  for (const [key, value] of fields) {
    if (!/^[a-z_]+$/.test(key) || values.has(key))
      throw new TelegramInitDataError("invalid");
    values.set(key, value);
  }
  const supplied = values.get("hash");
  const date = values.get("auth_date");
  const user = values.get("user");
  if (
    !supplied ||
    !/^[0-9a-f]{64}$/i.test(supplied) ||
    !date ||
    !/^\d{10}$/.test(date) ||
    !user
  )
    throw new TelegramInitDataError("invalid");
  const age = now - Number(date) * 1000;
  values.delete("hash");
  const check = [...values]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = await hmac("WebAppData", token);
  const expected = await hmac(secret, check);
  const actual = Uint8Array.from(supplied.match(/../g)!, (pair) =>
    parseInt(pair, 16),
  );
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected[i] ^ actual[i];
  if (difference !== 0) throw new TelegramInitDataError("invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(user);
  } catch {
    throw new TelegramInitDataError("invalid");
  }
  const id =
    parsed && typeof parsed === "object" && "id" in parsed
      ? parsed.id
      : undefined;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    throw new TelegramInitDataError("invalid");
  if (!Number.isFinite(age) || age < -30000)
    throw new TelegramInitDataError("invalid");
  if (age > 300000) throw new TelegramInitDataError("expired");
  return String(id);
}
