import React, { useEffect, useState } from "react";
import "./fichar.css";

type LocationData = {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number | null;
};
type TelegramWebApp = {
  initData: string;
  platform: string;
  ready(): void;
  expand(): void;
  close?(): void;
  onEvent?(name: "deactivated", callback: () => void): void;
  offEvent?(name: "deactivated", callback: () => void): void;
  LocationManager?: {
    isInited: boolean;
    init(callback: () => void): void;
    isLocationAvailable: boolean;
    getLocation(callback: (location: LocationData | null) => void): void;
  };
};
const webApp = () =>
  (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
    ?.WebApp;

class ReopenRequired extends Error {}

async function currentTelegramLocation(
  app: TelegramWebApp,
): Promise<LocationData> {
  const manager = app.LocationManager;
  if (!manager)
    throw new Error(
      "Tu Telegram no ofrece ubicación. Actualizá la app e intentá de nuevo.",
    );
  let timeout: number | undefined;
  let interrupt!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () =>
      reject(
        new ReopenRequired(
          "La solicitud de ubicación se interrumpió. Cerrá Fichar y volvé a abrirlo desde el bot.",
        ),
      );
  });
  const onVisibility = () => {
    if (document.hidden) interrupt();
  };
  document.addEventListener("visibilitychange", onVisibility);
  app.onEvent?.("deactivated", interrupt);
  const waitForSdk = <T,>(
    stage: "preparar" | "entregar",
    request: (callback: (value: T) => void) => void,
  ) =>
    Promise.race([
      new Promise<T>((resolve, reject) => {
        timeout = window.setTimeout(
          () =>
            reject(
              new ReopenRequired(
                `Telegram demoró en ${stage} la ubicación. Cerrá Fichar y volvé a abrirlo desde el bot.`,
              ),
            ),
          12000,
        );
        request((value) => {
          window.clearTimeout(timeout);
          resolve(value);
        });
      }),
      interrupted,
    ]);
  let location: LocationData;
  try {
    // Telegram's SDK does not call init's callback a second time once isInited.
    if (!manager.isInited)
      await waitForSdk<void>("preparar", (done) => manager.init(done));
    if (!manager.isLocationAvailable)
      throw new Error(
        "La ubicación no está disponible en este teléfono. Revisá los permisos de Telegram.",
      );
    const result = await waitForSdk<LocationData | null>("entregar", (done) =>
      manager.getLocation(done),
    );
    if (!result)
      throw new Error(
        "No se obtuvo la ubicación. Permití el acceso en Telegram e intentá de nuevo.",
      );
    location = result;
  } finally {
    window.clearTimeout(timeout);
    document.removeEventListener("visibilitychange", onVisibility);
    app.offEvent?.("deactivated", interrupt);
  }
  if (
    !Number.isFinite(location.horizontal_accuracy) ||
    (location.horizontal_accuracy ?? 0) <= 0 ||
    location.horizontal_accuracy! > 100
  )
    throw new Error(
      "La ubicación es poco precisa. Acercate a una ventana y volvé a intentar.",
    );
  return location;
}

async function post(path: string, body: object) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object")
    throw new Error("El servicio no está disponible. Intentá nuevamente.");
  if (!response.ok) {
    const error =
      "error" in data && typeof data.error === "string" ? data.error : "";
    if (error === "Abrí Fichar desde Telegram nuevamente.")
      throw new ReopenRequired(
        "La sesión de Telegram venció. Abrí Fichar de nuevo desde el bot.",
      );
    if (error.includes("Telegram")) throw new Error(error);
    if (error === "link_inactive")
      throw new Error(
        "Tu cuenta de Telegram ya no está vinculada. Consultá a RRHH.",
      );
    if (error === "location_invalid" || error === "accuracy_outside_site")
      throw new Error(
        "La ubicación es poco precisa o está fuera de la sede. Intentá de nuevo desde el lugar de trabajo.",
      );
    if (error === "attendance_rejected")
      throw new Error(
        "La fichada no corresponde al estado actual. Consultá a RRHH si ya tenés una entrada abierta.",
      );
    if (error === "challenge_expired" || error === "challenge_invalid")
      throw new Error("La confirmación venció. Intentá de nuevo.");
    throw new Error("No se pudo registrar la fichada. Intentá de nuevo.");
  }
  return data;
}

export default function FicharApp() {
  const app = webApp();
  const available =
    !!app?.initData && (app.platform === "android" || app.platform === "ios");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState("");
  const [reopenRequired, setReopenRequired] = useState(false);
  useEffect(() => {
    if (available) {
      app!.ready();
      app!.expand();
    }
  }, [available, app]);

  async function register(kind: "entrada" | "salida") {
    if (!app || busy || reopenRequired) return;
    setBusy(true);
    setMessage("");
    setReceipt("");
    try {
      const location = await currentTelegramLocation(app);
      const challenge = (await post("/api/phone/challenge", {
        initData: app.initData,
        kind,
      })) as { challenge?: string };
      if (!challenge.challenge)
        throw new Error("No se pudo confirmar la solicitud. Intentá de nuevo.");
      const result = (await post("/api/phone/submit", {
        initData: app.initData,
        challenge: challenge.challenge,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.horizontal_accuracy,
      })) as { kind?: string; siteName?: string; timestamp?: number };
      if (!result.kind || !result.siteName || !result.timestamp)
        throw new Error("No se pudo confirmar la fichada.");
      const label = result.kind === "entrada" ? "Entrada" : "Salida";
      setReceipt(
        `${label} registrada en ${result.siteName} · ${new Date(result.timestamp).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`,
      );
    } catch (error) {
      if (error instanceof ReopenRequired) setReopenRequired(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo registrar la fichada. Intentá de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="fichar-page">
      <header className="fichar-header">
        <div className="fichar-mark">C</div>
        <div>
          <strong>Carahue</strong>
          <span>PERSONAS Y ASISTENCIA</span>
        </div>
      </header>
      <section className="fichar-card">
        <p className="fichar-kicker">ASISTENCIA</p>
        <h1>Fichar desde tu teléfono</h1>
        <p className="fichar-intro">
          Elegí una acción. Telegram pedirá tu ubicación actual para validarla
          con la sede.
        </p>
        {available ? (
          <>
            <div className="fichar-actions">
              <button
                disabled={busy || reopenRequired}
                onClick={() => void register("entrada")}
              >
                Registrar entrada
              </button>
              <button
                disabled={busy || reopenRequired}
                className="fichar-secondary"
                onClick={() => void register("salida")}
              >
                Registrar salida
              </button>
            </div>
            {busy && (
              <p className="fichar-note" role="status">
                Comprobando ubicación y registrando fichada…
              </p>
            )}
            {receipt && (
              <p className="fichar-success" role="status">
                {receipt}
              </p>
            )}
            {message && (
              <p className="fichar-error" role="alert">
                {message}
              </p>
            )}
            {reopenRequired && (
              <button className="fichar-close" onClick={() => app?.close?.()}>
                Cerrar Fichar
              </button>
            )}
          </>
        ) : (
          <p className="fichar-error" role="alert">
            Abrí este botón desde Telegram en tu teléfono para fichar.
          </p>
        )}
      </section>
      <p className="fichar-footer">
        Si tu ubicación no está disponible o es poco precisa, revisá los
        permisos y volvé a intentar.
      </p>
    </main>
  );
}
