import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import createIgnore from "ignore";
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
  jumpTargets: Array<{ id: string; label?: string }>;
  nextNodeId: () => string;
};

type ParsedCallAnnotation = { label?: string; args?: Record<string, string> };

const posix = (value: string): string => value.split(path.sep).join("/");

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const readIgnorePatterns = (root: string): string => {
  try {
    return readFileSync(path.join(root, ".gitignore"), "utf8");
  } catch {
    return "";
  }
};

const optionalChainBase = (expression: ts.Expression): { base?: ts.Expression; boundaries: number } => {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return optionalChainBase(expression.expression);
  }
  if (ts.isCallExpression(expression) || ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const nested = optionalChainBase(expression.expression);
    return expression.questionDotToken
      ? { base: nested.base ?? expression.expression, boundaries: nested.boundaries + 1 }
      : nested;
  }
  return { boundaries: 0 };
};

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
  if (node.name) return node.name.getText(node.getSourceFile());
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText();
  return `<anonymous@${node.getStart()}>`;
};

const functionBody = (node: ts.FunctionLikeDeclaration): ts.ConciseBody | undefined => node.body;

const functionMetadata = (sourceFile: ts.SourceFile, node: ts.FunctionLikeDeclaration): { description?: string; groupPath?: string[]; root: boolean } => {
  let owner: ts.Node = node;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
    owner = node.parent.parent.parent;
  } else if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) {
    owner = node.parent;
  }
  const trivia = sourceFile.text.slice(owner.getFullStart(), owner.getStart(sourceFile));
  const match = trivia.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  if (!match) return { root: false };
  const lines = match[1]!.split(/\r?\n/).map((line) => line.replace(/^\s*\*?\s?/, "").trim());
  const description = lines.filter((line) => line && !line.startsWith("@")).join(" ") || undefined;
  const tags = new Map(lines.filter((line) => line.startsWith("@")).map((line) => {
    const [tag, ...rest] = line.slice(1).split(/\s+/);
    return [tag, rest.join(" ").trim()] as const;
  }));
  const covi = tags.get("covi") || undefined;
  const group = tags.get("covi-group");
  return {
    description: description ?? covi,
    groupPath: group?.split("/").map((part) => part.trim()).filter(Boolean),
    root: tags.has("covi-root"),
  };
};

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

const resolveCall = (context: AnalyzeContext, call: ts.CallLikeExpression): { targetFunctionId?: string; boundary?: BoundaryKind } => {
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

const recordBoundaryDiagnostic = (context: AnalyzeContext, call: CallNode): void => {
  if (call.boundary !== "unresolved" && call.boundary !== "runtime") return;
  context.diagnostics.push({ severity: "warning", code: call.boundary === "runtime" ? "RUNTIME_BINDING" : "UNRESOLVED_CALL", message: `Cannot statically resolve ${call.calleeExpression}`, source: call.source });
};

const createCallNode = (context: AnalyzeContext, expression: ts.CallExpression, awaited: boolean): CallNode => {
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
  recordBoundaryDiagnostic(context, call);
  return call;
};

const unwrapCall = (expression: ts.Expression | undefined): ts.CallExpression | undefined => {
  if (!expression) return undefined;
  if (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return unwrapCall(expression.expression);
  }
  return ts.isCallExpression(expression) ? expression : undefined;
};

const topLevelCalls = (statement: ts.Statement): ts.CallExpression[] => {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.map((declaration) => unwrapCall(declaration.initializer)).filter((call): call is ts.CallExpression => Boolean(call));
  if (ts.isExpressionStatement(statement)) return [unwrapCall(statement.expression)].filter((call): call is ts.CallExpression => Boolean(call));
  if (ts.isReturnStatement(statement)) return [unwrapCall(statement.expression)].filter((call): call is ts.CallExpression => Boolean(call));
  return [];
};

const parseCallAnnotation = (context: AnalyzeContext, statement: ts.Statement): ParsedCallAnnotation | undefined => {
  const source = context.sourceFile.text;
  const triviaStart = statement.getFullStart();
  const statementStart = statement.getStart(context.sourceFile);
  const trivia = source.slice(triviaStart, statementStart);
  const marker = trivia.lastIndexOf("@covi-call");
  if (marker < 0) return undefined;
  const lineStart = trivia.lastIndexOf("\n", marker) + 1;
  const lineEndValue = trivia.indexOf("\n", marker);
  const lineEnd = lineEndValue < 0 ? trivia.length : lineEndValue;
  const prefix = trivia.slice(lineStart, marker);
  const remainder = trivia.slice(lineEnd, trivia.length);
  if (!prefix.includes("//") || remainder.trim()) return undefined;
  const raw = trivia.slice(marker + "@covi-call".length, lineEnd).trim();
  const diagnostic = (code: string, message: string) => context.diagnostics.push({ severity: "warning", code, message, source: sourceSpan(context.sourceFile, context.fileId, statement) });
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("annotation must be an object");
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "label" && key !== "args")) throw new Error("only label and args are allowed");
    if (record.label !== undefined && typeof record.label !== "string") throw new Error("label must be a string");
    let args: Record<string, string> | undefined;
    if (record.args !== undefined) {
      if (!record.args || typeof record.args !== "object" || Array.isArray(record.args)) throw new Error("args must be an object");
      const entries = Object.entries(record.args as Record<string, unknown>);
      if (entries.some(([, value]) => typeof value !== "string")) throw new Error("arg descriptions must be strings");
      args = Object.fromEntries(entries) as Record<string, string>;
    }
    return { label: record.label as string | undefined, args };
  } catch (cause) {
    diagnostic("INVALID_COVI_CALL", `Invalid @covi-call JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    return undefined;
  }
};

const applyCallAnnotation = (context: AnalyzeContext, statement: ts.Statement, nodes: FlowNode[]): FlowNode[] => {
  const annotation = parseCallAnnotation(context, statement);
  if (!annotation) return nodes;
  const candidates = topLevelCalls(statement);
  const source = sourceSpan(context.sourceFile, context.fileId, statement);
  if (candidates.length !== 1) {
    context.diagnostics.push({ severity: "warning", code: candidates.length ? "AMBIGUOUS_COVI_CALL" : "ORPHAN_COVI_CALL", message: candidates.length ? "@covi-call has multiple top-level call candidates." : "@covi-call has no supported top-level call.", source });
    return nodes;
  }
  const candidate = candidates[0]!;
  const call = nodes.find((node): node is CallNode => node.kind === "call" && node.source.start === candidate.getStart(context.sourceFile) && node.source.end === candidate.getEnd());
  if (!call) {
    context.diagnostics.push({ severity: "warning", code: "ORPHAN_COVI_CALL", message: "@covi-call target was not emitted.", source });
    return nodes;
  }
  call.annotation = annotation;
  for (const [expression, description] of Object.entries(annotation.args ?? {})) {
    const matching = call.args.map((argument, index) => argument.expression === expression ? index : -1).filter((index) => index >= 0);
    if (matching.length !== 1 || expression.startsWith("...")) {
      context.diagnostics.push({ severity: "warning", code: matching.length > 1 ? "DUPLICATE_ANNOTATION_ARG" : expression.startsWith("...") ? "SPREAD_ANNOTATION_ARG" : "UNMATCHED_ANNOTATION_ARG", message: `Cannot uniquely match annotated argument: ${expression}`, source: call.source });
      continue;
    }
    call.args[matching[0]!]!.annotation = description;
  }
  return nodes;
};

const expressionNodes = (context: AnalyzeContext, expression: ts.Expression, awaited = false): FlowNode[] => {
  const afterBase = (current: ts.Expression, base: ts.Expression): FlowNode[] => {
    if (current === base) return [];
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) return afterBase(current.expression, base);
    if (ts.isPropertyAccessExpression(current)) return afterBase(current.expression, base);
    if (ts.isElementAccessExpression(current)) return [...afterBase(current.expression, base), ...expressionNodes(context, current.argumentExpression)];
    if (ts.isCallExpression(current)) {
      const args = current.arguments.flatMap((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument) ? [] : expressionNodes(context, argument));
      return [...afterBase(current.expression, base), ...args, createCallNode(context, current, false)];
    }
    return expressionNodes(context, current);
  };
  if (ts.isAwaitExpression(expression)) return expressionNodes(context, expression.expression, true);
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return expressionNodes(context, expression.expression, awaited);
  }
  if (ts.isCallExpression(expression)) {
    const optional = optionalChainBase(expression);
    if (optional.base) {
      const before = expressionNodes(context, optional.base);
      if (optional.boundaries > 1) return [...before, unsupported(context, expression, "Multiple optional chain boundaries are preserved as an opaque expression.")];
      const conditional = [...afterBase(expression.expression, optional.base), ...expression.arguments.flatMap((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument) ? [] : expressionNodes(context, argument))];
      conditional.push(createCallNode(context, expression, awaited));
      const then = sequence(context, expression, conditional);
      context.supported += 1;
      return [...before, { id: context.nextNodeId(), kind: "branch", source: sourceSpan(context.sourceFile, context.fileId, expression), condition: optional.base.getText(context.sourceFile), when: "non-nullish", then }];
    }
    const children = expressionNodes(context, expression.expression);
    for (const argument of expression.arguments) {
      if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) children.push(...expressionNodes(context, argument));
    }
    children.push(createCallNode(context, expression, awaited));
    return children;
  }
  if (ts.isNewExpression(expression)) {
    const children = [...expressionNodes(context, expression.expression), ...(expression.arguments?.flatMap((argument) => expressionNodes(context, argument)) ?? [])];
    const call: CallNode = {
      id: context.nextNodeId(),
      kind: "call",
      source: sourceSpan(context.sourceFile, context.fileId, expression),
      calleeExpression: `new ${expression.expression.getText(context.sourceFile)}`,
      args: expression.arguments?.map((argument) => ({ expression: argument.getText(context.sourceFile) })) ?? [],
      awaited: false,
      ...resolveCall(context, expression),
    };
    context.supported += 1;
    recordBoundaryDiagnostic(context, call);
    children.push(call);
    return children;
  }
  if (ts.isBinaryExpression(expression)) {
    if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) {
      const before = expressionNodes(context, expression.left);
      const then = sequence(context, expression.right, expressionNodes(context, expression.right));
      const when = expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "truthy"
        : expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ? "falsy"
        : "nullish";
      context.supported += 1;
      return [...before, { id: context.nextNodeId(), kind: "branch", source: sourceSpan(context.sourceFile, context.fileId, expression), condition: expression.left.getText(context.sourceFile), when, then }];
    }
    return [...expressionNodes(context, expression.left), ...expressionNodes(context, expression.right)];
  }
  if (ts.isConditionalExpression(expression)) {
    const before = expressionNodes(context, expression.condition);
    const then = sequence(context, expression.whenTrue, expressionNodes(context, expression.whenTrue));
    const otherwise = sequence(context, expression.whenFalse, expressionNodes(context, expression.whenFalse));
    context.supported += 1;
    return [...before, { id: context.nextNodeId(), kind: "branch", source: sourceSpan(context.sourceFile, context.fileId, expression), condition: expression.condition.getText(context.sourceFile), when: "truthy", then, else: otherwise }];
  }
  if (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) return expressionNodes(context, expression.operand);
  if (ts.isTypeOfExpression(expression) || ts.isVoidExpression(expression) || ts.isDeleteExpression(expression)) return expressionNodes(context, expression.expression);
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const optional = optionalChainBase(expression);
    if (optional.base) {
      const before = expressionNodes(context, optional.base);
      if (optional.boundaries > 1) return [...before, unsupported(context, expression, "Multiple optional chain boundaries are preserved as an opaque expression.")];
      const then = sequence(context, expression, afterBase(expression, optional.base));
      context.supported += 1;
      return [...before, { id: context.nextNodeId(), kind: "branch", source: sourceSpan(context.sourceFile, context.fileId, expression), condition: optional.base.getText(context.sourceFile), when: "non-nullish", then }];
    }
    if (ts.isPropertyAccessExpression(expression)) return expressionNodes(context, expression.expression);
    return [...expressionNodes(context, expression.expression), ...expressionNodes(context, expression.argumentExpression)];
  }
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.flatMap((element) => ts.isExpression(element) ? expressionNodes(context, element) : []);
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.flatMap((property) => {
    const name = property.name && ts.isComputedPropertyName(property.name) ? expressionNodes(context, property.name.expression) : [];
    if (ts.isPropertyAssignment(property)) return [...name, ...expressionNodes(context, property.initializer)];
    if (ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer) return [...name, ...expressionNodes(context, property.objectAssignmentInitializer)];
    if (ts.isSpreadAssignment(property)) return expressionNodes(context, property.expression);
    return name;
  });
  if (ts.isTemplateExpression(expression)) return expression.templateSpans.flatMap((part) => expressionNodes(context, part.expression));
  if (ts.isTaggedTemplateExpression(expression)) {
    const nested = ts.isTemplateExpression(expression.template) ? expression.template.templateSpans.flatMap((part) => expressionNodes(context, part.expression)) : [];
    return [...expressionNodes(context, expression.tag), ...nested, unsupported(context, expression, "Tagged template invocation is not resolved as a call.")];
  }
  if (ts.isYieldExpression(expression)) return [unsupported(context, expression, "Generator yield execution is not supported.")];
  if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
    return [unsupported(context, expression, "JSX is preserved as an opaque expression.")];
  }
  if (ts.isIdentifier(expression) || ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)
    || ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression) || ts.isBigIntLiteral(expression)
    || ts.isRegularExpressionLiteral(expression) || ts.isMetaProperty(expression)
    || [ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.SuperKeyword, ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(expression.kind)) return [];
  const nested: FlowNode[] = [];
  ts.forEachChild(expression, (child) => {
    if (ts.isExpression(child) && !ts.isFunctionExpression(child) && !ts.isArrowFunction(child)) nested.push(...expressionNodes(context, child));
  });
  return [...nested, unsupported(context, expression, `${ts.SyntaxKind[expression.kind]} expression is not supported.`)];
};

const analyzeStatements = (context: AnalyzeContext, owner: ts.Node, statements: readonly ts.Statement[]): { sequence: SequenceNode; terminates: boolean } => {
  const nodes: FlowNode[] = [];
  let terminates = false;
  for (const statement of statements) {
    const result = statementNodes(context, statement);
    nodes.push(...result.nodes);
    if (result.terminates) { terminates = true; break; }
  }
  return { sequence: sequence(context, owner, nodes), terminates };
};

const asBlock = (context: AnalyzeContext, statement: ts.Statement): { sequence: SequenceNode; terminates: boolean } =>
  ts.isBlock(statement) ? analyzeStatements(context, statement, statement.statements) : (() => {
    const result = statementNodes(context, statement);
    return { sequence: sequence(context, statement, result.nodes), terminates: result.terminates };
  })();

const loopParts = (context: AnalyzeContext, statement: ts.IterationStatement, label?: string): FlowNode => {
  const id = context.nextNodeId();
  let loopKind: "for" | "for-of" | "for-in" | "while" | "do";
  let initializer: ts.Node | undefined;
  let condition: ts.Expression | undefined;
  let incrementor: ts.Expression | undefined;
  if (ts.isForStatement(statement)) {
    loopKind = "for"; initializer = statement.initializer; condition = statement.condition; incrementor = statement.incrementor;
  } else if (ts.isForOfStatement(statement)) {
    loopKind = "for-of"; initializer = statement.initializer; condition = statement.expression;
  } else if (ts.isForInStatement(statement)) {
    loopKind = "for-in"; initializer = statement.initializer; condition = statement.expression;
  } else if (ts.isWhileStatement(statement)) {
    loopKind = "while"; condition = statement.expression;
  } else {
    loopKind = "do"; condition = (statement as ts.DoStatement).expression;
  }
  const initializerNodes = initializer && ts.isExpression(initializer) ? expressionNodes(context, initializer)
    : initializer && ts.isVariableDeclarationList(initializer) ? initializer.declarations.flatMap((declaration) => declaration.initializer ? expressionNodes(context, declaration.initializer) : [])
    : [];
  const conditionNodes = condition ? expressionNodes(context, condition) : [];
  const incrementorNodes = incrementor ? expressionNodes(context, incrementor) : [];
  context.jumpTargets.push({ id, label });
  const body = asBlock(context, statement.statement).sequence;
  context.jumpTargets.pop();
  context.supported += 1;
  return {
    id,
    kind: "loop",
    source: sourceSpan(context.sourceFile, context.fileId, statement),
    loopKind,
    initializer: initializer?.getText(context.sourceFile),
    condition: condition?.getText(context.sourceFile),
    incrementor: incrementor?.getText(context.sourceFile),
    initializerFlow: initializerNodes.length ? sequence(context, initializer!, initializerNodes) : undefined,
    conditionFlow: conditionNodes.length ? sequence(context, condition!, conditionNodes) : undefined,
    incrementorFlow: incrementorNodes.length ? sequence(context, incrementor!, incrementorNodes) : undefined,
    body,
  };
};

const statementNodes = (context: AnalyzeContext, statement: ts.Statement, label?: string): { nodes: FlowNode[]; terminates: boolean } => {
  const finish = (nodes: FlowNode[], terminates: boolean) => ({ nodes: applyCallAnnotation(context, statement, nodes), terminates });
  if (ts.isVariableStatement(statement)) {
    const calls = statement.declarationList.declarations.flatMap((declaration) => declaration.initializer ? expressionNodes(context, declaration.initializer) : []);
    context.supported += 1;
    return finish([...calls, { id: context.nextNodeId(), kind: "statement", source: sourceSpan(context.sourceFile, context.fileId, statement), code: statement.getText(context.sourceFile) }], false);
  }
  if (ts.isExpressionStatement(statement)) {
    const calls = expressionNodes(context, statement.expression);
    const onlyCall = ts.isCallExpression(statement.expression) || (ts.isAwaitExpression(statement.expression) && ts.isCallExpression(statement.expression.expression));
    if (onlyCall) return finish(calls, false);
    context.supported += 1;
    return finish([...calls, { id: context.nextNodeId(), kind: "statement", source: sourceSpan(context.sourceFile, context.fileId, statement), code: statement.getText(context.sourceFile) }], false);
  }
  if (ts.isReturnStatement(statement)) {
    const calls = statement.expression ? expressionNodes(context, statement.expression) : [];
    context.supported += 1;
    return finish([...calls, { id: context.nextNodeId(), kind: "return", source: sourceSpan(context.sourceFile, context.fileId, statement), expression: statement.expression?.getText(context.sourceFile) }], true);
  }
  if (ts.isThrowStatement(statement)) {
    const calls = expressionNodes(context, statement.expression);
    context.supported += 1;
    return finish([...calls, { id: context.nextNodeId(), kind: "throw", source: sourceSpan(context.sourceFile, context.fileId, statement), expression: statement.expression.getText(context.sourceFile) }], true);
  }
  if (ts.isIfStatement(statement)) {
    const before = expressionNodes(context, statement.expression);
    const then = asBlock(context, statement.thenStatement);
    const otherwise = statement.elseStatement ? asBlock(context, statement.elseStatement) : undefined;
    context.supported += 1;
    return finish([...before, { id: context.nextNodeId(), kind: "branch", source: sourceSpan(context.sourceFile, context.fileId, statement), condition: statement.expression.getText(context.sourceFile), when: "truthy", then: then.sequence, else: otherwise?.sequence }], then.terminates && Boolean(otherwise?.terminates));
  }
  if (ts.isIterationStatement(statement, false)) return finish([loopParts(context, statement, label)], false);
  if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) {
    const targetLabel = statement.label?.text;
    const target = targetLabel ? context.jumpTargets.findLast((entry) => entry.label === targetLabel) : context.jumpTargets.at(-1);
    context.supported += 1;
    return finish([{ id: context.nextNodeId(), kind: ts.isBreakStatement(statement) ? "break" : "continue", source: sourceSpan(context.sourceFile, context.fileId, statement), targetId: target?.id, targetLabel }], true);
  }
  if (ts.isLabeledStatement(statement)) {
    if (ts.isIterationStatement(statement.statement, false)) {
      const result = statementNodes(context, statement.statement, statement.label.text);
      return finish(result.nodes, result.terminates);
    }
    return finish([unsupported(context, statement, "Only labels attached to loops are supported.")], false);
  }
  if (ts.isTryStatement(statement)) {
    const body = analyzeStatements(context, statement.tryBlock, statement.tryBlock.statements);
    const catchResult = statement.catchClause ? analyzeStatements(context, statement.catchClause.block, statement.catchClause.block.statements) : undefined;
    const finallyResult = statement.finallyBlock ? analyzeStatements(context, statement.finallyBlock, statement.finallyBlock.statements) : undefined;
    context.supported += 1;
    const finallyOverrides = Boolean(finallyResult?.terminates);
    return finish([{
        id: context.nextNodeId(), kind: "try", source: sourceSpan(context.sourceFile, context.fileId, statement), body: body.sequence,
        catch: catchResult ? { variable: statement.catchClause?.variableDeclaration?.name.getText(context.sourceFile), body: catchResult.sequence } : undefined,
        finally: finallyResult?.sequence,
        finallyOverrides: finallyOverrides || undefined,
      }], finallyOverrides || (body.terminates && (!catchResult || catchResult.terminates)));
  }
  if (ts.isBlock(statement)) return finish([analyzeStatements(context, statement, statement.statements).sequence], false);
  if (ts.isEmptyStatement(statement)) return finish([], false);
  return finish([unsupported(context, statement, `${ts.SyntaxKind[statement.kind]} is handled in a later milestone.`)], false);
};

const analyzeBody = (context: AnalyzeContext, body: ts.ConciseBody): SequenceNode => {
  if (!ts.isBlock(body)) {
    const nodes = [...expressionNodes(context, body), { id: context.nextNodeId(), kind: "return" as const, source: sourceSpan(context.sourceFile, context.fileId, body), expression: body.getText(context.sourceFile) }];
    context.supported += 1;
    return sequence(context, body, nodes);
  }
  return analyzeStatements(context, body, body.statements).sequence;
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
  const ignoreMatcher = createIgnore().add(readIgnorePatterns(projectRoot));
  const excluded = excludedPaths.map((entry) => path.resolve(entry));
  let skipped = 0;
  const sourceFiles = program.getSourceFiles().filter((sourceFile) => {
    if (sourceFile.isDeclarationFile) return false;
    let real: string;
    try { real = realpathSync(sourceFile.fileName); } catch { skipped += 1; return false; }
    const relative = posix(path.relative(projectRoot, real));
    const include = isWithin(projectRoot, real) && !relative.startsWith("node_modules/") && !ignoreMatcher.ignores(relative) && !excluded.includes(real);
    if (!include) skipped += 1;
    return include;
  });
  const files = sourceFiles.map((sourceFile) => {
    const relativePath = posix(path.relative(projectRoot, realpathSync(sourceFile.fileName)));
    return { id: `file:${relativePath}`, path: relativePath, contentHash: createHash("sha256").update(sourceFile.text).digest("hex"), source: sourceFile.text };
  });
  const fileIds = new Map(files.map((file) => [file.path, file.id]));
  for (const diagnostic of [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]) {
    const base = {
      severity: diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" as const : "error" as const,
      code: `TS${diagnostic.code}`,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    };
    if (!diagnostic.file || diagnostic.start === undefined) {
      diagnostics.push(base);
      continue;
    }
    let relativePath: string;
    try { relativePath = posix(path.relative(projectRoot, realpathSync(diagnostic.file.fileName))); } catch { continue; }
    const fileId = fileIds.get(relativePath);
    if (!fileId) continue;
    const start = diagnostic.start;
    const end = start + (diagnostic.length ?? 0);
    const startPosition = diagnostic.file.getLineAndCharacterOfPosition(start);
    const endPosition = diagnostic.file.getLineAndCharacterOfPosition(end);
    diagnostics.push({
      ...base,
      source: { fileId, start, end, startLine: startPosition.line + 1, startColumn: startPosition.character + 1, endLine: endPosition.line + 1, endColumn: endPosition.character + 1 },
    });
  }
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
      jumpTargets: [],
      nextNodeId: () => `${entry.id}:node:${counter++}`,
    };
    const signature = checker.getSignatureFromDeclaration(entry.declaration);
    const body = analyzeBody(context, functionBody(entry.declaration)!);
    const metadata = functionMetadata(entry.sourceFile, entry.declaration);
    supported += context.supported;
    unsupportedCount += context.unsupported;
    return {
      id: entry.id,
      name: functionName(entry.declaration),
      signature: signature ? checker.signatureToString(signature) : entry.declaration.getText(entry.sourceFile).slice(0, 120),
      source: sourceSpan(entry.sourceFile, entry.fileId, entry.declaration),
      description: metadata.description,
      groupPath: metadata.groupPath,
      body,
    };
  });
  const roots = indexed.filter((entry) => functionMetadata(entry.sourceFile, entry.declaration).root);
  const entrypoints: FlowDocument["entrypoints"] = roots.map((entry) => {
    const metadata = functionMetadata(entry.sourceFile, entry.declaration);
    const name = functionName(entry.declaration);
    return {
      id: `entry:manual:${entry.id}`,
      kind: "manual",
      label: metadata.description ?? name,
      source: sourceSpan(entry.sourceFile, entry.fileId, entry.declaration),
      targets: [{ role: "handler", functionId: entry.id, expression: name, status: "complete" }],
      status: "complete",
      reasons: [],
    };
  });
  const unresolved = diagnostics.some((entry) => entry.code !== "PROJECT_REFERENCES_UNSUPPORTED" || parsed.projectReferences?.length);
  const result: FlowDocument = {
    formatVersion: FORMAT_VERSION,
    producerVersion: PRODUCER_VERSION,
    project: { name: path.basename(projectRoot), tsconfig: posix(path.relative(projectRoot, absoluteConfig)) || "tsconfig.json" },
    files,
    functions,
    entrypoints,
    roots: roots.map((entry) => entry.id),
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
