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
  when?: "truthy" | "falsy" | "nullish" | "non-nullish";
  then: SequenceNode;
  else?: SequenceNode;
};
export type LoopNode = BaseNode & {
  kind: "loop";
  loopKind: "for" | "for-of" | "for-in" | "while" | "do";
  initializer?: string;
  condition?: string;
  incrementor?: string;
  initializerFlow?: SequenceNode;
  conditionFlow?: SequenceNode;
  incrementorFlow?: SequenceNode;
  body: SequenceNode;
};
export type JumpNode = BaseNode & {
  kind: "break" | "continue";
  targetId?: string;
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
  finallyOverrides?: boolean;
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

export type FlowModule = {
  id: string;
  source: SourceSpan;
  body: SequenceNode;
};

export type EntryPointTarget = {
  role: "handler" | "middleware" | "component" | "loader" | "action" | "module";
  functionId?: string;
  moduleId?: string;
  source?: SourceSpan;
  expression: string;
  status: CoverageStatus;
  reason?: string;
};

export type EntryPoint = {
  id: string;
  kind: "endpoint" | "page" | "script" | "manual";
  framework?: "nestjs" | "express" | "react-router" | "vue-router";
  label: string;
  path?: string;
  method?: string;
  source?: SourceSpan;
  command?: string;
  origin?: { kind: "package-script" | "bin" | "explicit"; name: string };
  targets: EntryPointTarget[];
  status: CoverageStatus;
  reasons: string[];
};

export type FlowDocument = {
  formatVersion: 1;
  producerVersion: string;
  project: { name: string; tsconfig: string };
  files: Array<{ id: string; path: string; contentHash: string; source: string }>;
  functions: FlowFunction[];
  modules?: FlowModule[];
  entrypoints?: EntryPoint[];
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
    modules?: { analyzed: number; nodes: { supported: number; unsupported: number } };
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

const boolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") throw new FlowValidationError(`${path} must be a boolean`);
  return value;
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

const enumValue = <T extends string>(value: unknown, path: string, allowed: readonly T[]): T => {
  const result = string(value, path) as T;
  if (!allowed.includes(result)) throw new FlowValidationError(`${path} is invalid`);
  return result;
};

function node(
  value: unknown,
  path: string,
  fileLengths: Map<string, number>,
  nodeIds: Set<string>,
  activeLoopIds: string[],
  referencedFunctions: Set<string>,
): FlowNode {
  const candidate = object(value, path);
  const id = string(candidate.id, `${path}.id`);
  if (nodeIds.has(id)) throw new FlowValidationError(`duplicate node id: ${id}`);
  nodeIds.add(id);
  const source = span(candidate.source, `${path}.source`, fileLengths);
  const kind = string(candidate.kind, `${path}.kind`);
  const sequence = (entry: unknown, childPath: string, loops = activeLoopIds): SequenceNode => {
    const result = node(entry, childPath, fileLengths, nodeIds, loops, referencedFunctions);
    if (result.kind !== "sequence") throw new FlowValidationError(`${childPath} must be a sequence`);
    return result;
  };
  const children = (entry: unknown, childPath: string) =>
    array(entry, childPath).map((child, index) => node(child, `${childPath}[${index}]`, fileLengths, nodeIds, activeLoopIds, referencedFunctions));

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
      let annotation: CallAnnotation | undefined;
      if (candidate.annotation !== undefined) {
        const rawAnnotation = object(candidate.annotation, `${path}.annotation`);
        const unknownFields = Object.keys(rawAnnotation).filter((key) => key !== "label" && key !== "args");
        if (unknownFields.length) throw new FlowValidationError(`${path}.annotation has unknown fields: ${unknownFields.join(", ")}`);
        let args: Record<string, string> | undefined;
        if (rawAnnotation.args !== undefined) {
          const rawArgs = object(rawAnnotation.args, `${path}.annotation.args`);
          args = Object.fromEntries(Object.entries(rawArgs).map(([key, description]) => [key, string(description, `${path}.annotation.args.${key}`)]));
        }
        annotation = { label: optionalString(rawAnnotation.label, `${path}.annotation.label`), args };
      }
      return {
        id,
        kind,
        source,
        calleeExpression: string(candidate.calleeExpression, `${path}.calleeExpression`),
        args,
        awaited: boolean(candidate.awaited, `${path}.awaited`),
        targetFunctionId,
        boundary,
        annotation,
      };
    }
    case "branch": {
      const when = optionalString(candidate.when, `${path}.when`) as BranchNode["when"];
      if (when && !["truthy", "falsy", "nullish", "non-nullish"].includes(when)) {
        throw new FlowValidationError(`${path}.when is invalid`);
      }
      return {
        id,
        kind,
        source,
        condition: string(candidate.condition, `${path}.condition`),
        when,
        then: sequence(candidate.then, `${path}.then`),
        else: candidate.else === undefined ? undefined : sequence(candidate.else, `${path}.else`),
      };
    }
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
        initializerFlow: candidate.initializerFlow === undefined ? undefined : sequence(candidate.initializerFlow, `${path}.initializerFlow`),
        conditionFlow: candidate.conditionFlow === undefined ? undefined : sequence(candidate.conditionFlow, `${path}.conditionFlow`),
        incrementorFlow: candidate.incrementorFlow === undefined ? undefined : sequence(candidate.incrementorFlow, `${path}.incrementorFlow`),
        body: sequence(candidate.body, `${path}.body`, [...activeLoopIds, id]),
      };
    }
    case "break":
    case "continue": {
      const targetId = optionalString(candidate.targetId, `${path}.targetId`);
      if (targetId && !activeLoopIds.includes(targetId)) throw new FlowValidationError(`unknown jump target: ${targetId}`);
      return { id, kind, source, targetId, targetLabel: optionalString(candidate.targetLabel, `${path}.targetLabel`) };
    }
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
        finallyOverrides: candidate.finallyOverrides === undefined ? undefined : boolean(candidate.finallyOverrides, `${path}.finallyOverrides`),
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
    if (path.startsWith("/") || /^[A-Za-z]:\//.test(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
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
    const body = node(fn.body, `document.functions[${index}].body`, fileLengths, nodeIds, [], referencedFunctions);
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
  const moduleIds = new Set<string>();
  const modules = candidate.modules === undefined ? undefined : array(candidate.modules, "document.modules").map((entry, index) => {
    const module = object(entry, `document.modules[${index}]`);
    const id = string(module.id, `document.modules[${index}].id`);
    if (moduleIds.has(id)) throw new FlowValidationError(`duplicate module id: ${id}`);
    moduleIds.add(id);
    const body = node(module.body, `document.modules[${index}].body`, fileLengths, nodeIds, [], referencedFunctions);
    if (body.kind !== "sequence") throw new FlowValidationError(`document.modules[${index}].body must be a sequence`);
    return { id, source: span(module.source, `document.modules[${index}].source`, fileLengths), body };
  });
  const roots = array(candidate.roots, "document.roots").map((entry, index) => string(entry, `document.roots[${index}]`));
  if (new Set(roots).size !== roots.length) throw new FlowValidationError("document.roots contains duplicate ids");
  for (const id of [...roots, ...referencedFunctions]) {
    if (!functionIds.has(id)) throw new FlowValidationError(`unknown function reference: ${id}`);
  }
  const entryIds = new Set<string>();
  const entrypoints = candidate.entrypoints === undefined ? undefined : array(candidate.entrypoints, "document.entrypoints").map((entry, index) => {
    const raw = object(entry, `document.entrypoints[${index}]`);
    const entryPath = `document.entrypoints[${index}]`;
    const id = string(raw.id, `${entryPath}.id`);
    if (entryIds.has(id)) throw new FlowValidationError(`duplicate entrypoint id: ${id}`);
    entryIds.add(id);
    const kind = enumValue(raw.kind, `${entryPath}.kind`, ["endpoint", "page", "script", "manual"] as const);
    const framework = raw.framework === undefined ? undefined : enumValue(raw.framework, `${entryPath}.framework`, ["nestjs", "express", "react-router", "vue-router"] as const);
    const status = enumValue(raw.status, `${entryPath}.status`, ["complete", "partial"] as const);
    const source = raw.source === undefined ? undefined : span(raw.source, `${entryPath}.source`, fileLengths);
    const method = optionalString(raw.method, `${entryPath}.method`);
    const pathValue = optionalString(raw.path, `${entryPath}.path`);
    let origin: EntryPoint["origin"];
    if (raw.origin !== undefined) {
      const value = object(raw.origin, `${entryPath}.origin`);
      origin = { kind: enumValue(value.kind, `${entryPath}.origin.kind`, ["package-script", "bin", "explicit"] as const), name: string(value.name, `${entryPath}.origin.name`) };
    }
    const targets = array(raw.targets, `${entryPath}.targets`).map((target, targetIndex) => {
      const value = object(target, `${entryPath}.targets[${targetIndex}]`);
      const targetPath = `${entryPath}.targets[${targetIndex}]`;
      const targetStatus = enumValue(value.status, `${targetPath}.status`, ["complete", "partial"] as const);
      const functionId = optionalString(value.functionId, `${targetPath}.functionId`);
      const moduleId = optionalString(value.moduleId, `${targetPath}.moduleId`);
      const targetSource = value.source === undefined ? undefined : span(value.source, `${targetPath}.source`, fileLengths);
      const reason = optionalString(value.reason, `${targetPath}.reason`);
      if (functionId && moduleId) throw new FlowValidationError(`${targetPath} cannot reference both functionId and moduleId`);
      if (functionId && !functionIds.has(functionId)) throw new FlowValidationError(`unknown function reference: ${functionId}`);
      if (moduleId && !moduleIds.has(moduleId)) throw new FlowValidationError(`unknown module reference: ${moduleId}`);
      if (targetStatus === "complete" && !functionId && !moduleId && !targetSource) throw new FlowValidationError(`${targetPath} complete target requires a reference`);
      if (targetStatus === "partial" && !reason) throw new FlowValidationError(`${targetPath}.reason is required for partial targets`);
      return {
        role: enumValue(value.role, `${targetPath}.role`, ["handler", "middleware", "component", "loader", "action", "module"] as const),
        functionId,
        moduleId,
        source: targetSource,
        expression: string(value.expression, `${targetPath}.expression`),
        status: targetStatus,
        reason,
      };
    });
    const reasons = array(raw.reasons, `${entryPath}.reasons`).map((reason, reasonIndex) => string(reason, `${entryPath}.reasons[${reasonIndex}]`));
    if (kind === "endpoint" && !method) throw new FlowValidationError(`${entryPath}.method is required for endpoints`);
    if (kind === "script" && !origin) throw new FlowValidationError(`${entryPath}.origin is required for scripts`);
    if (kind !== "script" && !source) throw new FlowValidationError(`${entryPath}.source is required`);
    if (status === "complete" && (!targets.length || targets.some((target) => target.status === "partial") || reasons.length)) throw new FlowValidationError(`${entryPath} complete entrypoint is inconsistent`);
    if (status === "partial" && !reasons.length && !targets.some((target) => target.status === "partial")) throw new FlowValidationError(`${entryPath}.reasons is required for partial entrypoints`);
    return {
      id,
      kind,
      framework,
      label: string(raw.label, `${entryPath}.label`),
      path: pathValue,
      method,
      source,
      command: optionalString(raw.command, `${entryPath}.command`),
      origin,
      targets,
      status,
      reasons,
    };
  });
  const project = object(candidate.project, "document.project");
  const coverage = object(candidate.coverage, "document.coverage");
  const coverageFiles = object(coverage.files, "document.coverage.files");
  const coverageFunctions = object(coverage.functions, "document.coverage.functions");
  const coverageNodes = object(coverage.nodes, "document.coverage.nodes");
  const moduleCoverageValue = coverage.modules === undefined ? undefined : object(coverage.modules, "document.coverage.modules");
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
  const fileCoverage = { scanned: number(coverageFiles.scanned, "document.coverage.files.scanned"), analyzed: number(coverageFiles.analyzed, "document.coverage.files.analyzed"), skipped: number(coverageFiles.skipped, "document.coverage.files.skipped") };
  const functionCoverage = { discovered: number(coverageFunctions.discovered, "document.coverage.functions.discovered"), analyzed: number(coverageFunctions.analyzed, "document.coverage.functions.analyzed") };
  const nodeCoverage = { supported: number(coverageNodes.supported, "document.coverage.nodes.supported"), unsupported: number(coverageNodes.unsupported, "document.coverage.nodes.unsupported") };
  const moduleCoverage = moduleCoverageValue === undefined ? undefined : {
    analyzed: number(moduleCoverageValue.analyzed, "document.coverage.modules.analyzed"),
    nodes: (() => {
      const nodes = object(moduleCoverageValue.nodes, "document.coverage.modules.nodes");
      return { supported: number(nodes.supported, "document.coverage.modules.nodes.supported"), unsupported: number(nodes.unsupported, "document.coverage.modules.nodes.unsupported") };
    })(),
  };
  const countNodes = (entry: FlowNode): { supported: number; unsupported: number } => {
    const nested = entry.kind === "sequence" ? entry.children
      : entry.kind === "branch" ? [entry.then, ...(entry.else ? [entry.else] : [])]
      : entry.kind === "loop" ? [entry.body, ...[entry.initializerFlow, entry.conditionFlow, entry.incrementorFlow].filter((child): child is SequenceNode => Boolean(child))]
      : entry.kind === "try" ? [entry.body, ...[entry.catch?.body, entry.finally].filter((child): child is SequenceNode => Boolean(child))]
      : [];
    const children = nested.map(countNodes).reduce((total, child) => ({ supported: total.supported + child.supported, unsupported: total.unsupported + child.unsupported }), { supported: 0, unsupported: 0 });
    if (entry.kind === "sequence") return children;
    if (entry.kind === "unsupported") return { supported: children.supported, unsupported: children.unsupported + 1 };
    return { supported: children.supported + 1, unsupported: children.unsupported };
  };
  const actualNodes = functions.map((fn) => countNodes(fn.body)).reduce((total, child) => ({ supported: total.supported + child.supported, unsupported: total.unsupported + child.unsupported }), { supported: 0, unsupported: 0 });
  const actualModuleNodes = (modules ?? []).map((module) => countNodes(module.body)).reduce((total, child) => ({ supported: total.supported + child.supported, unsupported: total.unsupported + child.unsupported }), { supported: 0, unsupported: 0 });
  if (fileCoverage.scanned !== fileCoverage.analyzed + fileCoverage.skipped || fileCoverage.analyzed !== files.length) {
    throw new FlowValidationError("document.coverage.files is inconsistent");
  }
  if (functionCoverage.discovered < functionCoverage.analyzed || functionCoverage.analyzed !== functions.length) {
    throw new FlowValidationError("document.coverage.functions is inconsistent");
  }
  if (nodeCoverage.supported !== actualNodes.supported || nodeCoverage.unsupported !== actualNodes.unsupported) {
    throw new FlowValidationError("document.coverage.nodes is inconsistent");
  }
  if ((modules === undefined) !== (moduleCoverage === undefined) || moduleCoverage && (moduleCoverage.analyzed !== modules?.length || moduleCoverage.nodes.supported !== actualModuleNodes.supported || moduleCoverage.nodes.unsupported !== actualModuleNodes.unsupported)) {
    throw new FlowValidationError("document.coverage.modules is inconsistent");
  }
  if (status === "complete" && (nodeCoverage.unsupported > 0 || (moduleCoverage?.nodes.unsupported ?? 0) > 0 || diagnostics.length > 0)) {
    throw new FlowValidationError("complete coverage cannot contain unsupported nodes or diagnostics");
  }
  return {
    formatVersion: FORMAT_VERSION,
    producerVersion: string(candidate.producerVersion, "document.producerVersion"),
    project: { name: string(project.name, "document.project.name"), tsconfig: string(project.tsconfig, "document.project.tsconfig") },
    files,
    functions,
    modules,
    entrypoints,
    roots,
    diagnostics,
    coverage: {
      status,
      files: fileCoverage,
      functions: functionCoverage,
      nodes: nodeCoverage,
      modules: moduleCoverage,
    },
  };
}
