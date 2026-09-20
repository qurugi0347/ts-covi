import { validateFlowDocument, type FlowDocument } from "../model/flow.js";

export const parseEmbeddedDocument = (data?: string): { flow?: FlowDocument; error?: string } => {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data) as unknown;
    return typeof parsed === "string" ? {} : { flow: validateFlowDocument(parsed) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
};
