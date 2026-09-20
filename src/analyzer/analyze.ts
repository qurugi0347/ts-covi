import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  FORMAT_VERSION,
  validateFlowDocument,
  type BoundaryKind,
  type CallNode,
  type FlowDocument,
  type FlowFunction,
  type FlowNode,
  type SequenceNode,
  type SourceSpan,
} from "../model/flow.js";

const PRODUCER_VERSION = "0.1.0";

type IndexedFunction = {
  declaration: ts.FunctionLikeDeclaration;
  sourceFile: ts.SourceFile;
  fileId: string;
  id: string;
};

type AnalyzeContext = {
  checker: ts.TypeChecker;
  functionIds: Map<ts.Node, string>;
  sourceFile: ts.SourceFile;
  fileId: string;
  diagnostics: FlowDocument["diagnostics"];
  supported: number;
  unsupported: number;
  nextNodeId: () => string;
};

const posix = (value: string): string => value.split(path.sep).join("/");

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const readIgnorePatterns = (root: string): string[] => {
  try {
    return readFileSync(path.join(root, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("!") && !line.startsWith("#"));
  } catch {
    return [];
  }
};

const ignored = (relativePath: string, patterns: string[]): boolean => patterns.some((raw) => {
  const pattern = raw.replace(/^\//, "").replace(/\/$/, "");
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("**", ".*").replaceAll("*", "[^/]*");
  return new RegExp(`(?:^|/)${escaped}(?:/|$)`).test(relativePath);
});

const sourceSpan = (sourceFile: ts.SourceFile, fileId: string, node: ts.Node): SourceSpan => {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
  const endPosition = sourceFile.getLineAndCharacterOfPosition(end);
  return {
    fileId,
    start,
    end,
    startLine: startPosition.line + 1,
    startColumn: startPosition.character + 1,
    endLine: endPosition.line + 1,
    endColumn: endPosition.character + 1,
  };
};

const supportedFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);

const functionName = (node: ts.FunctionLikeDeclaration): string => {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText();
  return `<anonymous@${node.getStart()}>`;
};

const functionBody = (node: ts.FunctionLikeDeclaration): ts.ConciseBody | undefined => node.body;

const sequence = (context: AnalyzeContext, owner: ts.Node, children: FlowNode[]): SequenceNode => ({
  id: context.nextNodeId(),
  kind: "sequence",
  source: sourceSpan(context.sourceFile, context.fileId, owner),
  children,
});

const unsupported = (context: AnalyzeContext, node: ts.Node, reason: string): FlowNode => {
  context.unsupported += 1;
  const source = sourceSpan(context.sourceFile, context.fileId, node);
  context.diagnostics.push({ severity: "warning", code: "UNSUPPORTED_SYNTAX", message: reason, source });
  return { id: context.nextNodeId(), kind: "unsupported", source, syntax: ts.SyntaxKind[node.kind], code: node.getText(context.sourceFile), reason };
};

const declarationTarget = (declaration: ts.Declaration | undefined, ids: Map<ts.Node, string>): string | undefined => {
  let current: ts.Node | undefined = declaration;
  while (current) {
    const id = ids.get(current);
    if (id) return id;
    current = current.parent;
  }
  return undefined;
};

const resolveCall = (context: AnalyzeContext, call: ts.CallExpression): { targetFunctionId?: string; boundary?: BoundaryKind } => {
  const declaration = context.checker.getResolvedSignature(call)?.declaration;
  const targetFunctionId = declarationTarget(declaration, context.functionIds);
  if (targetFunctionId) return { targetFunctionId };
  if (declaration) {
    const sourceFile = declaration.getSourceFile();
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(`${path.sep}node_modules${path.sep}`)) return { boundary: "external" };
    return { boundary: "runtime" };
  }
  return { boundary: "unresolved" };
};

const expressionNodes = (context: AnalyzeContext, expression: ts.Expression, awaited = false): FlowNode[] => {
  if (ts.isAwaitExpression(expression)) return expressionNodes(context, expression.expression, true);
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return expressionNodes(context, expression.expression, awaited);
  }
  if (ts.isCallExpression(expression)) {
    const children: FlowNode[] = [];
    if (ts.isPropertyAccessExpression(expression.expression) || ts.isElementAccessExpression(expression.expression)) {
      children.push(...expressionNodes(context, expression.expression.expression));
    }
    for (const argument of expression.arguments) {
      if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) children.push(...expressionNodes(context, argument));
    }
    const resolution = resolveCall(context, expression);
    const call: CallNode = {
      id: context.nextNodeId(),
      kind: "call",
      source: sourceSpan(context.sourceFile, context.fileId, expression),
      calleeExpression: expression.expression.getText(context.sourceFile),
      args: expression.arguments.map((argument) => ({ expression: argument.getText(context.sourceFile) })),
      awaited,
      ...resolution,
    };
    context.supported += 1;
    if (resolution.boundary === "unresolved" || resolution.boundary === "runtime") {
      context.diagnostics.push({
        severity: "warning",
        code: resolution.boundary === "runtime" ? "RUNTIME_BINDING" : "UNRESOLVED_CALL",
        message: `Cannot statically resolve ${call.calleeExpression}`,
        source: call.source,
      });
    }
    children.push(call);
    return children;
  }
  if (ts.isNewExpression(expression)) {
    const children = expression.arguments?.flatMap((argument) => expressionNodes(context, argument)) ?? [];
    children.push(unsupported(context, expression, "Constructor calls are not supported yet."));
    return children;
  }
  if (ts.isBinaryExpression(expression)) return [...expressionNodes(context, expression.left), ...expressionNodes(context, expression.right)];
  if (ts.isConditionalExpression(expression)) return [unsupported(context, expression, "Conditional expressions are handled in M3.")];
  if (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) return [];
  if (ts.isPropertyAccessExpression(expression)) return expressionNodes(context, expression.expression);
  if (ts.isElementAccessExpression(expression)) return [...expressionNodes(context, expression.expression), ...expressionNodes(context, expression.argumentExpression)];
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.flatMap((element) => ts.isExpression(element) ? expressionNodes(context, element) : []);
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property)) return expressionNodes(context, property.initializer);
    if (ts.isSpreadAssignment(property)) return expressionNodes(context, property.expression);
    return [];
  });
  if (ts.isTemplateExpression(expression)) return expression.templateSpans.flatMap((part) => expressionNodes(context, part.expression));
  if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
    return [unsupported(context, expression, "JSX is preserved as an opaque expression.")];
  }
  return [];
};

const statementNodes = (context: AnalyzeContext, statement: ts.Statement): { nodes: FlowNode[]; terminates: boolean } => {
  if (ts.isVariableStatement(statement)) {
    const calls = statement.declarationList.declarations.flatMap((declaration) => declaration.initializer ? expressionNodes(context, declaration.initializer) : []);
    context.supported += 1;
    return { nodes: [...calls, { id: context.nextNodeId(), kind: "statement", source: sourceSpan(context.sourceFile, context.fileId, statement), code: statement.getText(context.sourceFile) }], terminates: false };
  }
  if (ts.isExpressionStatement(statement)) {
    const calls = expressionNodes(context, statement.expression);
    const onlyCall = ts.isCallExpression(statement.expression) || (ts.isAwaitExpression(statement.expression) && ts.isCallExpression(statement.expression.expression));
    if (onlyCall) return { nodes: calls, terminates: false };
    context.supported += 1;
    return { nodes: [...calls, { id: context.nextNodeId(), kind: "statement", source: sourceSpan(context.sourceFile, context.fileId, statement), code: statement.getText(context.sourceFile) }], terminates: false };
  }
  if (ts.isReturnStatement(statement)) {
    const calls = statement.expression ? expressionNodes(context, statement.expression) : [];
    context.supported += 1;
    return { nodes: [...calls, { id: context.nextNodeId(), kind: "return", source: sourceSpan(context.sourceFile, context.fileId, statement), expression: statement.expression?.getText(context.sourceFile) }], terminates: true };
  }
  if (ts.isEmptyStatement(statement)) return { nodes: [], terminates: false };
  return { nodes: [unsupported(context, statement, `${ts.SyntaxKind[statement.kind]} is handled in a later milestone.`)], terminates: false };
};

const analyzeBody = (context: AnalyzeContext, body: ts.ConciseBody): SequenceNode => {
  if (!ts.isBlock(body)) {
    const nodes = [...expressionNodes(context, body), { id: context.nextNodeId(), kind: "return" as const, source: sourceSpan(context.sourceFile, context.fileId, body), expression: body.getText(context.sourceFile) }];
    context.supported += 1;
    return sequence(context, body, nodes);
  }
  const nodes: FlowNode[] = [];
  for (const statement of body.statements) {
    const result = statementNodes(context, statement);
    nodes.push(...result.nodes);
    if (result.terminates) break;
  }
  return sequence(context, body, nodes);
};

export function analyzeProject(tsconfigPath: string, excludedPaths: string[] = []): FlowDocument {
  const absoluteConfig = path.resolve(tsconfigPath);
  const configResult = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
  if (configResult.error) throw new Error(ts.flattenDiagnosticMessageText(configResult.error.messageText, "\n"));
  const projectRoot = realpathSync(path.dirname(absoluteConfig));
  const parsed = ts.parseJsonConfigFileContent(configResult.config, ts.sys, projectRoot, { noEmit: true }, absoluteConfig);
  if (parsed.errors.length) throw new Error(parsed.errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")).join("\n"));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
  const checker = program.getTypeChecker();
  const diagnostics: FlowDocument["diagnostics"] = [];
  if (parsed.projectReferences?.length) diagnostics.push({ severity: "warning", code: "PROJECT_REFERENCES_UNSUPPORTED", message: "Project references are not analyzed as separate projects." });
  const ignorePatterns = readIgnorePatterns(projectRoot);
  const excluded = excludedPaths.map((entry) => path.resolve(entry));
  let skipped = 0;
  const sourceFiles = program.getSourceFiles().filter((sourceFile) => {
    if (sourceFile.isDeclarationFile) return false;
    let real: string;
    try { real = realpathSync(sourceFile.fileName); } catch { skipped += 1; return false; }
    const relative = posix(path.relative(projectRoot, real));
    const include = isWithin(projectRoot, real) && !relative.startsWith("node_modules/") && !ignored(relative, ignorePatterns) && !excluded.includes(real);
    if (!include) skipped += 1;
    return include;
  });
  const files = sourceFiles.map((sourceFile) => {
    const relativePath = posix(path.relative(projectRoot, realpathSync(sourceFile.fileName)));
    return { id: `file:${relativePath}`, path: relativePath, contentHash: createHash("sha256").update(sourceFile.text).digest("hex"), source: sourceFile.text };
  });
  const fileIds = new Map(files.map((file) => [file.path, file.id]));
  const indexed: IndexedFunction[] = [];
  for (const sourceFile of sourceFiles) {
    const relativePath = posix(path.relative(projectRoot, realpathSync(sourceFile.fileName)));
    const fileId = fileIds.get(relativePath)!;
    const visit = (node: ts.Node) => {
      if (supportedFunction(node) && functionBody(node)) {
        indexed.push({ declaration: node, sourceFile, fileId, id: `fn:${relativePath}:${node.getStart(sourceFile)}:${node.getEnd()}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const functionIds = new Map<ts.Node, string>(indexed.map((entry) => [entry.declaration, entry.id]));
  let supported = 0;
  let unsupportedCount = 0;
  const functions: FlowFunction[] = indexed.map((entry) => {
    let counter = 0;
    const context: AnalyzeContext = {
      checker,
      functionIds,
      sourceFile: entry.sourceFile,
      fileId: entry.fileId,
      diagnostics,
      supported: 0,
      unsupported: 0,
      nextNodeId: () => `${entry.id}:node:${counter++}`,
    };
    const signature = checker.getSignatureFromDeclaration(entry.declaration);
    const body = analyzeBody(context, functionBody(entry.declaration)!);
    supported += context.supported;
    unsupportedCount += context.unsupported;
    return {
      id: entry.id,
      name: functionName(entry.declaration),
      signature: signature ? checker.signatureToString(signature) : entry.declaration.getText(entry.sourceFile).slice(0, 120),
      source: sourceSpan(entry.sourceFile, entry.fileId, entry.declaration),
      body,
    };
  });
  const unresolved = diagnostics.some((entry) => entry.code !== "PROJECT_REFERENCES_UNSUPPORTED" || parsed.projectReferences?.length);
  const result: FlowDocument = {
    formatVersion: FORMAT_VERSION,
    producerVersion: PRODUCER_VERSION,
    project: { name: path.basename(projectRoot), tsconfig: posix(path.relative(projectRoot, absoluteConfig)) || "tsconfig.json" },
    files,
    functions,
    roots: functions.map((entry) => entry.id),
    diagnostics,
    coverage: {
      status: unsupportedCount || unresolved ? "partial" : "complete",
      files: { scanned: sourceFiles.length + skipped, analyzed: sourceFiles.length, skipped },
      functions: { discovered: indexed.length, analyzed: functions.length },
      nodes: { supported, unsupported: unsupportedCount },
    },
  };
  return validateFlowDocument(result);
}
