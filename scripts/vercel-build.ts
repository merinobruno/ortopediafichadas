import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function runBuild(
  environment: string | undefined,
  launch: (command: string) => number = (command) => {
    const result = spawnSync(command, { shell: true, stdio: "inherit" });
    return result.status ?? 1;
  },
): number {
  // Commands are fixed literals. Credentials remain in the inherited environment.
  return launch(
    environment === "production"
      ? 'npx convex deploy --cmd "npm run build"'
      : "npm run build",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runBuild(process.env.VERCEL_ENV);
}
