import React, { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import "./fichar.css";
import { CarahueLogo } from "./CarahueBrand";

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

class DisplayError extends Error {}
class ReopenRequired extends DisplayError {}

const uncertainSubmit =
  "No pudimos confirmar si la fichada se registró. Pedí a RRHH que revise la asistencia antes de volver a intentar.";
const unavailableService =
  "No pudimos iniciar la fichada. Intentá de nuevo; si sigue pasando, avisá a RRHH.";

async function currentTelegramLocation(
  app: TelegramWebApp,
): Promise<LocationData> {
  const manager = app.LocationManager;
  if (!manager)
    throw new DisplayError(
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
      throw new DisplayError(
        "La ubicación no está disponible en este teléfono. Revisá los permisos de Telegram.",
      );
    const result = await waitForSdk<LocationData | null>("entregar", (done) =>
      manager.getLocation(done),
    );
    if (!result)
      throw new DisplayError(
        "No se obtuvo la ubicación. Permití el acceso en Telegram e intentá de nuevo.",
      );
    location = result;
  } catch (error) {
    if (error instanceof DisplayError) throw error;
    throw new DisplayError(
      "Telegram no pudo obtener la ubicación. Revisá los permisos y volvé a intentar.",
    );
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
    throw new DisplayError(
      "La ubicación es poco precisa. Acercate a una ventana y volvé a intentar.",
    );
  return location;
}

async function post(path: string, body: object) {
  const submitting = path === "/api/phone/submit";
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body),
    });
  } catch {
    throw new DisplayError(submitting ? uncertainSubmit : unavailableService);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object")
    throw new DisplayError(submitting ? uncertainSubmit : unavailableService);
  if (!response.ok) {
    const error =
      "error" in data && typeof data.error === "string" ? data.error : "";
    if (error === "telegram_auth_expired")
      throw new ReopenRequired(
        "Esta sesión de Telegram venció. Cerrá Fichar y volvé a abrirlo desde el bot.",
      );
    if (
      error === "telegram_auth_invalid" ||
      error === "Abrí Fichar desde Telegram nuevamente."
    )
      throw new ReopenRequired(
        "No pudimos verificar tu acceso desde Telegram. Cerrá Fichar y volvé a abrirlo desde el bot.",
      );
    if (
      error === "Tu cuenta de Telegram no está vinculada a un empleado activo."
    )
      throw new DisplayError(
        "Tu cuenta de Telegram no está vinculada a un empleado activo. Pedí ayuda a RRHH.",
      );
    if (error === "link_inactive")
      throw new DisplayError(
        "Tu cuenta de Telegram ya no está vinculada. Consultá a RRHH.",
      );
    if (error === "coordinates_invalid")
      throw new DisplayError(
        "Telegram entregó una ubicación inválida. Cerrá Fichar y volvé a abrirlo desde el bot.",
      );
    if (error === "accuracy_invalid")
      throw new DisplayError(
        "La ubicación no tiene precisión suficiente. Esperá una ubicación más precisa y volvé a intentar.",
      );
    if (error === "accuracy_outside_site")
      throw new DisplayError(
        "No podemos confirmar que estés dentro de la sede con la precisión actual. Acercate al centro de la sede o esperá una ubicación más precisa.",
      );
    const attendanceMessages: Record<string, string> = {
      entry_already_open:
        "Ya tenés una entrada abierta. Si no corresponde, consultá a RRHH.",
      entry_missing:
        "No hay una entrada abierta para registrar la salida. Consultá a RRHH si ya fichaste.",
      exit_wrong_site:
        "La salida debe registrarse en la sede donde hiciste la entrada. Volvé a esa sede o consultá a RRHH.",
      outside_active_site:
        "Tu ubicación está fuera de las sedes habilitadas. Acercate a una sede habilitada y volvé a intentar.",
      attendance_out_of_order:
        "La hora de esta fichada no sigue a la última registrada. Consultá a RRHH antes de reintentar.",
    };
    if (Object.hasOwn(attendanceMessages, error))
      throw new DisplayError(attendanceMessages[error]);
    if (error === "challenge_expired")
      throw new DisplayError(
        "La confirmación venció. Tocá Entrada o Salida para iniciar otra.",
      );
    if (error === "challenge_invalid")
      throw new DisplayError(
        "No pudimos confirmar esta solicitud. Pedí a RRHH que revise la asistencia antes de volver a intentar.",
      );
    throw new DisplayError(submitting ? uncertainSubmit : unavailableService);
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
    let phase: "location" | "challenge" | "submit" = "location";
    setBusy(true);
    setMessage("");
    setReceipt("");
    try {
      const location = await currentTelegramLocation(app);
      phase = "challenge";
      const challenge = (await post("/api/phone/challenge", {
        initData: app.initData,
        kind,
      })) as { challenge?: string };
      if (!challenge.challenge) throw new DisplayError(unavailableService);
      phase = "submit";
      const result = (await post("/api/phone/submit", {
        initData: app.initData,
        challenge: challenge.challenge,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.horizontal_accuracy,
      })) as { kind?: string; siteName?: string; timestamp?: number };
      if (
        result.kind !== kind ||
        typeof result.siteName !== "string" ||
        !result.siteName.trim() ||
        typeof result.timestamp !== "number" ||
        !Number.isFinite(result.timestamp) ||
        !Number.isFinite(new Date(result.timestamp).getTime())
      )
        throw new DisplayError(uncertainSubmit);
      const label = result.kind === "entrada" ? "Entrada" : "Salida";
      setReceipt(
        `${label} registrada en ${result.siteName} · ${new Date(result.timestamp).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`,
      );
    } catch (error) {
      if (error instanceof ReopenRequired) setReopenRequired(true);
      setMessage(
        error instanceof DisplayError
          ? error.message
          : phase === "submit"
            ? uncertainSubmit
            : phase === "challenge"
              ? unavailableService
              : "Telegram no pudo obtener la ubicación. Revisá los permisos y volvé a intentar.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="fichar-page">
      <section className="fichar-card">
        <div className="fichar-brand">
          <CarahueLogo className="fichar-logo" />
          <span>Gestión de asistencia</span>
        </div>
        <div className="fichar-content">
          <div className="fichar-heading">
            <Clock3 size={26} aria-hidden="true" />
            <div>
              <h1>Fichar desde tu teléfono</h1>
              <p className="fichar-intro">
                Elegí una acción. Telegram pedirá tu ubicación actual para
                validarla con la sede.
              </p>
            </div>
          </div>
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
        </div>
      </section>
      <p className="fichar-footer">
        Si tu ubicación no está disponible o es poco precisa, revisá los
        permisos y volvé a intentar.
      </p>
    </main>
  );
}
