import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FlowDocument } from "../model/flow.js";

export const VIEWER_DATA_MARKER = "__TS_COVI_EMBEDDED_FLOW__";

export const embedFlowDocument = (template: string, document: FlowDocument): string => {
  const marker = JSON.stringify(VIEWER_DATA_MARKER);
  if (!template.includes(marker)) throw new Error("Viewer template is missing the flow data marker.");
  const data = JSON.stringify(document).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return template.replace(marker, () => data);
};

export const loadViewerTemplate = async (): Promise<string> => {
  const candidates = [new URL("../index.html", import.meta.url), new URL("../../dist/index.html", import.meta.url)];
  for (const candidate of candidates) {
    try {
      return await readFile(fileURLToPath(candidate), "utf8");
    } catch (cause) {
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")) throw cause;
    }
  }
  throw new Error("Viewer template was not found. Run pnpm build before pnpm analyze.");
};
