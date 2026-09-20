import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "./analyze.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/sequential/tsconfig.json");

test("preserves nested call order and resolves imported aliases", () => {
  const document = analyzeProject(fixture);
  const outer = document.functions.find((entry) => entry.name === "outer")!;
  const calls = outer.body.children.filter((entry) => entry.kind === "call");
  assert.deepEqual(calls.map((entry) => entry.kind === "call" && entry.calleeExpression), ["innerLocal", "importedInner", "remoteCharge"]);
  assert.ok(calls[0]?.kind === "call" && calls[0].targetFunctionId);
  assert.ok(calls[1]?.kind === "call" && calls[1].targetFunctionId);
  assert.equal(calls[2]?.kind === "call" && calls[2].awaited, true);
  assert.equal(calls[2]?.kind === "call" && calls[2].boundary, "external");
  assert.equal(outer.body.children.at(-1)?.kind, "return");
});

test("creates distinct ids for functions on the same line", () => {
  const document = analyzeProject(fixture);
  assert.deepEqual(document.functions.filter((entry) => entry.name === "first" || entry.name === "second").map((entry) => entry.name), ["first", "second"]);
  assert.equal(new Set(document.functions.map((entry) => entry.id)).size, document.functions.length);
});
