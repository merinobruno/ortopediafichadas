// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { afterEach, beforeAll, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import L from "leaflet";
import SiteLocationPicker from "./SiteLocationPicker";

const maps: L.Map[] = [];
beforeAll(() => {
  // jsdom does not advertise SVG rendering, although it can hold real SVG DOM.
  Object.defineProperty(L.Browser, "svg", { value: true, configurable: true });
  L.Map.addInitHook(function (this: L.Map) {
    maps.push(this);
  });
});
afterEach(() => {
  cleanup();
  maps.length = 0;
});
function currentMap() {
  return maps[maps.length - 1];
}
function fields(container: HTMLElement) {
  return {
    latitude: (container.querySelector('[name="latitude"]') as HTMLInputElement)
      .value,
    longitude: (
      container.querySelector('[name="longitude"]') as HTMLInputElement
    ).value,
  };
}
function layer<T extends L.Layer>(kind: new (...args: any[]) => T): T {
  let result!: T;
  currentMap().eachLayer((item) => {
    if (item instanceof kind) result = item;
  });
  return result;
}
it("does not select the default center until an explicit map click", () => {
  const { container } = render(<SiteLocationPicker disabled={false} />);
  expect(fields(container)).toEqual({ latitude: "", longitude: "" });
  act(() =>
    currentMap().fire("click", { latlng: L.latLng(-38.9406, -67.9956) }),
  );
  expect(fields(container)).toEqual({
    latitude: "-38.9406",
    longitude: "-67.9956",
  });
  expect(layer(L.Marker).getLatLng()).toMatchObject({
    lat: -38.9406,
    lng: -67.9956,
  });
  expect(layer(L.Circle).getRadius()).toBe(100);
  expect(screen.getByRole("link", { name: "OpenStreetMap" })).toBeTruthy();
  expect(layer(L.TileLayer).options.referrerPolicy).toBe(
    "strict-origin-when-cross-origin",
  );
});
it("updates coordinates from marker drag and the visible circle from radius input", () => {
  const { container } = render(
    <SiteLocationPicker
      initialLocation={{ latitude: -38.95, longitude: -68.06 }}
      initialRadius={150}
      disabled={false}
    />,
  );
  expect(fields(container)).toEqual({
    latitude: "-38.95",
    longitude: "-68.06",
  });
  act(() => {
    layer(L.Marker).setLatLng([-38.96, -68.07]).fire("dragend");
  });
  expect(fields(container)).toEqual({
    latitude: "-38.96",
    longitude: "-68.07",
  });
  fireEvent.change(screen.getByLabelText("Radio permitido (metros)"), {
    target: { value: "250" },
  });
  expect(layer(L.Circle).getRadius()).toBe(250);
  expect(layer(L.Circle).getLatLng()).toMatchObject({
    lat: -38.96,
    lng: -68.07,
  });
});
it("lets keyboard users choose the panned map center and blocks selection while saving", () => {
  const { container, rerender } = render(
    <SiteLocationPicker disabled={false} />,
  );
  act(() => currentMap().setView([-38.95, -68.06], 15));
  fireEvent.click(
    screen.getByRole("button", { name: "Usar el centro del mapa" }),
  );
  expect(fields(container)).toEqual({
    latitude: "-38.95",
    longitude: "-68.06",
  });
  rerender(<SiteLocationPicker disabled />);
  act(() => currentMap().fire("click", { latlng: L.latLng(-30, -60) }));
  expect(fields(container)).toEqual({
    latitude: "-38.95",
    longitude: "-68.06",
  });
  expect(layer(L.Marker).dragging!.enabled()).toBe(false);
  expect(
    (screen.getByLabelText("Radio permitido (metros)") as HTMLInputElement)
      .disabled,
  ).toBe(true);
});
it("preserves saved coordinates when tiles fail and provides a validated numeric fallback", () => {
  const { container } = render(
    <SiteLocationPicker
      initialLocation={{ latitude: 0, longitude: 0 }}
      disabled={false}
    />,
  );
  act(() => layer(L.TileLayer).fire("tileerror"));
  expect(screen.getByRole("status").textContent).toContain("No se pudo cargar");
  expect(fields(container)).toEqual({ latitude: "0", longitude: "0" });
  fireEvent.click(screen.getByText("Ingresar coordenadas manualmente"));
  fireEvent.change(screen.getByLabelText("Latitud"), {
    target: { value: "91" },
  });
  fireEvent.change(screen.getByLabelText("Longitud"), {
    target: { value: "-68" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar coordenadas" }));
  expect(fields(container)).toEqual({ latitude: "0", longitude: "0" });
  expect(screen.getByRole("alert").textContent).toContain(
    "coordenadas válidas",
  );
  fireEvent.change(screen.getByLabelText("Latitud"), {
    target: { value: "-38.95" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar coordenadas" }));
  expect(fields(container)).toEqual({ latitude: "-38.95", longitude: "-68" });
});
it("cleans up obsolete Leaflet listeners during StrictMode remount", () => {
  const { container } = render(
    <StrictMode>
      <SiteLocationPicker disabled={false} />
    </StrictMode>,
  );
  expect(maps).toHaveLength(2);
  act(() => maps[0].fire("click", { latlng: L.latLng(-30, -60) }));
  expect(fields(container)).toEqual({ latitude: "", longitude: "" });
  act(() => currentMap().fire("click", { latlng: L.latLng(-38.95, -68.06) }));
  expect(fields(container)).toEqual({
    latitude: "-38.95",
    longitude: "-68.06",
  });
  expect(container.querySelectorAll(".leaflet-tile-pane")).toHaveLength(1);
});
