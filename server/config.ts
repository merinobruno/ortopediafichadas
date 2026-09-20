import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || 4381);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535");
  if (env.BOT_PUBLIC_NUMBER && !/^\d{10,15}$/.test(env.BOT_PUBLIC_NUMBER))
    throw new Error(
      "BOT_PUBLIC_NUMBER must contain 10 to 15 international digits",
    );
  const production = env.NODE_ENV === "production";
  if (
    production &&
    (!env.ADMIN_PASSWORD ||
      env.ADMIN_PASSWORD.length < 12 ||
      env.ADMIN_PASSWORD === "Carahue-demo-2026")
  )
    throw new Error(
      "A non-demo ADMIN_PASSWORD of at least 12 characters is required",
    );
  if (
    env.WHATSAPP_SEND_ENABLED === "true" &&
    (![
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
    ].every((k) => env[k]?.trim()) ||
      !/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION || ""))
  )
    throw new Error(
      "Explicit sending requires complete WhatsApp configuration",
    );
  return {
    port,
    production,
    demo:
      env.DEMO_MODE === "true" || (!production && env.DEMO_MODE !== "false"),
    host: env.HOST || "127.0.0.1",
    database: env.DATABASE_PATH || "data/carahue.sqlite",
  };
}
export function prepareDatabasePath(path: string) {
  if (!path.trim() || path === ":memory:" || path.startsWith("file:"))
    throw new Error("DATABASE_PATH must name a persistent local file");
  const full = resolve(path);
  if (
    existsSync(full) &&
    (!lstatSync(full).isFile() || lstatSync(full).isSymbolicLink())
  )
    throw new Error("DATABASE_PATH must be a regular file");
  mkdirSync(dirname(full), { recursive: true });
  return full;
}
