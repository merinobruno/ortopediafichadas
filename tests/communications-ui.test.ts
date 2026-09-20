import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Communications from "../src/Communications";
test("communication editor and navigation stay disabled until the saved revision preview arrives", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost",
  });
  const originalFetch = globalThis.fetch;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let release!: (r: Response) => void;
  const draft = {
    id: "c",
    revision: 1,
    status: "draft",
    preparation_id: null,
    document: {
      type: "circular",
      channel: "whatsapp",
      requires_signature: false,
      subject: "Saved subject",
      body: "Saved body",
      variables: [],
      selection: { mode: "all", employee_ids: [], sector_id: null },
      template_id: null,
      template_revision: null,
    },
  };
  let requested = false;
  globalThis.fetch = (async (path: any, init: any) => {
    if (String(path).endsWith("/preview")) {
      requested = true;
      return new Promise<Response>((r) => (release = r));
    }
    if (init?.method === "POST") return Response.json({ id: "c", revision: 2 });
    return Response.json({ templates: [], campaigns: [draft], sectors: [] });
  }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(React.createElement(Communications, { employees: [] })),
    );
    const edit = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Editar",
    )!;
    await act(async () => edit.click());
    const form = document.querySelector("form")!;
    await act(async () =>
      form.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(requested, true);
    const subject = [...form.querySelectorAll("input")].find(
      (i) => i.value === "Saved subject",
    )!;
    assert.equal(
      subject.matches(":disabled"),
      true,
      "Native disabled state prevents edits while preview is pending",
    );
    for (const tab of document.querySelectorAll("[role=tab]"))
      assert.equal(
        tab.matches(":disabled"),
        true,
        "Navigation cannot switch editors during pending preview",
      );
    assert.ok(
      ![...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Preparar sin enviar",
      ),
    );
    await act(async () =>
      release(
        Response.json({
          campaign_id: "c",
          revision: 2,
          recipients: [],
          channel: "whatsapp",
          requires_signature: false,
        }),
      ),
    );
    assert.equal(subject.matches(":disabled"), false);
    assert.equal(subject.value, "Saved subject");
    const prepare = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Preparar sin enviar",
    )!;
    assert.ok(prepare);
    assert.equal(prepare.matches(":disabled"), false);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
