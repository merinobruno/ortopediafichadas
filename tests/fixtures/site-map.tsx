// Local-only browser fixture. This HTML is not a Vite production entrypoint.
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import BasicApp from "../../src/BasicApp";

const data = {
  email: "Vista local de prueba",
  employees: [],
  attendance: [],
  sites: [
    {
      _id: "fixture-site",
      name: "Sede de prueba · Cipolletti",
      latitude: -38.9406,
      longitude: -67.9956,
      radius: 100,
      active: true,
    },
  ],
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  if (String(input) === "/api/data") return Response.json(data);
  if (String(input) === "/api/sites") {
    const { id, ...fields } = JSON.parse(String(options?.body));
    const site = { _id: id ?? `fixture-${data.sites.length}`, ...fields };
    const index = data.sites.findIndex((row) => row._id === id);
    if (index < 0) data.sites.push(site);
    else data.sites[index] = site;
    return Response.json({ ok: true });
  }
  if (String(input).startsWith("/api/"))
    return Response.json(
      { error: "Acción no disponible en esta vista local." },
      { status: 400 },
    );
  return originalFetch(input, options);
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BasicApp />
  </React.StrictMode>,
);
