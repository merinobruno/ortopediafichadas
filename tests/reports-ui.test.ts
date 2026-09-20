import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Reports from "../src/Reports";
test("native report attachments use applied filters and cannot export unbounded or loading results", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const original = globalThis.fetch;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const data = {
    overall: {
      visits: 0,
      entryDays: 0,
      measurableVisits: 0,
      netHours: 0,
      openVisits: 0,
      unknownExits: 0,
      unknownPauses: 0,
    },
    byEmployee: [],
    bySite: [],
    details: [],
    approvedOvertimeMinutes: 0,
  };
  let resolveLoad: ((v: Response) => void) | undefined;
  let defer = false;
  globalThis.fetch = (async () =>
    defer
      ? new Promise<Response>((r) => {
          resolveLoad = r;
        })
      : Response.json(data)) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  const anchors = () =>
    [...document.querySelectorAll<HTMLAnchorElement>("a")].filter((a) =>
      ["PDF", "Excel (.xlsx)"].includes(a.textContent!.trim()),
    );
  try {
    await act(async () =>
      root.render(
        React.createElement(Reports, {
          employees: [{ id: "e", name: "Synthetic" }],
          sites: [],
        }),
      ),
    );
    assert.equal(anchors().length, 2);
    const before = anchors().map((a) => a.getAttribute("href"));
    for (const a of anchors()) {
      assert.equal(a.target, "_blank");
      assert.ok(a.rel.includes("noopener"));
      assert.match(
        a.getAttribute("href")!,
        /^\/api\/reports\/summary\.(xlsx|pdf)\?/,
      );
    }
    const employee = document.querySelectorAll("select")[0];
    await act(async () => {
      employee.value = "e";
      employee.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.deepEqual(
      anchors().map((a) => a.getAttribute("href")),
      before,
    );
    defer = true;
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    for (const a of anchors()) {
      assert.equal(a.getAttribute("href"), null);
      assert.equal(a.getAttribute("aria-disabled"), "true");
    }
    await act(async () => resolveLoad!(Response.json(data)));
    for (const a of anchors())
      assert.equal(new URL(a.href).searchParams.get("employee"), "e");
    defer = false;
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Ver todo el historial")!
        .click(),
    );
    for (const a of anchors()) assert.equal(a.getAttribute("href"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
    dom.window.close();
  }
});
