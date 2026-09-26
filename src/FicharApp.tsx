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
  LocationManager?: {
    init(callback: () => void): void;
    isLocationAvailable: boolean;
    getLocation(callback: (location: LocationData | null) => void): void;
  };
};
const webApp = () =>
  (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
    ?.WebApp;

async function currentTelegramLocation(
  app: TelegramWebApp,
): Promise<LocationData> {
  const manager = app.LocationManager;
  if (!manager)
    throw new Error(
      "Tu Telegram no ofrece ubicación. Actualizá la app e intentá de nuevo.",
    );
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () =>
        reject(new Error("La ubicación demoró demasiado. Intentá de nuevo.")),
      12000,
    );
    manager.init(() => {
      window.clearTimeout(timeout);
      resolve();
    });
  });
  if (!manager.isLocationAvailable)
    throw new Error(
      "La ubicación no está disponible en este teléfono. Revisá los permisos de Telegram.",
    );
  const location = await new Promise<LocationData>((resolve, reject) => {
    const timeout = window.setTimeout(
      () =>
        reject(new Error("La ubicación demoró demasiado. Intentá de nuevo.")),
      12000,
    );
    manager.getLocation((value) => {
      window.clearTimeout(timeout);
      if (value) resolve(value);
      else
        reject(
          new Error(
            "No se obtuvo la ubicación. Permití el acceso en Telegram e intentá de nuevo.",
          ),
        );
    });
  });
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
  useEffect(() => {
    if (available) {
      app!.ready();
      app!.expand();
    }
  }, [available, app]);

  async function register(kind: "entrada" | "salida") {
    if (!app || busy) return;
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
              <button disabled={busy} onClick={() => void register("entrada")}>
                Registrar entrada
              </button>
              <button
                disabled={busy}
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
