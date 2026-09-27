import assert from "node:assert/strict";
import test from "node:test";
import type { FlowDocument } from "../model/flow.js";
import { explorerItems } from "./function-explorer.js";

test("explorer groups files/classes, keeps every function, and reveals selected/search paths", () => {
  const flow = {
    files: [{ id: "f", path: "src/orders/service.ts" }, { id: "empty", path: "src/empty.ts" }],
    functions: Array.from({ length: 105 }, (_, index) => ({ id: `fn${index}`, name: `method${index}`, signature: "(): void", className: "Orders", source: { fileId: "f" } })),
  } as unknown as FlowDocument;
  const tree = explorerItems(flow, "", "fn104");
  const src = tree[0]!;
  const orders = src.children.get("src/orders")!;
  const file = orders.children.get("src/orders/service.ts")!;
  assert.equal(file.children.get("class:Orders")?.children.size, 105);
  assert.equal(src.selected && orders.selected && file.selected, true);
  assert.equal(src.children.has("src/empty.ts"), true);
  const search = explorerItems(flow, "method104")[0]!;
  assert.equal(search.children.size, 1);
  assert.equal(search.children.get("src/orders")?.children.get("src/orders/service.ts")?.children.get("class:Orders")?.children.size, 1);
  assert.deepEqual(explorerItems(flow, "missing"), []);
});
