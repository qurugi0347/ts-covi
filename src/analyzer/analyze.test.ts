import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "./analyze.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/sequential/tsconfig.json");
const controlFixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/control/tsconfig.json");

const walk = (node: import("../model/flow.js").FlowNode): import("../model/flow.js").FlowNode[] => {
  const nested = node.kind === "sequence" ? node.children
    : node.kind === "branch" ? [node.then, ...(node.else ? [node.else] : [])]
    : node.kind === "loop" ? [node.body, ...(node.initializerFlow ? [node.initializerFlow] : []), ...(node.conditionFlow ? [node.conditionFlow] : []), ...(node.incrementorFlow ? [node.incrementorFlow] : [])]
    : node.kind === "try" ? [node.body, ...(node.catch ? [node.catch.body] : []), ...(node.finally ? [node.finally] : [])]
    : [];
  return [node, ...nested.flatMap(walk)];
};

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

test("preserves branches, loop positions, jump targets and finally completion", () => {
  const document = analyzeProject(controlFixture);
  const control = document.functions.find((entry) => entry.name === "control")!;
  const nodes = walk(control.body);
  const loop = nodes.find((entry) => entry.kind === "loop");
  assert.ok(loop?.kind === "loop" && loop.initializer?.includes("start()") && loop.condition?.includes("keepGoing") && loop.incrementor?.includes("next"));
  assert.ok(loop.kind === "loop" && loop.initializerFlow && loop.conditionFlow && loop.incrementorFlow);
  assert.ok(nodes.filter((entry) => entry.kind === "branch").length >= 4);
  assert.ok(nodes.filter((entry) => entry.kind === "break" || entry.kind === "continue").every((entry) => "targetId" in entry && entry.targetId === loop.id));
  assert.ok(nodes.some((entry) => entry.kind === "try" && entry.catch && entry.finally));
  assert.equal(nodes.some((entry) => entry.kind === "call" && entry.calleeExpression === "unreachable"), false);

  const override = document.functions.find((entry) => entry.name === "override")!;
  assert.ok(walk(override.body).some((entry) => entry.kind === "try" && entry.finallyOverrides));
  assert.ok(document.diagnostics.some((entry) => entry.code === "UNSUPPORTED_SYNTAX" && entry.message.includes("Generator")));
});
