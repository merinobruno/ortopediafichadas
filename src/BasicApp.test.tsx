// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import BasicApp from "./BasicApp";
import L from "leaflet";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(["html", "network"])(
  "presents a Spanish service error for %s failures",
  async (failure) => {
    vi.stubGlobal("fetch", async () => {
      if (failure === "network") throw new TypeError("Failed to fetch");
      return new Response("<html>Frontend only</html>");
    });
    render(<BasicApp />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "El servicio no está disponible. Intentá nuevamente en unos minutos.",
    );
  },
);
it("shows accessible login when unauthenticated and surfaces failed login", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: "Credenciales incorrectas" }), {
        status: 401,
      }),
  );
  render(<BasicApp />);
  await screen.findByLabelText("Correo electrónico");
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "admin@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Credenciales incorrectas",
  );
});
it("shows the four approved sections and saves an employee without a phone", async () => {
  let employees: any[] = [];
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path === "/api/employees") {
      const employee = JSON.parse(String(options?.body));
      employees = [{ _id: "e1", ...employee, telegramLinked: false }];
      return new Response('{"ok":true}');
    }
    return new Response(
      JSON.stringify({
        email: "admin@example.com",
        employees,
        sites: [],
        attendance: [],
      }),
    );
  });
  render(<BasicApp />);
  await screen.findByRole("button", { name: "Nuevo empleado" });
  expect(screen.getAllByRole("link")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Nuevo empleado" }));
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "Ana" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() =>
    expect(screen.getByRole("cell", { name: "Ana" })).toBeTruthy(),
  );
});

it("issues a one-time Telegram code without a phone and revokes the link", async () => {
  let employee = {
    _id: "e1",
    name: "Ana",
    active: true,
    telegramLinked: false,
  };
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path === "/api/employees") {
      employee = { ...employee, ...JSON.parse(String(options?.body)) };
      return Response.json({ ok: true });
    }
    if (path === "/api/employees/link-code")
      return Response.json({
        code: "ABCDEFG234",
        expiresAt: Date.now() + 900000,
      });
    if (path === "/api/employees/revoke-link") {
      employee.telegramLinked = false;
      return Response.json({ ok: true });
    }
    return Response.json({
      email: "admin@example.com",
      employees: [employee],
      sites: [],
      attendance: [],
    });
  });
  render(<BasicApp />);
  await screen.findByText("Ana");
  expect(screen.queryByLabelText("Teléfono internacional")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Generar código para Ana" }),
  );
  expect(await screen.findByText("ABCDEFG234")).toBeTruthy();
  expect(screen.getByText(/Vence el/)).toBeTruthy();
  cleanup();
  render(<BasicApp />);
  await screen.findByText("Ana");
  expect(screen.queryByText("ABCDEFG234")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Revocar vínculo de Ana" }),
  );
  await waitFor(() => expect(screen.queryByText("ABCDEFG234")).toBeNull());
});

it("shows redacted Telegram send review without a resend control", async () => {
  vi.stubGlobal("fetch", async (path: string) => path === "/api/telegram-operations"
    ? Response.json({ inbound: [], outbound: [{ status: "review", attempts: 1, createdAt: Date.now(), reasonCode: "network_uncertain" }] })
    : Response.json({ email: "admin@example.com", employees: [], sites: [], attendance: [] }));
  render(<BasicApp />);
  fireEvent.click(await screen.findByRole("link", { name: "Telegram" }));
  expect(await screen.findByText(/network_uncertain/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /reenviar/i })).toBeNull();
});

it("holds the current editor and section until a save finishes", async () => {
  let finishSave!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  vi.stubGlobal("fetch", async (path: string) => {
    if (path === "/api/employees") {
      await pending;
      return new Response('{"ok":true}');
    }
    return new Response(
      JSON.stringify({
        email: "admin@example.com",
        employees: [
          { _id: "a", name: "Ana", telegramLinked: false, active: true },
          { _id: "b", name: "Bruno", telegramLinked: false, active: true },
        ],
        sites: [],
        attendance: [],
      }),
    );
  });
  render(<BasicApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Editar Ana" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  fireEvent.click(screen.getByRole("button", { name: "Editar Bruno" }));
  expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
    "Ana",
  );
  fireEvent.click(screen.getByRole("link", { name: "Sedes" }));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Empleados",
  );
  finishSave();
  await waitFor(() => expect(screen.queryByLabelText("Nombre")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Editar Bruno" }));
  expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
    "Bruno",
  );
});

it("requires a selected site location and submits the map coordinates through the existing API", async () => {
  Object.defineProperty(L.Browser, "svg", { value: true, configurable: true });
  const saved: any[] = [];
  let map!: L.Map;
  L.Map.addInitHook(function (this: L.Map) {
    map = this;
  });
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path === "/api/sites") {
      saved.push(JSON.parse(String(options?.body)));
      return new Response('{"ok":true}');
    }
    return new Response(
      JSON.stringify({
        email: "admin@example.com",
        employees: [],
        sites: [],
        attendance: [],
      }),
    );
  });
  render(<BasicApp />);
  fireEvent.click(await screen.findByRole("link", { name: "Sedes" }));
  fireEvent.click(screen.getByRole("button", { name: "Nueva sede" }));
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "Cipolletti" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(saved).toHaveLength(0);
  expect(screen.getByRole("alert").textContent).toContain("Elegí la ubicación");
  const { act } = await import("@testing-library/react");
  act(() => map.fire("click", { latlng: L.latLng(-38.9406, -67.9956) }));
  fireEvent.change(screen.getByLabelText("Radio permitido (metros)"), {
    target: { value: "175" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() =>
    expect(saved).toEqual([
      {
        name: "Cipolletti",
        active: true,
        latitude: -38.9406,
        longitude: -67.9956,
        radius: 175,
      },
    ]),
  );
});
