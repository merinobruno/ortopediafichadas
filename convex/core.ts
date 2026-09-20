export function normalizePhone(value: string): string {
  const phone = value.trim().replace(/[\s()+-]/g, "");
  if (!/^[1-9]\d{7,14}$/.test(phone))
    throw new Error(
      "Use an international phone number (country code included).",
    );
  return phone;
}
export type Site = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  active: boolean;
};
export function validCoordinates(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}
export function distance(
  a: Pick<Site, "latitude" | "longitude">,
  b: Pick<Site, "latitude" | "longitude">,
) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((a.latitude - b.latitude) * r) / 2) ** 2 +
    Math.cos(a.latitude * r) *
      Math.cos(b.latitude * r) *
      Math.sin(((a.longitude - b.longitude) * r) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function decideAttendance(input: {
  kind: "entrada" | "salida";
  latitude: number;
  longitude: number;
  timestamp: number;
  now: number;
  active: boolean;
  sites: Site[];
  lastTimestamp?: number;
  open?: { siteId: string } | null;
}): Site {
  if (!input.active) throw new Error("Employee is not active.");
  if (!validCoordinates(input.latitude, input.longitude))
    throw new Error("Invalid location.");
  if (
    !Number.isFinite(input.timestamp) ||
    input.timestamp < input.now - 600000 ||
    input.timestamp > input.now + 60000 ||
    input.timestamp <= (input.lastTimestamp ?? 0)
  )
    throw new Error(
      "Stale or out-of-order message. Send a new command and location.",
    );
  if (input.kind === "entrada" && input.open)
    throw new Error("An entry is already open.");
  if (input.kind === "salida" && !input.open)
    throw new Error("There is no open entry.");
  const sites = input.sites
    .filter((s) => s.active && distance(input, s) <= s.radius)
    .sort(
      (a, b) =>
        distance(input, a) - distance(input, b) || a.id.localeCompare(b.id),
    );
  const site =
    input.kind === "salida"
      ? sites.find((s) => s.id === input.open!.siteId)
      : sites[0];
  if (!site)
    throw new Error(
      input.kind === "salida"
        ? "Exit must be at the entry site, inside its radius."
        : "Location is outside every active site.",
    );
  return site;
}
