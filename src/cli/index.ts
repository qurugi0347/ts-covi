#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "../analyzer/analyze.js";
import { validateFlowDocument } from "../model/flow.js";

const usage = "Usage: ts-covi analyze --project ./tsconfig.json --out ./.covi/flow.json";

const option = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

export const resolveOutputPath = (project: string, out = ".covi/flow.json"): string =>
  path.resolve(path.dirname(path.resolve(project)), out);

export async function run(args: string[]): Promise<number> {
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
  try {
    try {
      if ((await lstat(outputPath)).isSymbolicLink()) throw new Error("Refusing to replace a symbolic-link output file.");
    } catch (cause) {
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
    const document = analyzeProject(projectPath, [outputPath]);
    validateFlowDocument(document);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
      await rename(temporaryPath, outputPath);
    } catch (cause) {
      await unlink(temporaryPath).catch(() => undefined);
      throw cause;
    }
    console.log(`${document.coverage.status}: ${outputPath}`);
    return document.coverage.status === "partial" ? 2 : 0;
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) process.exitCode = await run(process.argv.slice(2));
