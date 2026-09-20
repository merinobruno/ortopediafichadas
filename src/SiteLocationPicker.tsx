import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Location = { latitude: number; longitude: number };
type Props = {
  initialLocation?: Location;
  initialRadius?: number;
  disabled: boolean;
};
const regionalCenter: L.LatLngTuple = [-38.948, -68.0];
const valid = (location: Location) =>
  Number.isFinite(location.latitude) &&
  Number.isFinite(location.longitude) &&
  Math.abs(location.latitude) <= 90 &&
  Math.abs(location.longitude) <= 180;

export default function SiteLocationPicker({
  initialLocation,
  initialRadius = 100,
  disabled,
}: Props) {
  const [location, setLocation] = useState<Location | null>(
    initialLocation ?? null,
  );
  const [radius, setRadius] = useState(String(initialRadius));
  const [latitude, setLatitude] = useState(
    initialLocation ? String(initialLocation.latitude) : "",
  );
  const [longitude, setLongitude] = useState(
    initialLocation ? String(initialLocation.longitude) : "",
  );
  const [tileError, setTileError] = useState(false);
  const [coordinateError, setCoordinateError] = useState("");
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const choose = useRef((point: L.LatLng) => {});
  choose.current = (point) => {
    if (disabledRef.current) return;
    const wrapped = Math.abs(point.lng) <= 180 ? point : point.wrap();
    const next = { latitude: wrapped.lat, longitude: wrapped.lng };
    if (!valid(next)) return;
    setLocation(next);
    setLatitude(String(next.latitude));
    setLongitude(String(next.longitude));
    setCoordinateError("");
  };

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, {
      scrollWheelZoom: false,
      keyboard: true,
      zoomControl: false,
    }).setView(
      initialLocation
        ? [initialLocation.latitude, initialLocation.longitude]
        : regionalCenter,
      initialLocation ? 17 : 12,
    );
    map.current = instance;
    L.control
      .zoom({ zoomInTitle: "Acercar", zoomOutTitle: "Alejar" })
      .addTo(instance);
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        referrerPolicy: "strict-origin-when-cross-origin",
      },
    )
      .on("tileerror", () => setTileError(true))
      .addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) =>
      choose.current(event.latlng),
    );
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    observer?.observe(element.current);
    return () => {
      observer?.disconnect();
      tiles.off();
      marker.current?.off();
      instance.off();
      instance.remove();
      map.current = null;
      marker.current = null;
      circle.current = null;
    };
    // This editor is keyed by site. Initial coordinates are read once on mount.
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !location) return;
    const point: L.LatLngTuple = [location.latitude, location.longitude];
    if (!marker.current) {
      marker.current = L.marker(point, {
        draggable: !disabled,
        keyboard: true,
        title: "Ubicación de la sede. Arrastrá para moverla.",
        icon: L.divIcon({
          className: "basic-map-marker",
          html: "<span></span>",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .on("dragend", () => {
          if (marker.current) choose.current(marker.current.getLatLng());
        })
        .addTo(instance);
    } else marker.current.setLatLng(point);
    const meters = Number(radius);
    if (
      radius.trim() &&
      Number.isFinite(meters) &&
      meters >= 1 &&
      meters <= 10000
    ) {
      if (!circle.current)
        circle.current = L.circle(point, {
          radius: meters,
          color: "#006c57",
          fillColor: "#006c57",
          fillOpacity: 0.12,
          weight: 2,
          interactive: false,
        }).addTo(instance);
      else circle.current.setLatLng(point).setRadius(meters);
    } else {
      circle.current?.remove();
      circle.current = null;
    }
  }, [location, radius, disabled]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    for (const handler of [
      instance.dragging,
      instance.keyboard,
      instance.doubleClickZoom,
      instance.boxZoom,
      instance.touchZoom,
    ]) {
      if (disabled) handler.disable();
      else handler.enable();
    }
    if (disabled) marker.current?.dragging?.disable();
    else marker.current?.dragging?.enable();
  }, [disabled, location]);

  function applyCoordinates() {
    if (disabled) return;
    const next = { latitude: Number(latitude), longitude: Number(longitude) };
    if (!latitude.trim() || !longitude.trim() || !valid(next)) {
      setCoordinateError(
        "Ingresá coordenadas válidas: latitud entre -90 y 90, longitud entre -180 y 180.",
      );
      return;
    }
    choose.current(L.latLng(next.latitude, next.longitude));
    map.current?.setView(
      [next.latitude, next.longitude],
      Math.max(map.current.getZoom(), 15),
    );
  }
  return (
    <section
      className="basic-location-picker"
      aria-label="Ubicación de la sede"
    >
      <div className="basic-location-heading">
        <h3>Ubicación de la sede</h3>
        <p id="site-map-help">
          Tocá el mapa para ubicar la sede. Podés arrastrar el marcador para
          ajustar el punto.
        </p>
      </div>
      <div className="basic-map-frame">
        <div
          ref={element}
          className="basic-location-map"
          role="region"
          aria-label="Mapa para elegir la ubicación"
          aria-describedby="site-map-help site-map-keyboard"
          inert={disabled}
        />
        <span className="basic-map-center" aria-hidden="true" />
      </div>
      {tileError && (
        <p className="basic-map-warning" role="status">
          No se pudo cargar parte del mapa. Podés conservar la ubicación o
          ingresar coordenadas manualmente.
        </p>
      )}
      <div className="basic-map-selection">
        <p aria-live="polite">
          {location
            ? `Ubicación seleccionada: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
            : "Todavía no elegiste una ubicación."}
        </p>
        <button
          type="button"
          className="basic-secondary"
          disabled={disabled}
          onClick={() => {
            if (map.current) choose.current(map.current.getCenter());
          }}
        >
          Usar el centro del mapa
        </button>
      </div>
      <p id="site-map-keyboard" className="basic-footnote">
        Con teclado: enfocá el mapa, movelo con las flechas y usá + / − para
        acercar o alejar. Después elegí el centro.
      </p>
      <input type="hidden" name="latitude" value={location?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={location?.longitude ?? ""} />
      <label className="basic-map-radius">
        Radio permitido (metros)
        <input
          name="radius"
          type="number"
          min={1}
          max={10000}
          required
          value={radius}
          onChange={(event) => setRadius(event.target.value)}
          disabled={disabled}
        />
      </label>
      <details className="basic-coordinate-fallback">
        <summary>Ingresar coordenadas manualmente</summary>
        <div className="basic-fields">
          <label>
            Latitud
            <input
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              disabled={disabled}
            />
          </label>
          <label>
            Longitud
            <input
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              disabled={disabled}
            />
          </label>
        </div>
        {coordinateError && (
          <p className="basic-error" role="alert">
            {coordinateError}
          </p>
        )}
        <button
          type="button"
          className="basic-secondary"
          onClick={applyCoordinates}
          disabled={disabled}
        >
          Aplicar coordenadas
        </button>
      </details>
    </section>
  );
}
