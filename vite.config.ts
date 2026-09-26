import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig(({ mode }) => ({
  server: { host: "127.0.0.1" },
  build: {
    outDir: mode === "legacy" ? "dist-legacy" : "dist",
    rollupOptions: {
      input:
        mode === "legacy"
          ? [resolve("index.html")]
          : [resolve("index.html"), resolve("fichar.html")],
    },
  },
  plugins:
    mode === "legacy"
      ? [
          {
            name: "legacy-entry",
            transformIndexHtml: {
              order: "pre" as const,
              handler(html: string) {
                return html.replace("/src/main.tsx", "/src/legacy-main.tsx");
              },
            },
          },
        ]
      : [],
}));
