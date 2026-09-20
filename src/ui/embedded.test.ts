import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseEmbeddedDocument } from "./embedded.js";

test("parses an embedded flow document and ignores the build marker", async () => {
  const samplePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../samples/minimal.json");
  const parsed = parseEmbeddedDocument(await readFile(samplePath, "utf8"));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.flow?.project.name, "minimal");
  assert.deepEqual(parseEmbeddedDocument(JSON.stringify("__TS_COVI_EMBEDDED_FLOW__")), {});
});
