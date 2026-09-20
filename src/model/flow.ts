export const FORMAT_VERSION = 1;

export type CoverageStatus = "complete" | "partial";
export type DiagnosticSeverity = "warning" | "error";
export type BoundaryKind = "external" | "unresolved" | "runtime";

export type SourceSpan = {
  fileId: string;
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type CallArgument = {
  expression: string;
  annotation?: string;
};

export type CallAnnotation = {
  label?: string;
  args?: Record<string, string>;
};

type BaseNode = { id: string; source: SourceSpan };
export type SequenceNode = BaseNode & { kind: "sequence"; children: FlowNode[] };
export type StatementNode = BaseNode & { kind: "statement"; code: string };
export type CallNode = BaseNode & {
  kind: "call";
  calleeExpression: string;
  args: CallArgument[];
  awaited: boolean;
  targetFunctionId?: string;
  boundary?: BoundaryKind;
  annotation?: CallAnnotation;
};
export type BranchNode = BaseNode & {
  kind: "branch";
  condition: string;
  then: SequenceNode;
  else?: SequenceNode;
};
export type LoopNode = BaseNode & {
  kind: "loop";
  loopKind: "for" | "for-of" | "for-in" | "while" | "do";
  initializer?: string;
  condition?: string;
  incrementor?: string;
  body: SequenceNode;
};
export type JumpNode = BaseNode & {
  kind: "break" | "continue";
  targetLabel?: string;
};
export type ExitNode = BaseNode & {
  kind: "return" | "throw";
  expression?: string;
};
export type TryNode = BaseNode & {
  kind: "try";
  body: SequenceNode;
  catch?: { variable?: string; body: SequenceNode };
  finally?: SequenceNode;
};
export type UnsupportedNode = BaseNode & {
  kind: "unsupported";
  syntax: string;
  code: string;
  reason: string;
};

export type FlowNode =
  | SequenceNode
  | StatementNode
  | CallNode
  | BranchNode
  | LoopNode
  | JumpNode
  | ExitNode
  | TryNode
  | UnsupportedNode;

export type FlowFunction = {
  id: string;
  name: string;
  signature: string;
  source: SourceSpan;
  description?: string;
  groupPath?: string[];
  body: SequenceNode;
};

export type FlowDocument = {
  formatVersion: 1;
  producerVersion: string;
  project: { name: string; tsconfig: string };
  files: Array<{ id: string; path: string; contentHash: string; source: string }>;
  functions: FlowFunction[];
  roots: string[];
  diagnostics: Array<{
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    source?: SourceSpan;
  }>;
  coverage: {
    status: CoverageStatus;
    files: { scanned: number; analyzed: number; skipped: number };
    functions: { discovered: number; analyzed: number };
    nodes: { supported: number; unsupported: number };
  };
};

export class FlowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowValidationError";
  }
}

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FlowValidationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
};

const string = (value: unknown, path: string): string => {
  if (typeof value !== "string") throw new FlowValidationError(`${path} must be a string`);
  return value;
};

const number = (value: unknown, path: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new FlowValidationError(`${path} must be a non-negative integer`);
  }
  return value as number;
};

const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new FlowValidationError(`${path} must be an array`);
  return value;
};

const span = (value: unknown, path: string, fileLengths: Map<string, number>): SourceSpan => {
  const candidate = object(value, path);
  const result = {
    fileId: string(candidate.fileId, `${path}.fileId`),
    start: number(candidate.start, `${path}.start`),
    end: number(candidate.end, `${path}.end`),
    startLine: number(candidate.startLine, `${path}.startLine`),
    startColumn: number(candidate.startColumn, `${path}.startColumn`),
    endLine: number(candidate.endLine, `${path}.endLine`),
    endColumn: number(candidate.endColumn, `${path}.endColumn`),
  };
  const fileLength = fileLengths.get(result.fileId);
  if (fileLength === undefined) throw new FlowValidationError(`${path}.fileId is unknown`);
  if (result.end < result.start) throw new FlowValidationError(`${path}.end precedes start`);
  if (result.end > fileLength) throw new FlowValidationError(`${path}.end exceeds the source length`);
  return result;
};

const optionalString = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : string(value, path);

function node(
  value: unknown,
  path: string,
  fileLengths: Map<string, number>,
  nodeIds: Set<string>,
  referencedFunctions: Set<string>,
): FlowNode {
  const candidate = object(value, path);
  const id = string(candidate.id, `${path}.id`);
  if (nodeIds.has(id)) throw new FlowValidationError(`duplicate node id: ${id}`);
  nodeIds.add(id);
  const source = span(candidate.source, `${path}.source`, fileLengths);
  const kind = string(candidate.kind, `${path}.kind`);
  const sequence = (entry: unknown, childPath: string) =>
    node(entry, childPath, fileLengths, nodeIds, referencedFunctions) as SequenceNode;
  const children = (entry: unknown, childPath: string) =>
    array(entry, childPath).map((child, index) => node(child, `${childPath}[${index}]`, fileLengths, nodeIds, referencedFunctions));

  switch (kind) {
    case "sequence":
      return { id, kind, source, children: children(candidate.children, `${path}.children`) };
    case "statement":
      return { id, kind, source, code: string(candidate.code, `${path}.code`) };
    case "call": {
      const targetFunctionId = optionalString(candidate.targetFunctionId, `${path}.targetFunctionId`);
      if (targetFunctionId) referencedFunctions.add(targetFunctionId);
      const boundary = optionalString(candidate.boundary, `${path}.boundary`) as BoundaryKind | undefined;
      if (boundary && !["external", "unresolved", "runtime"].includes(boundary)) {
        throw new FlowValidationError(`${path}.boundary is invalid`);
      }
      if (targetFunctionId && boundary) throw new FlowValidationError(`${path} cannot have targetFunctionId and boundary`);
      if (!targetFunctionId && !boundary) throw new FlowValidationError(`${path} must have a targetFunctionId or boundary`);
      const args = array(candidate.args, `${path}.args`).map((entry, index) => {
        const argument = object(entry, `${path}.args[${index}]`);
        return {
          expression: string(argument.expression, `${path}.args[${index}].expression`),
          annotation: optionalString(argument.annotation, `${path}.args[${index}].annotation`),
        };
      });
      const annotation = candidate.annotation === undefined ? undefined : object(candidate.annotation, `${path}.annotation`);
      return {
        id,
        kind,
        source,
        calleeExpression: string(candidate.calleeExpression, `${path}.calleeExpression`),
        args,
        awaited: candidate.awaited === true,
        targetFunctionId,
        boundary,
        annotation: annotation as CallAnnotation | undefined,
      };
    }
    case "branch":
      return {
        id,
        kind,
        source,
        condition: string(candidate.condition, `${path}.condition`),
        then: sequence(candidate.then, `${path}.then`),
        else: candidate.else === undefined ? undefined : sequence(candidate.else, `${path}.else`),
      };
    case "loop": {
      const loopKind = string(candidate.loopKind, `${path}.loopKind`) as LoopNode["loopKind"];
      if (!["for", "for-of", "for-in", "while", "do"].includes(loopKind)) {
        throw new FlowValidationError(`${path}.loopKind is invalid`);
      }
      return {
        id,
        kind,
        source,
        loopKind,
        initializer: optionalString(candidate.initializer, `${path}.initializer`),
        condition: optionalString(candidate.condition, `${path}.condition`),
        incrementor: optionalString(candidate.incrementor, `${path}.incrementor`),
        body: sequence(candidate.body, `${path}.body`),
      };
    }
    case "break":
    case "continue":
      return { id, kind, source, targetLabel: optionalString(candidate.targetLabel, `${path}.targetLabel`) };
    case "return":
    case "throw":
      return { id, kind, source, expression: optionalString(candidate.expression, `${path}.expression`) };
    case "try": {
      const catchValue = candidate.catch === undefined ? undefined : object(candidate.catch, `${path}.catch`);
      return {
        id,
        kind,
        source,
        body: sequence(candidate.body, `${path}.body`),
        catch: catchValue
          ? {
              variable: optionalString(catchValue.variable, `${path}.catch.variable`),
              body: sequence(catchValue.body, `${path}.catch.body`),
            }
          : undefined,
        finally: candidate.finally === undefined ? undefined : sequence(candidate.finally, `${path}.finally`),
      };
    }
    case "unsupported":
      return {
        id,
        kind,
        source,
        syntax: string(candidate.syntax, `${path}.syntax`),
        code: string(candidate.code, `${path}.code`),
        reason: string(candidate.reason, `${path}.reason`),
      };
    default:
      throw new FlowValidationError(`${path}.kind is unsupported: ${kind}`);
  }
}

export function validateFlowDocument(value: unknown): FlowDocument {
  const candidate = object(value, "document");
  if (candidate.formatVersion !== FORMAT_VERSION) {
    throw new FlowValidationError(`unsupported formatVersion: ${String(candidate.formatVersion)}`);
  }
  const fileLengths = new Map<string, number>();
  const files = array(candidate.files, "document.files").map((entry, index) => {
    const file = object(entry, `document.files[${index}]`);
    const id = string(file.id, `document.files[${index}].id`);
    if (fileLengths.has(id)) throw new FlowValidationError(`duplicate file id: ${id}`);
    const path = string(file.path, `document.files[${index}].path`);
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new FlowValidationError(`document.files[${index}].path must be project-relative`);
    }
    const source = string(file.source, `document.files[${index}].source`);
    fileLengths.set(id, source.length);
    return { id, path, contentHash: string(file.contentHash, `document.files[${index}].contentHash`), source };
  });
  const nodeIds = new Set<string>();
  const functionIds = new Set<string>();
  const referencedFunctions = new Set<string>();
  const functions = array(candidate.functions, "document.functions").map((entry, index) => {
    const fn = object(entry, `document.functions[${index}]`);
    const id = string(fn.id, `document.functions[${index}].id`);
    if (functionIds.has(id)) throw new FlowValidationError(`duplicate function id: ${id}`);
    functionIds.add(id);
    const body = node(fn.body, `document.functions[${index}].body`, fileLengths, nodeIds, referencedFunctions);
    if (body.kind !== "sequence") throw new FlowValidationError(`document.functions[${index}].body must be a sequence`);
    return {
      id,
      name: string(fn.name, `document.functions[${index}].name`),
      signature: string(fn.signature, `document.functions[${index}].signature`),
      source: span(fn.source, `document.functions[${index}].source`, fileLengths),
      description: optionalString(fn.description, `document.functions[${index}].description`),
      groupPath: fn.groupPath === undefined ? undefined : array(fn.groupPath, `document.functions[${index}].groupPath`).map((part, partIndex) => string(part, `document.functions[${index}].groupPath[${partIndex}]`)),
      body,
    };
  });
  const roots = array(candidate.roots, "document.roots").map((entry, index) => string(entry, `document.roots[${index}]`));
  for (const id of [...roots, ...referencedFunctions]) {
    if (!functionIds.has(id)) throw new FlowValidationError(`unknown function reference: ${id}`);
  }
  const project = object(candidate.project, "document.project");
  const coverage = object(candidate.coverage, "document.coverage");
  const coverageFiles = object(coverage.files, "document.coverage.files");
  const coverageFunctions = object(coverage.functions, "document.coverage.functions");
  const coverageNodes = object(coverage.nodes, "document.coverage.nodes");
  const status = string(coverage.status, "document.coverage.status") as CoverageStatus;
  if (status !== "complete" && status !== "partial") throw new FlowValidationError("document.coverage.status is invalid");
  const diagnostics = array(candidate.diagnostics, "document.diagnostics").map((entry, index) => {
    const diagnostic = object(entry, `document.diagnostics[${index}]`);
    const severity = string(diagnostic.severity, `document.diagnostics[${index}].severity`) as DiagnosticSeverity;
    if (severity !== "warning" && severity !== "error") throw new FlowValidationError(`document.diagnostics[${index}].severity is invalid`);
    return {
      severity,
      code: string(diagnostic.code, `document.diagnostics[${index}].code`),
      message: string(diagnostic.message, `document.diagnostics[${index}].message`),
      source: diagnostic.source === undefined ? undefined : span(diagnostic.source, `document.diagnostics[${index}].source`, fileLengths),
    };
  });
  return {
    formatVersion: FORMAT_VERSION,
    producerVersion: string(candidate.producerVersion, "document.producerVersion"),
    project: { name: string(project.name, "document.project.name"), tsconfig: string(project.tsconfig, "document.project.tsconfig") },
    files,
    functions,
    roots,
    diagnostics,
    coverage: {
      status,
      files: { scanned: number(coverageFiles.scanned, "document.coverage.files.scanned"), analyzed: number(coverageFiles.analyzed, "document.coverage.files.analyzed"), skipped: number(coverageFiles.skipped, "document.coverage.files.skipped") },
      functions: { discovered: number(coverageFunctions.discovered, "document.coverage.functions.discovered"), analyzed: number(coverageFunctions.analyzed, "document.coverage.functions.analyzed") },
      nodes: { supported: number(coverageNodes.supported, "document.coverage.nodes.supported"), unsupported: number(coverageNodes.unsupported, "document.coverage.nodes.unsupported") },
    },
  };
}
