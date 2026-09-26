import { describe, expect, it } from "vitest";
import { decideAttendance } from "./core";
const site = {
  id: "a",
  name: "Central",
  latitude: -34.6,
  longitude: -58.4,
  radius: 100,
  active: true,
};
const base = {
  kind: "entrada" as const,
  latitude: -34.6,
  longitude: -58.4,
  timestamp: 1000000,
  now: 1000001,
  active: true,
  sites: [site],
};
describe("attendance rules", () => {
  it("allows entry into any active nearby site", () =>
    expect(decideAttendance(base)).toEqual(site));
  it.each([
    { active: false },
    { latitude: 200 },
    { longitude: NaN },
    { latitude: 0 },
    { now: 2000000 },
    { timestamp: 2000000 },
    { lastTimestamp: 1000000 },
    { open: { siteId: "a" } },
    { sites: [{ ...site, active: false }] },
  ])("rejects invalid entry %j", (patch) =>
    expect(() => decideAttendance({ ...base, ...patch })).toThrow(),
  );
  it("rejects exit without entry and exit at another site", () => {
    expect(() => decideAttendance({ ...base, kind: "salida" })).toThrow();
    expect(() =>
      decideAttendance({ ...base, kind: "salida", open: { siteId: "b" } }),
    ).toThrow();
  });
  it("accepts exit only at the open entry site", () =>
    expect(
      decideAttendance({ ...base, kind: "salida", open: { siteId: "a" } }),
    ).toEqual(site));
});
