import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveOutputPath, run } from "./index.js";

test("resolves default and relative outputs from the project root while preserving absolute outputs", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ts-covi-cli-"));
  const projectRoot = path.join(temporaryRoot, "project");
  const launchDirectory = path.join(temporaryRoot, "launcher");
  await mkdir(projectRoot);
  await mkdir(launchDirectory);
  await writeFile(path.join(projectRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2023", module: "ESNext" }, include: ["main.ts"] }));
  await writeFile(path.join(projectRoot, "main.ts"), "export function main() { return 1; }\n");

  const previousDirectory = process.cwd();
  try {
    process.chdir(launchDirectory);
    const project = path.join(projectRoot, "tsconfig.json");
    const absoluteOutput = path.join(temporaryRoot, "absolute", "flow.json");
    assert.equal(resolveOutputPath(project), path.join(projectRoot, ".covi/flow.json"));
    assert.equal(resolveOutputPath(project, "./.covi/relative.json"), path.join(projectRoot, ".covi/relative.json"));
    assert.equal(resolveOutputPath(project, absoluteOutput), absoluteOutput);
    assert.equal(await run(["analyze", "--project", project, "--out", "./.covi/relative.json"]), 0);
    const document = JSON.parse(await readFile(path.join(projectRoot, ".covi/relative.json"), "utf8")) as { project: { name: string } };
    assert.equal(document.project.name, "project");
    await assert.rejects(readFile(path.join(launchDirectory, ".covi/relative.json"), "utf8"), { code: "ENOENT" });
  } finally {
    process.chdir(previousDirectory);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
