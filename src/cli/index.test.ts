import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { replaceOutputs, resolveOutputPath, run } from "./index.js";
import { VIEWER_DATA_MARKER } from "./viewer.js";

test("resolves default and relative outputs from the project root while preserving absolute outputs", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ts-covi-cli-"));
  const projectRoot = path.join(temporaryRoot, "project");
  const launchDirectory = path.join(temporaryRoot, "launcher");
  await mkdir(projectRoot);
  await mkdir(launchDirectory);
  await writeFile(path.join(projectRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2023", module: "ESNext" }, include: ["main.ts"] }));
  await writeFile(path.join(projectRoot, "main.ts"), "export function main() { return '</script><img src=x>'; }\n");

  const previousDirectory = process.cwd();
  try {
    process.chdir(launchDirectory);
    const project = path.join(projectRoot, "tsconfig.json");
    const absoluteOutput = path.join(temporaryRoot, "absolute", "flow.json");
    assert.equal(resolveOutputPath(project), path.join(projectRoot, ".covi/flow.json"));
    assert.equal(resolveOutputPath(project, "./.covi/relative.json"), path.join(projectRoot, ".covi/relative.json"));
    assert.equal(resolveOutputPath(project, absoluteOutput), absoluteOutput);
    assert.equal(await run(["analyze", "--project", project, "--out", "./.covi/INDEX.HTML"]), 1);
    assert.equal(await run(["analyze", "--project", project, "--out", "./.covi/relative.json"]), 0);
    const document = JSON.parse(await readFile(path.join(projectRoot, ".covi/relative.json"), "utf8")) as { project: { name: string } };
    const viewer = await readFile(path.join(projectRoot, ".covi/index.html"), "utf8");
    assert.equal(document.project.name, "project");
    assert.equal(viewer.includes(VIEWER_DATA_MARKER), false);
    assert.equal(viewer.includes("ts-covi-data"), true);
    assert.equal(viewer.includes("STATIC FLOW VIEWER"), true);
    assert.equal(viewer.includes('"name":"project"'), true);
    assert.equal(viewer.includes("</script><img"), false);
    await assert.rejects(readFile(path.join(launchDirectory, ".covi/relative.json"), "utf8"), { code: "ENOENT" });
  } finally {
    process.chdir(previousDirectory);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("restores both previous outputs when the viewer replacement fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ts-covi-output-"));
  const outputPath = path.join(directory, "flow.json");
  const viewerPath = path.join(directory, "index.html");
  await writeFile(outputPath, "old json");
  await writeFile(viewerPath, "old html");
  try {
    await assert.rejects(replaceOutputs(outputPath, "new json", viewerPath, "new html", async (source, destination) => {
      if (destination === viewerPath && source.includes(".index.html.")) throw new Error("viewer rename failed");
      await rename(source, destination);
    }), /viewer rename failed/);
    assert.equal(await readFile(outputPath, "utf8"), "old json");
    assert.equal(await readFile(viewerPath, "utf8"), "old html");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves backups when rollback also fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ts-covi-rollback-"));
  const outputPath = path.join(directory, "flow.json");
  const viewerPath = path.join(directory, "index.html");
  await writeFile(outputPath, "old json");
  await writeFile(viewerPath, "old html");
  try {
    await assert.rejects(replaceOutputs(outputPath, "new json", viewerPath, "new html", async (source, destination) => {
      if (source.endsWith(".backup")) throw new Error("rollback failed");
      if (destination === viewerPath && source.includes(".index.html.")) throw new Error("viewer rename failed");
      await rename(source, destination);
    }), (cause: unknown) => cause instanceof AggregateError && cause.message.includes("backup files were preserved"));
    const backups = (await readdir(directory)).filter((file) => file.endsWith(".backup"));
    assert.equal(backups.length, 2);
    assert.ok((await Promise.all(backups.map((file) => readFile(path.join(directory, file), "utf8")))).includes("old json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
