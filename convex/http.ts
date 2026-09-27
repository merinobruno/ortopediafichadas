import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { z } from "zod";
import { parseTelegramUpdate, linkCodeFromText } from "./telegramUpdate";
import { sha256 } from "./telegramLinks";
import {
  TelegramInitDataError,
  verifyTelegramInitData,
} from "./telegramPhoneAuth";
const http = httpRouter();
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const cookie = (token: string, age = 28800) =>
  `attendance_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const apiHandler = httpAction(async (ctx, request) => {
  if (
    !process.env.PROXY_SECRET ||
    request.headers.get("x-proxy-secret") !== process.env.PROXY_SECRET
  )
    return json({ error: "Acceso no autorizado." }, 403);
  if (
    request.method !== "GET" &&
    (!process.env.APP_ORIGIN ||
      request.headers.get("origin") !== process.env.APP_ORIGIN)
  )
    return json({ error: "Origen no autorizado." }, 403);
  const path = new URL(request.url).pathname;
  const token =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("attendance_session="))
      ?.slice("attendance_session=".length) ?? "";
  const sessionHash = await hash(token);
  try {
    if (path === "/api/phone/challenge" && request.method === "POST") {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken)
        return json({ error: "El servicio no está disponible." }, 503);
      const body = z
        .object({
          initData: z.string().min(1).max(4096),
          kind: z.enum(["entrada", "salida"]),
        })
        .strict()
        .parse(await request.json());
      let userId: string;
      try {
        userId = await verifyTelegramInitData(body.initData, botToken);
      } catch (error) {
        if (!(error instanceof TelegramInitDataError)) throw error;
        return json({ error: `telegram_auth_${error.code}` }, 401);
      }
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const challenge = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const result = await ctx.runMutation(
        internal.telegramPhone.issueChallenge,
        {
          userId,
          digest: await sha256(challenge),
          kind: body.kind,
          now: Date.now(),
        },
      );
      return result.ok
        ? json({
            ok: true,
            challenge,
            expiresAt: result.expiresAt,
            employeeName: result.employeeName,
          })
        : json(
            {
              error:
                "Tu cuenta de Telegram no está vinculada a un empleado activo.",
            },
            403,
          );
    }
    if (path === "/api/phone/submit" && request.method === "POST") {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken)
        return json({ error: "El servicio no está disponible." }, 503);
      const body = z
        .object({
          initData: z.string().min(1).max(4096),
          challenge: z.string().regex(/^[0-9a-f]{64}$/),
          latitude: z.number(),
          longitude: z.number(),
          accuracy: z.number(),
        })
        .strict()
        .parse(await request.json());
      let userId: string;
      try {
        userId = await verifyTelegramInitData(body.initData, botToken);
      } catch (error) {
        if (!(error instanceof TelegramInitDataError)) throw error;
        return json({ error: `telegram_auth_${error.code}` }, 401);
      }
      const result = await ctx.runMutation(
        internal.telegramPhone.submitChallenge,
        {
          userId,
          digest: await sha256(body.challenge),
          latitude: body.latitude,
          longitude: body.longitude,
          accuracy: body.accuracy,
          now: Date.now(),
        },
      );
      return result.ok ? json(result) : json({ error: result.reason }, 409);
    }
    if (path === "/api/login" && request.method === "POST") {
      const { email, password } = z
        .object({ email: z.string().max(254), password: z.string().max(128) })
        .parse(await request.json());
      const login = await ctx.runAction(internal.auth.login, {
        email,
        password,
        clientKey: await hash(request.headers.get("x-client-ip") ?? "unknown"),
      });
      return login
        ? json({ ok: true }, 200, { "Set-Cookie": cookie(login.token) })
        : json(
            {
              error:
                "Credenciales incorrectas o demasiados intentos. Esperá 15 minutos si persiste.",
            },
            401,
          );
    }
    if (path === "/api/logout" && request.method === "POST") {
      await ctx.runMutation(internal.data.logout, { hash: sessionHash });
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }
    if (!/^[0-9a-f]{64}$/.test(token))
      return json({ error: "Iniciá sesión para continuar." }, 401);
    if (path === "/api/data" && request.method === "GET")
      return json(
        await ctx.runMutation(internal.data.list, { hash: sessionHash }),
      );
    if (path === "/api/admins" && request.method === "POST") {
      const data = z
        .object({
          email: z.string().max(254),
          password: z.string().max(128),
        })
        .strict()
        .parse(await request.json());
      const result = await ctx.runAction(internal.auth.createAdminAccount, {
        ...data,
        hash: sessionHash,
      });
      if (result.ok) return json({ ok: true });
      return result.reason === "duplicate"
        ? json({ error: "Ya existe una cuenta de RRHH con ese correo." }, 409)
        : json(
            {
              error:
                "Ingresá un correo válido y una contraseña de 6 a 128 caracteres.",
            },
            400,
          );
    }
    if (path === "/api/employees" && request.method === "POST") {
      const data = z
        .object({
          id: z.string().optional(),
          name: z.string().max(100),
          active: z.boolean(),
        })
        .strict()
        .parse(await request.json());
      await ctx.runMutation(internal.data.saveEmployee, {
        ...data,
        id: data.id as any,
        hash: sessionHash,
      });
      return json({ ok: true });
    }
    if (path === "/api/employees/link-code" && request.method === "POST") {
      const { employeeId } = z
        .object({ employeeId: z.string() })
        .strict()
        .parse(await request.json());
      return json(
        await ctx.runAction(internal.telegramLinks.issueLinkCode, {
          hash: sessionHash,
          employeeId: employeeId as any,
        }),
      );
    }
    if (path === "/api/employees/revoke-link" && request.method === "POST") {
      const { employeeId } = z
        .object({ employeeId: z.string() })
        .strict()
        .parse(await request.json());
      await ctx.runMutation(internal.telegramLinks.revokeLink, {
        hash: sessionHash,
        employeeId: employeeId as any,
      });
      return json({ ok: true });
    }
    if (path === "/api/telegram-operations" && request.method === "GET")
      return json(
        await ctx.runMutation(internal.telegramOperations.list, {
          hash: sessionHash,
        }),
      );
    if (path === "/api/sites" && request.method === "POST") {
      const data = z
        .object({
          id: z.string().optional(),
          name: z.string().max(100),
          latitude: z.number(),
          longitude: z.number(),
          radius: z.number(),
          active: z.boolean(),
        })
        .strict()
        .parse(await request.json());
      await ctx.runMutation(internal.data.saveSite, {
        ...data,
        id: data.id as any,
        hash: sessionHash,
      });
      return json({ ok: true });
    }
    return json({ error: "No encontrado." }, 404);
  } catch (error) {
    const unauthorized =
      error instanceof Error && error.message.includes("Unauthorized");
    return json(
      {
        error: unauthorized
          ? "La sesión venció. Iniciá sesión nuevamente."
          : "No se pudo completar la operación. Revisá los datos.",
      },
      unauthorized ? 401 : 400,
    );
  }
});
http.route({ pathPrefix: "/api/", method: "GET", handler: apiHandler });
http.route({ pathPrefix: "/api/", method: "POST", handler: apiHandler });
http.route({
  path: "/webhook/telegram",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const supplied =
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!secret || !supplied)
      return new Response("Unauthorized", { status: 401 });
    const digest = async (value: string) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      );
    const expected = await digest(secret);
    const actual = await digest(supplied);
    let difference = 0;
    for (let i = 0; i < expected.length; i++)
      difference |= expected[i] ^ actual[i];
    if (difference !== 0) return new Response("Unauthorized", { status: 401 });
    if (Number(request.headers.get("content-length")) > 1000000)
      return new Response("Too large", { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return new Response("Invalid update", { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1000000) {
        await reader.cancel();
        return new Response("Too large", { status: 413 });
      }
      chunks.push(value);
    }
    const raw = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let event;
    try {
      event = parseTelegramUpdate(JSON.parse(new TextDecoder().decode(raw)));
    } catch {
      return new Response("Invalid update", { status: 400 });
    }
    if (!event) return new Response("OK");
    if (event.kind === "text") {
      const code = linkCodeFromText(event.text ?? "");
      if (code) {
        event = { ...event, text: undefined, codeHash: await sha256(code) };
      } else if (/^\s*\/start\b/i.test(event.text ?? "")) {
        event = { ...event, text: undefined };
      }
    }
    try {
      await ctx.runMutation(internal.telegramInbox.receiveTelegram, { event });
      return new Response("OK");
    } catch {
      return new Response("Unable to accept update", { status: 500 });
    }
  }),
});
export default http;
