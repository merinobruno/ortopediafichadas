import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WeeklyPlanning from "../src/WeeklyPlanning";
test("weekly navigation waits for loaded data and explicit discard, so delayed responses cannot expose old editable cells", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost",
  });
  const oldFetch = globalThis.fetch;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const pending: { week: string; resolve: (r: Response) => void }[] = [];
  globalThis.fetch = (async (path: any) =>
    new Promise<Response>((resolve) =>
      pending.push({
        week: new URL(String(path), "http://localhost").searchParams.get(
          "week",
        )!,
        resolve,
      }),
    )) as typeof fetch;
  const locks: boolean[] = [];
  const onLock = (value: boolean) => locks.push(value);
  const root = createRoot(document.getElementById("root")!);
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text,
    )!;
  const response = (week: string) => ({
    week,
    total: 1,
    offset: 0,
    limit: 20,
    shifts: [],
    sites: [],
    rows: [
      {
        id: "e",
        name: "Synthetic person",
        active: 1,
        site_ids: [],
        cells: [
          {
            day: week,
            mode: "inherit",
            override_revision: 0,
            snapshot: null,
            effective: { status: "unscheduled", expectation_origin: "none" },
          },
        ],
      },
    ],
  });
  try {
    await act(async () =>
      root.render(
        React.createElement(WeeklyPlanning, {
          employees: [{ id: "e", name: "Synthetic person" }],
          supervisor: false,
          onLockChange: onLock,
        }),
      ),
    );
    assert.equal(pending.length, 1);
    assert.equal(button("Semana siguiente").matches(":disabled"), true);
    await act(async () => button("Semana siguiente").click());
    assert.equal(pending.length, 1);
    await act(async () =>
      pending[0].resolve(Response.json(response(pending[0].week))),
    );
    const plan = document.querySelector<HTMLSelectElement>(
      'select[aria-label^="Plan "]',
    )!;
    await act(async () => {
      plan.value = "rest";
      plan.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.ok(button("Descartar cambios pendientes"));
    assert.equal(button("Semana siguiente").matches(":disabled"), true);
    assert.equal(locks.at(-1), true);
    await act(async () => button("Semana siguiente").click());
    assert.equal(pending.length, 1);
    await act(async () => button("Descartar cambios pendientes").click());
    assert.equal(locks.at(-1), false);
    await act(async () => button("Semana siguiente").click());
    assert.equal(pending.length, 2);
    assert.equal(
      document.querySelector('select[aria-label^="Plan "]'),
      null,
      "Old week cells are removed while replacement request is pending",
    );
    assert.equal(button("Semana anterior").matches(":disabled"), true);
    await act(async () =>
      pending[1].resolve(Response.json(response(pending[1].week))),
    );
    assert.match(
      document.querySelector("h2")!.textContent!,
      new RegExp(pending[1].week),
    );
    assert.equal(
      document.querySelector<HTMLSelectElement>('select[aria-label^="Plan "]')!
        .value,
      "inherit",
    );
    assert.equal(locks.at(-1), false);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = oldFetch;
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
