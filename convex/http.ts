import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { z } from "zod";
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
    if (path === "/api/employees" && request.method === "POST") {
      const data = z
        .object({
          id: z.string().optional(),
          name: z.string().max(100),
          phone: z.string().max(32),
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
          : "No se pudo guardar. Revisá los datos (teléfono único, coordenadas y radio válidos).",
      },
      unauthorized ? 401 : 400,
    );
  }
});
http.route({ pathPrefix: "/api/", method: "GET", handler: apiHandler });
http.route({ pathPrefix: "/api/", method: "POST", handler: apiHandler });
http.route({
  path: "/webhook",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const query = new URL(request.url).searchParams;
    if (
      process.env.WHATSAPP_VERIFY_TOKEN &&
      query.get("hub.mode") === "subscribe" &&
      query.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN
    )
      return new Response(query.get("hub.challenge") ?? "");
    return new Response("Forbidden", { status: 403 });
  }),
});
http.route({
  path: "/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 1000000)
      return new Response("Too large", { status: 413 });
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    if (
      !process.env.WHATSAPP_APP_SECRET ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    )
      return new Response("Unauthorized", { status: 401 });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(process.env.WHATSAPP_APP_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (h) =>
      parseInt(h, 16),
    );
    if (!(await crypto.subtle.verify("HMAC", key, bytes, raw)))
      return new Response("Unauthorized", { status: 401 });
    try {
      const payload = JSON.parse(new TextDecoder().decode(raw));
      if (payload.object !== "whatsapp_business_account")
        return new Response("Invalid payload", { status: 400 });
      const messages = [];
      for (const entry of payload.entry ?? [])
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (
            !process.env.WHATSAPP_PHONE_NUMBER_ID ||
            value?.metadata?.phone_number_id !==
              process.env.WHATSAPP_PHONE_NUMBER_ID
          )
            continue;
          for (const m of value.messages ?? []) {
            const timestamp = Number(m.timestamp) * 1000;
            if (
              typeof m.id !== "string" ||
              typeof m.from !== "string" ||
              !Number.isFinite(timestamp)
            )
              return new Response("Invalid message", { status: 400 });
            messages.push({
              messageId: m.id,
              phone: m.from,
              timestamp,
              kind: String(m.type),
              ...(typeof m.text?.body === "string"
                ? { text: m.text.body }
                : {}),
              ...(typeof m.location?.latitude === "number"
                ? { latitude: m.location.latitude }
                : {}),
              ...(typeof m.location?.longitude === "number"
                ? { longitude: m.location.longitude }
                : {}),
            });
          }
        }
      // Acknowledge only after the inbox transaction commits.
      await ctx.runMutation(internal.messages.receive, { messages });
      return new Response("OK");
    } catch {
      return new Response("Unable to accept messages", { status: 500 });
    }
  }),
});
export default http;
