// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import FicharApp from "./FicharApp";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function telegramWithLocation(
  getLocation?: (done: (value: object) => void) => void,
) {
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "android",
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      LocationManager: {
        isInited: true,
        isLocationAvailable: true,
        init: vi.fn(),
        getLocation:
          getLocation ??
          ((done: (value: object) => void) =>
            done({
              latitude: -34.6,
              longitude: -58.4,
              horizontal_accuracy: 12,
            })),
      },
    },
  });
}

it.each([
  ["entry_already_open", "Ya tenés una entrada abierta"],
  ["entry_missing", "No hay una entrada abierta"],
  ["exit_wrong_site", "sede donde hiciste la entrada"],
  ["outside_active_site", "fuera de las sedes habilitadas"],
  ["attendance_out_of_order", "no sigue a la última registrada"],
  ["coordinates_invalid", "ubicación inválida"],
  ["accuracy_invalid", "precisión suficiente"],
  ["accuracy_outside_site", "dentro de la sede con la precisión actual"],
  ["challenge_expired", "La confirmación venció"],
  ["challenge_invalid", "No pudimos confirmar esta solicitud"],
])(
  "explains phone rejection %s without collapsing its cause",
  async (reason, copy) => {
    telegramWithLocation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path.endsWith("challenge")
          ? Response.json({ ok: true, challenge: "a".repeat(64) })
          : Response.json({ error: reason }, { status: 409 }),
      ),
    );
    render(<FicharApp />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findByRole("alert")).textContent).toContain(copy);
  },
);

it.each([
  ["telegram_auth_expired", "sesión de Telegram venció"],
  ["telegram_auth_invalid", "No pudimos verificar tu acceso desde Telegram"],
])(
  "distinguishes Telegram auth failure %s and requires reopening",
  async (reason, copy) => {
    telegramWithLocation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: reason }, { status: 401 })),
    );
    render(<FicharApp />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findByRole("alert")).textContent).toContain(copy);
    expect(screen.getByRole("button", { name: "Cerrar Fichar" })).toBeTruthy();
  },
);

it("does not expose SDK errors and treats an unknown submit result as uncertain", async () => {
  telegramWithLocation(() => {
    throw new Error("private SDK detail");
  });
  vi.stubGlobal("fetch", vi.fn());
  const { unmount } = render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Telegram no pudo obtener la ubicación",
  );
  expect(screen.getByRole("alert").textContent).not.toContain(
    "private SDK detail",
  );
  unmount();
  cleanup();
  telegramWithLocation();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.endsWith("challenge")
        ? Response.json({ ok: true, challenge: "a".repeat(64) })
        : Promise.reject(new Error("private network detail")),
    ),
  );
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Pedí a RRHH que revise la asistencia antes de volver a intentar",
  );
  expect(screen.getByRole("alert").textContent).not.toContain(
    "private network detail",
  );
});

it.each([
  [
    "non-JSON response",
    () => new Response("upstream failure", { status: 502 }),
  ],
  ["malformed success", () => Response.json({ ok: true })],
])(
  "treats %s after submit as an uncertain attendance result",
  async (_, submitResponse) => {
    telegramWithLocation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path.endsWith("challenge")
          ? Response.json({ ok: true, challenge: "a".repeat(64) })
          : submitResponse(),
      ),
    );
    render(<FicharApp />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Pedí a RRHH que revise la asistencia antes de volver a intentar",
    );
  },
);

it("requires Telegram on a phone and does not offer a browser location fallback", () => {
  render(<FicharApp />);
  expect(screen.getByRole("alert").textContent).toContain("Telegram");
  expect(
    screen.queryByRole("button", { name: "Registrar entrada" }),
  ).toBeNull();
});

it("does not display a receipt for wrong response types after submit", async () => {
  telegramWithLocation();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.endsWith("challenge")
        ? Response.json({ ok: true, challenge: "a".repeat(64) })
        : Response.json({
            ok: true,
            kind: "unknown",
            siteName: "Central",
            timestamp: "not-a-time",
          }),
    ),
  );
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Pedí a RRHH que revise la asistencia antes de volver a intentar",
  );
  expect(screen.queryByText(/registrada en Central/)).toBeNull();
});

it("does not blame location for an unexpected failure after submit begins", async () => {
  telegramWithLocation();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.endsWith("challenge")
        ? Response.json({ ok: true, challenge: "a".repeat(64) })
        : {
            ok: true,
            json: async () => ({
              get kind() {
                throw new Error("private submit detail");
              },
            }),
          },
    ),
  );
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Pedí a RRHH que revise la asistencia antes de volver a intentar",
  );
  expect(screen.getByRole("alert").textContent).not.toContain("ubicación");
});

it("explains unavailable or denied Telegram location and never calls the attendance API", async () => {
  const post = vi.fn();
  vi.stubGlobal("fetch", post);
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "android",
      ready: vi.fn(),
      expand: vi.fn(),
      LocationManager: {
        init: (done: () => void) => done(),
        isLocationAvailable: true,
        getLocation: (done: (value: null) => void) => done(null),
      },
    },
  });
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  expect((await screen.findByRole("alert")).textContent).toContain("ubicación");
  expect(post).not.toHaveBeenCalled();
});

it("asks for a better fix when Telegram reports coarse accuracy", async () => {
  const post = vi.fn();
  vi.stubGlobal("fetch", post);
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "ios",
      ready: vi.fn(),
      expand: vi.fn(),
      LocationManager: {
        init: (done: () => void) => done(),
        isLocationAvailable: true,
        getLocation: (done: (value: object) => void) =>
          done({ latitude: -34.6, longitude: -58.4, horizontal_accuracy: 250 }),
      },
    },
  });
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar salida" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "poco precisa",
  );
  expect(post).not.toHaveBeenCalled();
});

it("submits Telegram location with reported accuracy and displays one receipt", async () => {
  const post = vi.fn(async (path: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    expect(body.initData).toBe("signed");
    if (path === "/api/phone/challenge")
      return Response.json({
        ok: true,
        challenge: "a".repeat(64),
        expiresAt: Date.now() + 60000,
        employeeName: "Ana",
      });
    expect(path).toBe("/api/phone/submit");
    expect(body).toMatchObject({
      challenge: "a".repeat(64),
      latitude: -34.6,
      longitude: -58.4,
      accuracy: 12,
    });
    return Response.json({
      ok: true,
      kind: "entrada",
      siteName: "Central",
      timestamp: Date.now(),
      receiptId: "receipt",
    });
  });
  vi.stubGlobal("fetch", post);
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "android",
      ready: vi.fn(),
      expand: vi.fn(),
      LocationManager: {
        init: (done: () => void) => done(),
        isLocationAvailable: true,
        getLocation: (done: (value: object) => void) =>
          done({ latitude: -34.6, longitude: -58.4, horizontal_accuracy: 12 }),
      },
    },
  });
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Entrada registrada",
    ),
  );
  expect(post).toHaveBeenCalledTimes(2);
});

it("reuses an initialized Telegram LocationManager on a later check-in", async () => {
  let initialized = false;
  const manager = {
    get isInited() {
      return initialized;
    },
    isLocationAvailable: true,
    init: vi.fn((done: () => void) => {
      if (!initialized) {
        initialized = true;
        done();
      }
      // A second init does not necessarily produce a second SDK callback.
    }),
    getLocation: vi.fn((done: (value: object) => void) =>
      done({ latitude: -34.6, longitude: -58.4, horizontal_accuracy: 12 }),
    ),
  };
  const post = vi.fn(async (path: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    return path === "/api/phone/challenge"
      ? Response.json({ ok: true, challenge: "a".repeat(64) })
      : Response.json({
          ok: true,
          kind: body.challenge ? "entrada" : "salida",
          siteName: "Central",
          timestamp: Date.now(),
        });
  });
  vi.stubGlobal("fetch", post);
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "android",
      ready: vi.fn(),
      expand: vi.fn(),
      LocationManager: manager,
    },
  });
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Registrar salida" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(4), { timeout: 500 });
  expect(manager.init).toHaveBeenCalledTimes(1);
  expect(manager.getLocation).toHaveBeenCalledTimes(2);
});

it("aborts a pending native request when Telegram backgrounds and ignores its late callback", async () => {
  let deactivate: (() => void) | undefined;
  let deliver: ((value: object) => void) | undefined;
  const post = vi.fn();
  vi.stubGlobal("fetch", post);
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "android",
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      onEvent: (name: string, handler: () => void) => {
        if (name === "deactivated") deactivate = handler;
      },
      offEvent: vi.fn(),
      LocationManager: {
        isInited: true,
        isLocationAvailable: true,
        init: vi.fn(),
        getLocation: (callback: (value: object) => void) => {
          deliver = callback;
        },
      },
    },
  });
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  await waitFor(() => expect(deliver).toBeDefined());
  act(() => deactivate?.());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Cerrá Fichar",
  );
  act(() =>
    deliver?.({ latitude: -34.6, longitude: -58.4, horizontal_accuracy: 12 }),
  );
  expect(post).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Registrar entrada" }),
  ).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Cerrar Fichar" })).toBeTruthy();
});

it("requires reopening when the server rejects an expired Telegram launch", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "Abrí Fichar desde Telegram nuevamente." },
        { status: 401 },
      ),
    ),
  );
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "android",
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      LocationManager: {
        isInited: true,
        isLocationAvailable: true,
        init: vi.fn(),
        getLocation: (done: (value: object) => void) =>
          done({ latitude: -34.6, longitude: -58.4, horizontal_accuracy: 12 }),
      },
    },
  });
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "volvé a abrirlo desde el bot",
  );
  expect(screen.getByRole("button", { name: "Cerrar Fichar" })).toBeTruthy();
});

it("locks a timed-out native request so a late SDK callback cannot submit", async () => {
  vi.useFakeTimers();
  let deliver: ((value: object) => void) | undefined;
  const post = vi.fn();
  vi.stubGlobal("fetch", post);
  vi.stubGlobal("Telegram", {
    WebApp: {
      initData: "signed",
      platform: "android",
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
      LocationManager: {
        isInited: true,
        isLocationAvailable: true,
        init: vi.fn(),
        getLocation: (callback: (value: object) => void) => {
          deliver = callback;
        },
      },
    },
  });
  render(<FicharApp />);
  fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(screen.getByRole("alert").textContent).toContain("Cerrá Fichar");
  expect(
    screen.getByRole("button", { name: "Registrar entrada" }),
  ).toHaveProperty("disabled", true);
  act(() =>
    deliver?.({ latitude: -34.6, longitude: -58.4, horizontal_accuracy: 12 }),
  );
  expect(post).not.toHaveBeenCalled();
});
