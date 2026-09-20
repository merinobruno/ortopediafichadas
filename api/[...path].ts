const allowed = new Map([
  ["/api/login", "POST"],
  ["/api/logout", "POST"],
  ["/api/data", "GET"],
  ["/api/employees", "POST"],
  ["/api/sites", "POST"],
]);
const failure = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export async function handleRequest(
  request: Request,
  fetcher: (request: Request) => Promise<Response> = fetch,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!allowed.has(path)) return failure("No encontrado.", 404);
  if (allowed.get(path) !== request.method)
    return failure("Método no permitido.", 405);
  const { APP_ORIGIN, CONVEX_SITE_URL, PROXY_SECRET } = process.env;
  if (!APP_ORIGIN || !CONVEX_SITE_URL || !PROXY_SECRET)
    return failure("El servicio todavía no está configurado.", 503);
  if (request.method !== "GET" && request.headers.get("origin") !== APP_ORIGIN)
    return failure("Origen no autorizado.", 403);
  if (!/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(CONVEX_SITE_URL))
    return failure("Configuración inválida.", 503);
  const session = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("attendance_session="));
  const headers = new Headers({
    "x-proxy-secret": PROXY_SECRET,
    origin: APP_ORIGIN,
    "Content-Type": "application/json",
  });
  if (session) headers.set("cookie", session);
  // Vercel sets x-vercel-forwarded-for at its trusted edge. Do not trust the
  // user-controlled x-client-ip or generic forwarded headers.
  headers.set(
    "x-client-ip",
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown",
  );
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && new TextEncoder().encode(body).length > 8192)
      return failure("Solicitud demasiado grande.", 413);
    const upstream = await fetcher(
      new Request(`${CONVEX_SITE_URL}${path}`, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      }),
    );
    const responseHeaders = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) responseHeaders.set("set-cookie", cookie);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return failure("No se pudo conectar. Intentá nuevamente.", 502);
  }
}
export default { fetch: (request: Request) => handleRequest(request) };
