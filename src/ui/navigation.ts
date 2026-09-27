import type { EntryPoint, FlowDocument, FlowNode } from "../model/flow.js";
import { nestedNodes, presentSequence } from "./presentation.js";

export type NavigationFrame = {
  functionId?: string; moduleId?: string; nodeId?: string; expanded: string[];
  scrollY: number; callNodeId: string; ancestors: string[];
};
export type NavigationState = {
  mode: "entrypoints" | "functions"; entry?: string; target: number;
  functionId?: string; moduleId?: string; classId?: string; node?: string; ancestors: string[];
  open: string[]; trail: NavigationFrame[]; q: string;
};
const LIMIT = 64 * 1024;
const warning = "저장된 탐색 상태 일부가 유효하지 않아 초기화했습니다.";
export function defaultNavigation(flow: FlowDocument | undefined, entries: EntryPoint[]): NavigationState {
  const target = entries[0]?.targets[0];
  return { mode: entries.length ? "entrypoints" : "functions", entry: entries[0]?.id, target: 0,
    functionId: entries.length ? target?.functionId : flow?.roots[0] ?? flow?.functions[0]?.id,
    moduleId: target?.moduleId, ancestors: [], open: [], trail: [], q: "" };
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 500 && value.every((item) => typeof item === "string");
const nodes = (node: FlowNode): FlowNode[] => [node, ...nestedNodes(node).flatMap(nodes)];

export function readNavigation(url: URL, flow: FlowDocument | undefined, entries: EntryPoint[]): { state: NavigationState; warning?: string } {
  const fallback = defaultNavigation(flow, entries);
  if (!flow) return { state: fallback };
  if (url.search.length > LIMIT) return { state: fallback, warning };
  let raw: Record<string, unknown> = {};
  try {
    const view = url.searchParams.get("view");
    if (view) {
      const parsed: unknown = JSON.parse(view);
      if (!record(parsed) || parsed.v !== 1) return { state: fallback, warning };
      raw = parsed;
    }
  } catch { return { state: fallback, warning }; }
  for (const key of ["ancestors", "open", "trail"]) {
    if (raw[key] !== undefined && (!Array.isArray(raw[key]) || (raw[key] as unknown[]).length > (key === "trail" ? 100 : 500))) return { state: fallback, warning };
  }
  if (Array.isArray(raw.trail) && raw.trail.some((frame) => record(frame) && Array.isArray(frame.ancestors) && frame.ancestors.length > 500)) return { state: fallback, warning };
  let changed = false;
  const state: NavigationState = { ...fallback, ancestors: [], open: [], trail: [] };
  if (raw.mode === "functions" || raw.mode === "entrypoints") state.mode = raw.mode;
  else if (raw.mode !== undefined) changed = true;
  if (typeof raw.entry === "string") {
    if (entries.some((entry) => entry.id === raw.entry)) state.entry = raw.entry;
    else changed = true;
  }
  if (state.mode === "functions") state.entry = undefined;
  const entry = entries.find((item) => item.id === state.entry);
  if (typeof raw.target === "number" && Number.isInteger(raw.target) && raw.target >= 0 && raw.target < (entry?.targets.length ?? 0)) state.target = raw.target;
  else if (raw.target !== undefined) changed = true;
  const target = entry?.targets[state.target];
  state.functionId = state.mode === "entrypoints" ? target?.functionId : fallback.functionId ?? flow.roots[0] ?? flow.functions[0]?.id;
  state.moduleId = state.mode === "entrypoints" ? target?.moduleId : undefined;
  if (typeof raw.q === "string") state.q = raw.q;
  else if (raw.q !== undefined) changed = true;
  const fn = url.searchParams.get("fn");
  const classId = url.searchParams.get("class");
  const validFunction = fn && flow.functions.some((item) => item.id === fn);
  if (classId) {
    if (validFunction) {
      state.functionId = fn;
      state.moduleId = undefined;
      changed = true;
    } else if (flow.classes?.some((item) => item.id === classId)) {
      const stale = fn || raw.module !== undefined || raw.entry !== undefined || raw.target !== undefined || raw.node !== undefined || raw.ancestors !== undefined || raw.open !== undefined || raw.trail !== undefined || (raw.mode !== undefined && raw.mode !== "functions");
      return { state: { mode: "functions", target: 0, classId, q: state.q, ancestors: [], open: [], trail: [] }, ...(changed || stale ? { warning } : {}) };
    } else return { state: { ...fallback, q: state.q }, warning };
  }
  if (validFunction && (raw.module === undefined || classId)) { state.functionId = fn; state.moduleId = undefined; }
  else if (fn) changed = true;
  if (raw.module !== undefined) {
    if (!fn && typeof raw.module === "string" && flow.modules?.some((item) => item.id === raw.module)) { state.moduleId = raw.module; state.functionId = undefined; }
    else changed = true;
  }
  const body = (functionId?: string, moduleId?: string) => flow.functions.find((item) => item.id === functionId)?.body ?? flow.modules?.find((item) => item.id === moduleId)?.body;
  const connected = (functionId: string | undefined, moduleId: string | undefined, ancestors: string[]) => {
    let root = body(functionId, moduleId);
    const seen = new Set<string>();
    if (functionId) {
      const start = ancestors.indexOf(functionId);
      if (start < 0 || new Set(ancestors).size !== ancestors.length || ancestors.some((id) => !body(id))) return false;
      ancestors = ancestors.slice(start);
      seen.add(functionId);
    }
    for (const id of ancestors.slice(functionId ? 1 : 0)) {
      if (!root || seen.has(id) || !nodes(root).some((node) => node.kind === "call" && node.targetFunctionId === id)) return false;
      seen.add(id); root = body(id);
    }
    return Boolean(root);
  };
  if (Array.isArray(raw.trail)) {
    for (let index = 0; index < raw.trail.length; index++) {
      const frame = raw.trail[index];
      const next = raw.trail[index + 1];
      const destination = record(next) ? next.functionId : state.functionId;
      if (!record(frame) || typeof frame.callNodeId !== "string" || !strings(frame.ancestors)
        || (frame.functionId !== undefined && typeof frame.functionId !== "string")
        || (frame.moduleId !== undefined && typeof frame.moduleId !== "string")
        || Boolean(frame.functionId && frame.moduleId)
        || !connected(frame.functionId as string | undefined, frame.moduleId as string | undefined, frame.ancestors)) { changed = true; break; }
      const inherited = state.trail.at(-1)?.ancestors ?? [];
      if (inherited.some((id, position) => (frame.ancestors as string[])[position] !== id)) { changed = true; break; }
      const owner = body(frame.ancestors.at(-1), frame.ancestors.length ? undefined : frame.moduleId as string | undefined);
      const call = owner && nodes(owner).find((node) => node.id === frame.callNodeId);
      if (call?.kind !== "call" || call.targetFunctionId !== destination || frame.ancestors.includes(destination as string)) { changed = true; break; }
      state.trail.push({ functionId: frame.functionId as string | undefined, moduleId: frame.moduleId as string | undefined,
        callNodeId: frame.callNodeId, ancestors: frame.ancestors, expanded: [], scrollY: 0 });
    }
    if (state.trail.length !== raw.trail.length && state.trail.length) {
      const frame = raw.trail[state.trail.length];
      if (record(frame) && typeof frame.functionId === "string" && body(frame.functionId)) { state.functionId = frame.functionId; state.moduleId = undefined; }
    }
  } else if (raw.trail !== undefined) changed = true;
  const root = body(state.functionId, state.moduleId);
  const baseAncestors = [...new Set([...state.trail.flatMap((frame) => frame.ancestors), ...(state.functionId ? [state.functionId] : [])])];
  const requested = new Set(strings(raw.open) ? raw.open : []);
  if (raw.open !== undefined && !strings(raw.open)) changed = true;
  const selections: Array<{ id: string; ancestors: string[] }> = [];
  const visit = (node: FlowNode, path: string, ancestors: string[]) => {
    if (node.kind === "sequence") { presentSequence(node).forEach((group) => { if (group.statement) selections.push({ id: group.statement.id, ancestors }); visit(group.node, path, ancestors); }); return; }
    selections.push({ id: node.id, ancestors });
    const key = `${path}:${node.id}`;
    const structural = ["branch", "loop", "try"].includes(node.kind);
    if (structural && requested.has(`body:${key}`)) state.open.push(`body:${key}`);
    if (node.kind === "call" && node.targetFunctionId && !ancestors.includes(node.targetFunctionId)) {
      const targetBody = body(node.targetFunctionId);
      if (targetBody && requested.has(key)) { state.open.push(key); visit(targetBody, `${path}/${node.id}`, [...ancestors, node.targetFunctionId]); }
    }
    const children = node.kind === "branch" && node.origin === "statement" ? [node.then, ...(node.else ? [node.else] : [])] : nestedNodes(node);
    children.forEach((child) => visit(child, path, ancestors));
  };
  if (root) visit(root, state.functionId ?? state.moduleId!, baseAncestors);
  if (state.open.length !== requested.size) changed = true;
  if (typeof raw.node === "string") {
    const matches = selections.filter((selection) => selection.id === raw.node);
    const selected = matches.find((selection) => strings(raw.ancestors) && JSON.stringify(selection.ancestors) === JSON.stringify(raw.ancestors))
      ?? (raw.ancestors === undefined ? matches[0] : undefined);
    if (selected) { state.node = selected.id; state.ancestors = selected.ancestors; }
    else changed = true;
  } else if (raw.node !== undefined) changed = true;
  return { state, ...(changed ? { warning } : {}) };
}

export function navigationUrl(url: URL, state: NavigationState): URL {
  const result = new URL(url);
  result.searchParams.delete("fn"); result.searchParams.delete("view"); result.searchParams.delete("class");
  if (state.classId) result.searchParams.set("class", state.classId);
  if (state.functionId) result.searchParams.set("fn", state.functionId);
  const view = { v: 1, mode: state.mode, entry: state.entry, target: state.target || undefined,
    module: state.moduleId, q: state.q || undefined, node: state.node,
    ancestors: state.node && state.ancestors.length ? state.ancestors : undefined,
    open: state.open.length ? state.open : undefined,
    trail: state.trail.length ? state.trail.map(({ functionId, moduleId, callNodeId, ancestors }) => ({ functionId, moduleId, callNodeId, ancestors })) : undefined };
  result.searchParams.set("view", JSON.stringify(view));
  if (result.search.length > LIMIT || state.open.length > 500 || state.ancestors.length > 500 || state.trail.length > 100 || state.trail.some((frame) => frame.ancestors.length > 500)) throw new Error("탐색 상태가 URL 저장 한도를 초과했습니다.");
  return result;
}
