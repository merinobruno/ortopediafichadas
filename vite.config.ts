import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  server: { host: "127.0.0.1" },
  build: { outDir: mode === "legacy" ? "dist-legacy" : "dist" },
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
