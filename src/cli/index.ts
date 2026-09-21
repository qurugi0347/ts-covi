#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyzer/analyze.js";
import { validateFlowDocument } from "../model/flow.js";
import { embedFlowDocument, loadViewerTemplate } from "./viewer.js";

const usage = "Usage: ts-covi analyze --project ./tsconfig.json --out ./.covi/flow.json [--entry ./scripts/job.ts]";

const option = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const options = (args: string[], name: string): string[] => args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]!] : []);

export const resolveOutputPath = (project: string, out = ".covi/flow.json"): string =>
  path.resolve(path.dirname(path.resolve(project)), out);

const refuseSymlink = async (filePath: string): Promise<void> => {
  try {
    if ((await lstat(filePath)).isSymbolicLink()) throw new Error(`Refusing to replace a symbolic-link output file: ${filePath}`);
  } catch (cause) {
    if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
  }
};

type RenameFile = (source: string, destination: string) => Promise<void>;

export const replaceOutputs = async (outputPath: string, json: string, viewerPath: string, html: string, renameFile: RenameFile = rename): Promise<void> => {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${randomUUID()}.tmp`);
  const temporaryViewerPath = path.join(path.dirname(viewerPath), `.index.html.${randomUUID()}.tmp`);
  const backupPath = `${temporaryPath}.backup`;
  const backupViewerPath = `${temporaryViewerPath}.backup`;
  let outputBackedUp = false;
  let viewerBackedUp = false;
  let outputInstalled = false;
  let viewerInstalled = false;
  try {
    await writeFile(temporaryPath, json, { flag: "wx" });
    await writeFile(temporaryViewerPath, html, { flag: "wx" });
    try { await copyFile(outputPath, backupPath); outputBackedUp = true; } catch (cause) {
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
    try { await copyFile(viewerPath, backupViewerPath); viewerBackedUp = true; } catch (cause) {
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
    await renameFile(temporaryPath, outputPath);
    outputInstalled = true;
    await renameFile(temporaryViewerPath, viewerPath);
    viewerInstalled = true;
    await unlink(backupPath).catch(() => undefined);
    await unlink(backupViewerPath).catch(() => undefined);
  } catch (cause) {
    try {
      if (outputInstalled) {
        if (outputBackedUp) await renameFile(backupPath, outputPath);
        else await unlink(outputPath);
      }
      if (viewerInstalled) {
        if (viewerBackedUp) await renameFile(backupViewerPath, viewerPath);
        else await unlink(viewerPath);
      }
    } catch (rollbackCause) {
      await unlink(temporaryPath).catch(() => undefined);
      await unlink(temporaryViewerPath).catch(() => undefined);
      throw new AggregateError([cause, rollbackCause], "Failed to restore previous analysis outputs; backup files were preserved.");
    }
    await unlink(temporaryPath).catch(() => undefined);
    await unlink(temporaryViewerPath).catch(() => undefined);
    await unlink(backupPath).catch(() => undefined);
    await unlink(backupViewerPath).catch(() => undefined);
    throw cause;
  }
};

export async function run(args: string[], viewerTemplate?: string): Promise<number> {
  if (args[0] !== "analyze") {
    console.error(usage);
    return 1;
  }
  const project = option(args, "--project");
  const out = option(args, "--out") ?? ".covi/flow.json";
  if (!project) {
    console.error(usage);
    return 1;
  }
  const projectPath = path.resolve(project);
  const outputPath = resolveOutputPath(projectPath, out);
  const viewerPath = path.join(path.dirname(outputPath), "index.html");
  try {
    if (path.basename(outputPath).toLowerCase() === "index.html") throw new Error("JSON output path cannot be index.html.");
    await refuseSymlink(outputPath);
    await refuseSymlink(viewerPath);
    const template = viewerTemplate ?? await loadViewerTemplate();
    const document = analyzeProject(projectPath, [outputPath, viewerPath], options(args, "--entry"));
    validateFlowDocument(document);
    const json = `${JSON.stringify(document, null, 2)}\n`;
    const html = embedFlowDocument(template, document);
    await replaceOutputs(outputPath, json, viewerPath, html);
    console.log(`${document.coverage.status}: ${outputPath}\nviewer: ${viewerPath}`);
    return document.coverage.status === "partial" ? 2 : 0;
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

let isMain = false;
try { isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* Imported modules do not need a CLI entry path. */ }
if (isMain) process.exitCode = await run(process.argv.slice(2));
