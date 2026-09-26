import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "convex/**/*.test.ts",
      "src/BasicApp.test.tsx",
      "src/FicharApp.test.tsx",
      "src/SiteLocationPicker.test.tsx",
      "tests/basic/**/*.test.ts",
    ],
    restoreMocks: true,
    unstubEnvs: true,
  },
});
