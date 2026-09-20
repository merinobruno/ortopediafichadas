import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Catalogs from "../src/Catalogs";
test("catalog editor switches entity with clean reason and disables edits while mutation is pending", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost",
  });
  const oldFetch = globalThis.fetch,
    oldForm = globalThis.FormData;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    FormData: dom.window.FormData,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let release!: (r: Response) => void;
  let posted: any;
  globalThis.fetch = (async (path: any, init: any) => {
    if (init?.method === "POST") {
      posted = { path: String(path), body: JSON.parse(init.body) };
      return new Promise<Response>((r) => (release = r));
    }
    return Response.json({
      catalogs: {
        tag: [
          { id: "a", name: "Tag A", kind: "tag", revision: 1 },
          { id: "b", name: "Tag B", kind: "tag", revision: 3 },
        ],
      },
      associations: [],
    });
  }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        React.createElement(Catalogs, {
          kinds: ["tag"],
          employees: [],
          version: 1,
          onChange: async () => {},
        }),
      ),
    );
    const edits = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((b) => b.textContent === "Editar");
    await act(async () => edits[0].click());
    document.querySelector<HTMLInputElement>("input[name=reason]")!.value =
      "Reason for A";
    document.querySelector<HTMLInputElement>("input[name=name]")!.value =
      "Unsaved A";
    await act(async () => edits[1].click());
    assert.equal(
      document.querySelector<HTMLInputElement>("input[name=reason]")!.value,
      "",
    );
    assert.equal(
      document.querySelector<HTMLInputElement>("input[name=name]")!.value,
      "Tag B",
    );
    document.querySelector<HTMLInputElement>("input[name=reason]")!.value =
      "Confirmed B update";
    document.querySelector<HTMLInputElement>("input[name=name]")!.value =
      "New B";
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    assert.equal(posted.path, "/api/catalogs/tag/b");
    assert.equal(posted.body.expected_revision, 3);
    assert.equal(posted.body.name, "New B");
    assert.equal(edits[0].matches(":disabled"), true);
    assert.equal(
      document.querySelector("input[name=reason]")!.matches(":disabled"),
      true,
    );
    await act(async () => release(Response.json({ ok: true })));
    assert.equal(document.querySelector("form"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = oldFetch;
    globalThis.FormData = oldForm;
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
