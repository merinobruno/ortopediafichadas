import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Receipts from "../src/Receipts";
test("switching receipt document clears unsaved employee and reason before assigning another PDF", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost",
  });
  const originalFetch = globalThis.fetch,
    originalFormData = globalThis.FormData;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    FormData: dom.window.FormData,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const docs = [
    {
      id: "a",
      filename: "A.pdf",
      status: "needs_assignment",
      employee_id: null,
      page_count: 1,
      byte_count: 100,
    },
    {
      id: "b",
      filename: "B.pdf",
      status: "needs_assignment",
      employee_id: null,
      page_count: 1,
      byte_count: 100,
    },
  ];
  const posts: { path: string; body: any }[] = [];
  globalThis.fetch = (async (path: any, init: any) => {
    if (init?.method === "POST") {
      posts.push({ path: String(path), body: JSON.parse(init.body) });
      return Response.json({ ok: true });
    }
    return Response.json(
      String(path).endsWith("/documents")
        ? docs
        : {
            batches: [
              {
                id: "batch",
                title: "Synthetic batch",
                period: "2026-09",
                liquidation: "monthly",
                status: "draft",
                documents: 2,
              },
            ],
            totalBytes: 200,
          },
    );
  }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    )!;
  const form = () =>
    document.querySelector("select[name=employee_id]")!.closest("form")!;
  try {
    await act(async () =>
      root.render(
        React.createElement(Receipts, {
          employees: [
            { id: "e1", name: "First synthetic", active: true },
            { id: "e2", name: "Second synthetic", active: true },
          ],
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>(".receipt-batch")!.click(),
    );
    const assign = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((b) => b.textContent === "Asignar persona");
    await act(async () => assign[0].click());
    const first = form();
    first.querySelector<HTMLSelectElement>("select")!.value = "e1";
    first.querySelector<HTMLInputElement>("input[name=reason]")!.value =
      "Reason intended only for PDF A";
    assert.equal(first.checkValidity(), true);
    await act(async () => assign[1].click());
    const second = form();
    assert.equal(
      second.querySelector<HTMLSelectElement>("select")!.value,
      "",
      "PDF B must not inherit PDF A employee",
    );
    assert.equal(
      second.querySelector<HTMLInputElement>("input[name=reason]")!.value,
      "",
      "PDF B must not inherit PDF A reason",
    );
    assert.equal(second.checkValidity(), false);
    await act(async () => button("Guardar asignación").click());
    assert.equal(
      posts.length,
      0,
      "Native required fields prevent stale assignment submission",
    );
    second.querySelector<HTMLSelectElement>("select")!.value = "e2";
    second.querySelector<HTMLInputElement>("input[name=reason]")!.value =
      "Explicit reason for PDF B";
    await act(async () => button("Guardar asignación").click());
    assert.deepEqual(posts, [
      {
        path: "/api/receipts/documents/b/assignment",
        body: { employee_id: "e2", reason: "Explicit reason for PDF B" },
      },
    ]);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    globalThis.FormData = originalFormData;
    dom.window.close();
    for (const k of [
      "window",
      "document",
      "HTMLElement",
      "IS_REACT_ACT_ENVIRONMENT",
    ])
      delete (globalThis as any)[k];
  }
});
