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
