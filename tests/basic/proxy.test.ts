import { expect, it, vi } from "vitest";
import { handleRequest } from "../../api/[...path]";
it("blocks cross-origin mutation before forwarding and returns no cache headers", async () => {
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("PROXY_SECRET", "secret");
  const res = await handleRequest(
    new Request("https://attendance.example/api/employees", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "{}",
    }),
  );
  expect(res.status).toBe(403);
});
it("forwards only the session cookie and replaces spoofed trusted headers", async () => {
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("PROXY_SECRET", "real-secret");
  const fetcher = async (request: Request) => {
    expect(request.url).toBe("https://example.convex.site/api/data");
    expect(request.headers.get("x-proxy-secret")).toBe("real-secret");
    expect(request.headers.get("cookie")).toBe("attendance_session=abc");
    expect(request.headers.get("authorization")).toBeNull();
    return new Response('{"email":"admin@example.com"}', {
      headers: { "set-cookie": "attendance_session=abc; Secure; HttpOnly" },
    });
  };
  const response = await handleRequest(
    new Request("https://attendance.example/api/data", {
      headers: {
        cookie: "tracking=private; attendance_session=abc",
        "x-proxy-secret": "spoofed",
        authorization: "Bearer unrelated",
      },
    }),
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
});
it("exposes no legacy endpoints", async () => {
  expect(
    (await handleRequest(new Request("https://attendance.example/api/payroll")))
      .status,
  ).toBe(404);
});
it.each([
  ["/api/employees/link-code", "POST"],
  ["/api/employees/revoke-link", "POST"],
  ["/api/telegram-operations", "GET"],
] as const)("forwards the Telegram operator route %s", async (path, method) => {
  vi.stubEnv("APP_ORIGIN", "https://attendance.example");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("PROXY_SECRET", "secret");
  let forwarded = false;
  const response = await handleRequest(
    new Request(`https://attendance.example${path}`, {
      method,
      headers: { origin: "https://attendance.example" },
      ...(method === "POST"
        ? { body: JSON.stringify({ employeeId: "e" }) }
        : {}),
    }),
    async (request) => {
      forwarded = true;
      expect(new URL(request.url).pathname).toBe(path);
      expect(request.method).toBe(method);
      return Response.json({ ok: true });
    },
  );
  expect(response.status).toBe(200);
  expect(forwarded).toBe(true);
});
