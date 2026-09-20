import { expect, it } from "vitest";
import { runBuild } from "../../scripts/vercel-build";
it("deploys Convex only in production and propagates deployment failure", () => {
  const commands: string[] = [];
  const status = runBuild("production", (command) => {
    commands.push(command);
    return 7;
  });
  expect(commands).toEqual(['npx convex deploy --cmd "npm run build"']);
  expect(status).toBe(7);
});
it.each(["preview", "development", undefined])(
  "builds %s without a deployment or production key",
  (environment) => {
    const commands: string[] = [];
    expect(
      runBuild(environment, (command) => {
        commands.push(command);
        return 0;
      }),
    ).toBe(0);
    expect(commands).toEqual(["npm run build"]);
  },
);
