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
it("shows only the three approved sections and saves an employee", async () => {
  let employees: any[] = [];
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path === "/api/employees") {
      const employee = JSON.parse(String(options?.body));
      employees = [{ _id: "e1", ...employee }];
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
  expect(screen.getAllByRole("link")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Nuevo empleado" }));
  fireEvent.change(screen.getByLabelText("Nombre"), {
    target: { value: "Ana" },
  });
  fireEvent.change(screen.getByLabelText("Teléfono internacional"), {
    target: { value: "+5491112345678" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() =>
    expect(screen.getByRole("cell", { name: "Ana" })).toBeTruthy(),
  );
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
          { _id: "a", name: "Ana", phone: "5491112345678", active: true },
          { _id: "b", name: "Bruno", phone: "5491187654321", active: true },
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
