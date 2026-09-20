import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FlowValidationError, validateFlowDocument } from "./flow.js";

const loadSample = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(new URL("../../samples/minimal.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("accepts the minimal document", async () => {
  const document = validateFlowDocument(await loadSample());
  assert.equal(document.functions[0]?.body.children[0]?.kind, "call");
});

test("rejects unsupported versions and broken references", async () => {
  const version = await loadSample();
  version.formatVersion = 99;
  assert.throws(() => validateFlowDocument(version), FlowValidationError);

  const reference = await loadSample();
  reference.roots = ["fn:missing"];
  assert.throws(() => validateFlowDocument(reference), /unknown function reference/);
});

test("rejects duplicate ids, unknown kinds and invalid spans", async () => {
  const duplicate = await loadSample();
  duplicate.roots = ["fn:hello", "fn:hello"];
  duplicate.functions = [...(duplicate.functions as unknown[]), ...(duplicate.functions as unknown[])];
  assert.throws(() => validateFlowDocument(duplicate), /duplicate function id/);

  const kind = await loadSample();
  const firstFunction = (kind.functions as Array<Record<string, unknown>>)[0]!;
  const body = firstFunction.body as Record<string, unknown>;
  (body.children as Array<Record<string, unknown>>)[0]!.kind = "mystery";
  assert.throws(() => validateFlowDocument(kind), /unsupported/);

  const range = await loadSample();
  const rangedFunction = (range.functions as Array<Record<string, unknown>>)[0]!;
  (rangedFunction.source as Record<string, unknown>).end = 999;
  assert.throws(() => validateFlowDocument(range), /exceeds the source length/);
});

test("rejects unknown or malformed annotation fields", async () => {
  const document = await loadSample();
  const fn = (document.functions as Array<Record<string, unknown>>)[0]!;
  const body = fn.body as Record<string, unknown>;
  const call = (body.children as Array<Record<string, unknown>>)[0]!;
  call.annotation = { label: "hello", html: "<b>unsafe</b>" };
  assert.throws(() => validateFlowDocument(document), /unknown fields/);
});

test("rejects coerced booleans and inconsistent coverage", async () => {
  const booleanDocument = await loadSample();
  const fn = (booleanDocument.functions as Array<Record<string, unknown>>)[0]!;
  const body = fn.body as Record<string, unknown>;
  (body.children as Array<Record<string, unknown>>)[0]!.awaited = "false";
  assert.throws(() => validateFlowDocument(booleanDocument), /must be a boolean/);

  const coverageDocument = await loadSample();
  const coverage = coverageDocument.coverage as Record<string, unknown>;
  (coverage.files as Record<string, unknown>).scanned = 2;
  assert.throws(() => validateFlowDocument(coverageDocument), /coverage.files is inconsistent/);

  const nodeCoverageDocument = await loadSample();
  const nodeCoverage = nodeCoverageDocument.coverage as Record<string, unknown>;
  (nodeCoverage.nodes as Record<string, unknown>).supported = 99;
  assert.throws(() => validateFlowDocument(nodeCoverageDocument), /coverage.nodes is inconsistent/);
});

test("rejects invalid branch conditions and jump targets", async () => {
  const branchDocument = await loadSample();
  const fn = (branchDocument.functions as Array<Record<string, unknown>>)[0]!;
  const body = fn.body as Record<string, unknown>;
  const children = body.children as Array<Record<string, unknown>>;
  children.push({ id: "bad-branch", kind: "branch", source: children[0]!.source, condition: "value", when: "always", then: { id: "bad-sequence", kind: "sequence", source: children[0]!.source, children: [] } });
  assert.throws(() => validateFlowDocument(branchDocument), /when is invalid/);

  const jumpDocument = await loadSample();
  const jumpFn = (jumpDocument.functions as Array<Record<string, unknown>>)[0]!;
  const jumpBody = jumpFn.body as Record<string, unknown>;
  (jumpBody.children as Array<Record<string, unknown>>).push({ id: "bad-jump", kind: "break", source: (jumpBody.children as Array<Record<string, unknown>>)[0]!.source, targetId: "missing" });
  assert.throws(() => validateFlowDocument(jumpDocument), /unknown jump target/);
});
