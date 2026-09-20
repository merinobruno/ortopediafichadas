import { realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { RequestHandler } from "express";

// Vite serves only frontend source. Private application files never reach its
// filesystem middleware, even when an operator places the database under src.
export function frontendFiles(root: string, database: string): RequestHandler {
  const canonical = (p: string) => {
    try {
      return realpathSync(p).toLowerCase();
    } catch {
      return resolve(p).toLowerCase();
    }
  };
  const allowed = ["src", "shared", "node_modules"].map((p) =>
    canonical(resolve(root, p)),
  );
  const db = canonical(database);
  const inside = (p: string, base: string) => {
    const rel = relative(base, p);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  return (req, res, next) => {
    let path = req.url.split("?")[0];
    try {
      for (let i = 0; i < 3; i++) path = decodeURIComponent(path);
    } catch {
      res.sendStatus(403);
      return;
    }
    path = path.replaceAll("\\", "/");
    if (path === "/" || path === "/index.html" || path === "/@vite/client") {
      next();
      return;
    }
    const target = canonical(
      path.startsWith("/@fs/") ? path.slice(5) : resolve(root, "." + path),
    );
    if (
      target === db ||
      target.startsWith(db + "-") ||
      !/\.(tsx?|jsx?|mjs|cjs|css|woff2?|ttf|svg|png|jpe?g|webp|gif|ico|map)$/i.test(
        target,
      ) ||
      !allowed.some((base) => inside(target, base))
    ) {
      res.sendStatus(403);
      return;
    }
    next();
  };
}
