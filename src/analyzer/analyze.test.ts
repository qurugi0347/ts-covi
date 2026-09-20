import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "./analyze.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/sequential/tsconfig.json");
const controlFixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/control/tsconfig.json");
const annotationFixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/annotations/tsconfig.json");
const orderFixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/order/tsconfig.json");
const syntaxErrorFixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/syntax-error/tsconfig.json");

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
  assert.ok(nodes.some((entry) => entry.kind === "branch" && entry.when === "falsy"));
  assert.ok(nodes.some((entry) => entry.kind === "branch" && entry.when === "nullish"));
  assert.ok(nodes.some((entry) => entry.kind === "branch" && entry.when === "non-nullish" && entry.condition === "callback"));
  assert.ok(nodes.some((entry) => entry.kind === "call" && entry.calleeExpression === "hidden"));
  assert.ok(nodes.some((entry) => entry.kind === "loop" && entry.loopKind === "do"));
  assert.ok(nodes.filter((entry) => entry.kind === "break" || entry.kind === "continue").every((entry) => "targetId" in entry && entry.targetId === loop.id));
  assert.ok(nodes.some((entry) => entry.kind === "try" && entry.catch && entry.finally));
  assert.equal(nodes.some((entry) => entry.kind === "call" && entry.calleeExpression === "unreachable"), false);

  const override = document.functions.find((entry) => entry.name === "override")!;
  assert.ok(walk(override.body).some((entry) => entry.kind === "try" && entry.finallyOverrides));
  const optional = document.functions.find((entry) => entry.name === "optionalChains")!;
  const optionalBranches = optional.body.children.filter((entry): entry is import("../model/flow.js").BranchNode => entry.kind === "branch");
  assert.deepEqual(optionalBranches.map((entry) => entry.condition), ["services", "nested", "services"]);
  assert.ok(walk(optionalBranches[0]!.then).some((entry) => entry.kind === "call" && entry.calleeExpression === "serviceKey"));
  assert.ok(walk(optionalBranches[2]!.then).some((entry) => entry.kind === "call" && entry.calleeExpression === "serviceKey"));
  assert.ok(document.diagnostics.some((entry) => entry.code === "UNSUPPORTED_SYNTAX" && entry.message.includes("Generator")));
});

test("keeps function and call annotations separate from code arguments", () => {
  const document = analyzeProject(annotationFixture);
  const root = document.functions.find((entry) => entry.name === "processOrder")!;
  assert.deepEqual(document.roots, [root.id]);
  assert.equal(root.description, "주문을 처리한다.");
  assert.deepEqual(root.groupPath, ["orders", "payment"]);
  assert.equal(document.functions.find((entry) => entry.name === "arrowFlow")?.description, "화살표 함수 설명");
  const calls = walk(root.body).filter((entry): entry is import("../model/flow.js").CallNode => entry.kind === "call");
  const charge = calls.find((entry) => entry.annotation?.label === "결제 승인")!;
  assert.deepEqual(charge.args, [{ expression: "token", annotation: "결제 토큰" }, { expression: "amount", annotation: "최종 금액" }]);
  assert.ok(document.diagnostics.some((entry) => entry.code === "AMBIGUOUS_COVI_CALL"));
  assert.ok(document.diagnostics.some((entry) => entry.code === "DUPLICATE_ANNOTATION_ARG"));
  assert.ok(document.diagnostics.some((entry) => entry.code === "SPREAD_ANNOTATION_ARG"));
  assert.ok(document.diagnostics.some((entry) => entry.code === "INVALID_COVI_CALL"));
  assert.ok(document.diagnostics.some((entry) => entry.code === "ORPHAN_COVI_CALL"));
  assert.deepEqual(calls.map((entry) => entry.calleeExpression), ["charge", "one", "two", "send", "sendAll", "charge"]);
});

test("marks compiler errors as partial diagnostics", () => {
  const document = analyzeProject(syntaxErrorFixture);
  assert.equal(document.coverage.status, "partial");
  assert.ok(document.diagnostics.some((entry) => entry.code === "TS1005"));
  assert.ok(document.diagnostics.some((entry) => entry.code === "TS2322"));
});

test("applies ordered gitignore patterns including negation", () => {
  const document = analyzeProject(fixture);
  assert.ok(document.files.some((entry) => entry.path === "keep.ignored.ts"));
  assert.equal(document.files.some((entry) => entry.path === "drop.ignored.ts"), false);
});

test("analyzes the independent order flow without inlining callbacks", () => {
  const document = analyzeProject(orderFixture);
  const order = document.functions.find((entry) => entry.name === "createOrder")!;
  const calls = walk(order.body).filter((entry): entry is import("../model/flow.js").CallNode => entry.kind === "call");
  assert.deepEqual(calls.map((entry) => entry.calleeExpression), ["validateItems", "reserveStock", "calculateTotal", "approvePayment", "saveOrder", "notifyOrder"]);
  assert.deepEqual(calls.filter((entry) => entry.awaited).map((entry) => entry.calleeExpression), ["reserveStock", "approvePayment", "notifyOrder"]);
  assert.equal(calls.find((entry) => entry.calleeExpression === "approvePayment")?.annotation?.label, "결제 승인");
  const total = document.functions.find((entry) => entry.name === "calculateTotal")!;
  assert.ok(walk(total.body).some((entry) => entry.kind === "call" && entry.calleeExpression === "items.reduce"));
  assert.equal(walk(total.body).some((entry) => entry.kind === "call" && entry.calleeExpression.includes("sum")), false);
});
