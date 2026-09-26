// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
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
});

it("requires Telegram on a phone and does not offer a browser location fallback", () => {
  render(<FicharApp />);
  expect(screen.getByRole("alert").textContent).toContain("Telegram");
  expect(
    screen.queryByRole("button", { name: "Registrar entrada" }),
  ).toBeNull();
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
