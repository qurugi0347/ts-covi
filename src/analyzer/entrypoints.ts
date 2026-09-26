import path from "node:path";
import { realpathSync } from "node:fs";
import ts from "typescript";
import type { EntryPoint, EntryPointTarget, FlowDocument, SourceSpan } from "../model/flow.js";

type ImportRef = { module: string; imported: string };
type Input = {
  sourceFiles: ts.SourceFile[];
  checker: ts.TypeChecker;
  functionIds: Map<ts.Node, string>;
  fileIds: Map<string, string>;
  projectRoot: string;
  span: (sourceFile: ts.SourceFile, fileId: string, node: ts.Node) => SourceSpan;
  vueSources: Map<string, SourceSpan>;
  diagnostics: FlowDocument["diagnostics"];
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "all"]);
const posix = (value: string): string => value.split(path.sep).join("/");
const propertyName = (node: ts.ObjectLiteralElementLike): string | undefined => node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : undefined;
const decorators = (node: ts.Node): readonly ts.Decorator[] => ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];

const importsFor = (sourceFile: ts.SourceFile): Map<string, ImportRef> => {
  const result = new Map<string, ImportRef>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.name) result.set(clause.name.text, { module, imported: "default" });
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) result.set(clause.namedBindings.name.text, { module, imported: "*" });
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) result.set(element.name.text, { module, imported: element.propertyName?.text ?? element.name.text });
    }
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      const argument = initializer && ts.isCallExpression(initializer) ? initializer.arguments[0] : undefined;
      if (!initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression) || initializer.expression.text !== "require" || !argument || !ts.isStringLiteral(argument)) continue;
      const module = argument.text;
      if (ts.isIdentifier(declaration.name)) result.set(declaration.name.text, { module, imported: "default" });
      if (ts.isObjectBindingPattern(declaration.name)) for (const element of declaration.name.elements) result.set(element.name.getText(sourceFile), { module, imported: element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile) });
    }
  }
  return result;
};

const importedCall = (expression: ts.LeftHandSideExpression, imports: Map<string, ImportRef>, modules: Set<string>, names: Set<string>): boolean => {
  if (ts.isIdentifier(expression)) {
    const ref = imports.get(expression.text);
    return Boolean(ref && modules.has(ref.module) && names.has(ref.imported));
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const ref = imports.get(expression.expression.text);
    return Boolean(ref && modules.has(ref.module) && (ref.imported === "*" || ref.imported === "default") && names.has(expression.name.text));
  }
  return false;
};

const resolveAlias = (expression: ts.Expression, checker: ts.TypeChecker, visited = new Set<ts.Symbol>()): ts.Expression => {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
  if (!ts.isIdentifier(current)) return current;
  let symbol = checker.getSymbolAtLocation(current);
  if (!symbol || visited.has(symbol)) return current;
  visited.add(symbol);
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer ? resolveAlias(declaration.initializer, checker, visited) : current;
};

const staticStrings = (expression: ts.Expression | undefined, checker: ts.TypeChecker): string[] | undefined => {
  if (!expression) return [""];
  const value = resolveAlias(expression, checker);
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) return [value.text];
  if (ts.isArrayLiteralExpression(value)) {
    const strings = value.elements.flatMap((entry) => ts.isExpression(entry) ? staticStrings(entry, checker) ?? [] : []);
    return strings.length === value.elements.length ? strings : undefined;
  }
};

const objectProperty = (object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  const property = object.properties.find((entry) => propertyName(entry) === name);
  if (!property) return undefined;
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
};

const functionId = (expression: ts.Expression, checker: ts.TypeChecker, ids: Map<ts.Node, string>): string | undefined => {
  const resolved = resolveAlias(expression, checker);
  let node: ts.Node | undefined = resolved;
  while (node) {
    const id = ids.get(node);
    if (id) return id;
    node = node.parent;
    if (node && (ts.isSourceFile(node) || ts.isBlock(node))) break;
  }
  if (!ts.isIdentifier(resolved)) return undefined;
  let symbol = ts.isShorthandPropertyAssignment(resolved.parent) ? checker.getShorthandAssignmentValueSymbol(resolved.parent) : checker.getSymbolAtLocation(resolved);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  for (const declaration of symbol?.declarations ?? []) {
    let current: ts.Node | undefined = declaration;
    while (current && !ts.isSourceFile(current)) {
      const id = ids.get(current);
      if (id) return id;
      current = current.parent;
    }
  }
};

const target = (role: EntryPointTarget["role"], expression: ts.Expression, input: Input, sourceFile: ts.SourceFile, fileId: string): EntryPointTarget => {
  const id = functionId(expression, input.checker, input.functionIds);
  return id
    ? { role, functionId: id, expression: expression.getText(sourceFile), status: "complete" }
    : { role, source: input.span(sourceFile, fileId, expression), expression: expression.getText(sourceFile), status: "partial", reason: "함수 정의를 정적으로 연결할 수 없습니다." };
};

const joinPath = (base: string, child: string): string => {
  const parts = [base, child].flatMap((entry) => entry.split("/")).filter(Boolean);
  return `/${parts.join("/")}`;
};

const finalize = (entry: Omit<EntryPoint, "status" | "reasons">, reasons: string[] = []): EntryPoint => {
  const targetReasons = entry.targets.flatMap((item) => item.reason ? [item.reason] : []);
  const allReasons = [...new Set([...reasons, ...targetReasons])];
  return { ...entry, status: allReasons.length ? "partial" : "complete", reasons: allReasons };
};

const detectNest = (sourceFile: ts.SourceFile, fileId: string, imports: Map<string, ImportRef>, input: Input): EntryPoint[] => {
  const entries: EntryPoint[] = [];
  const decoratorCall = (node: ts.Decorator, names: Set<string>): ts.CallExpression | undefined => {
    if (!ts.isCallExpression(node.expression)) return undefined;
    return importedCall(node.expression.expression, imports, new Set(["@nestjs/common"]), names) ? node.expression : undefined;
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const controller = decorators(statement).map((item) => decoratorCall(item, new Set(["Controller"]))).find(Boolean);
    if (!controller) continue;
    const controllerPaths = staticStrings(controller.arguments[0], input.checker);
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.body) continue;
      for (const decorator of decorators(member)) {
        const call = decoratorCall(decorator, new Set(["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"]));
        if (!call) continue;
        const imported = ts.isIdentifier(call.expression) ? imports.get(call.expression.text)!.imported : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "All";
        const methodPaths = staticStrings(call.arguments[0], input.checker);
        const paths = controllerPaths && methodPaths ? controllerPaths.flatMap((base) => methodPaths.map((child) => joinPath(base, child))) : [undefined];
        paths.forEach((routePath, index) => {
          const reasons = routePath === undefined ? ["동적 controller 또는 method 경로를 해석할 수 없습니다.", "전역 prefix와 version은 정적으로 확정하지 않습니다."] : ["전역 prefix와 version은 정적으로 확정하지 않습니다."];
          const handlerId = input.functionIds.get(member);
          const handler: EntryPointTarget = handlerId
            ? { role: "handler", functionId: handlerId, expression: member.name.getText(sourceFile), status: "complete" }
            : { role: "handler", source: input.span(sourceFile, fileId, member), expression: member.name.getText(sourceFile), status: "partial", reason: "handler를 연결할 수 없습니다." };
          entries.push(finalize({ id: `entry:nest:${fileId}:${decorator.getStart(sourceFile)}:${index}`, kind: "endpoint", framework: "nestjs", label: `${imported.toUpperCase()} ${routePath ?? "동적 경로"}`, path: routePath, method: imported.toUpperCase(), source: input.span(sourceFile, fileId, decorator), targets: [handler] }, reasons));
        });
      }
    }
  }
  return entries;
};

const detectExpress = (input: Input): EntryPoint[] => {
  type RouterKey = ts.VariableDeclaration;
  const routerKinds = new Map<RouterKey, "app" | "router">();
  const mounts: Array<{ parent: RouterKey; child: RouterKey; path?: string }> = [];
  const registrations: Array<{ call: ts.CallExpression; sourceFile: ts.SourceFile; fileId: string; router: RouterKey; method: string; route?: string; handlers: ts.Expression[] }> = [];
  const expressModules = new Set(["express"]);
  const routerKey = (identifier: ts.Identifier): RouterKey | undefined => {
    let symbol = input.checker.getSymbolAtLocation(identifier);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = input.checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration && ts.isVariableDeclaration(declaration) ? declaration : undefined;
  };
  for (const sourceFile of input.sourceFiles) {
    const imports = importsFor(sourceFile);
    const isFactory = (call: ts.CallExpression, kind: "app" | "router"): boolean => kind === "app"
      ? importedCall(call.expression, imports, expressModules, new Set(["default", "*"]))
      : importedCall(call.expression, imports, expressModules, new Set(["Router"]));
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
        if (isFactory(declaration.initializer, "app")) routerKinds.set(declaration, "app");
        if (isFactory(declaration.initializer, "router")) routerKinds.set(declaration, "router");
      }
    }
  }
  for (const sourceFile of input.sourceFiles) {
    const context = sourceContext(sourceFile, input);
    if (!context) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text.toLowerCase();
        let receiver: ts.Identifier | undefined;
        let routeExpression: ts.Expression | undefined;
        let handlers: ts.Expression[] = [];
        if (ts.isIdentifier(node.expression.expression)) {
          receiver = node.expression.expression;
          routeExpression = node.arguments[0];
          handlers = node.arguments.slice(1);
        } else if (ts.isCallExpression(node.expression.expression) && ts.isPropertyAccessExpression(node.expression.expression.expression) && node.expression.expression.expression.name.text === "route" && ts.isIdentifier(node.expression.expression.expression.expression)) {
          receiver = node.expression.expression.expression.expression;
          routeExpression = node.expression.expression.arguments[0];
          handlers = [...node.arguments];
        }
        const parent = receiver ? routerKey(receiver) : undefined;
        const directMount = method === "use" && routeExpression && ts.isIdentifier(routeExpression) ? routerKey(routeExpression) : undefined;
        const mountedExpression = directMount ? routeExpression : handlers[0];
        const child = mountedExpression && ts.isIdentifier(mountedExpression) ? routerKey(mountedExpression) : undefined;
        if (parent && routerKinds.has(parent) && method === "use" && child && routerKinds.has(child)) {
          mounts.push({ parent, child, path: directMount ? "" : staticStrings(routeExpression, input.checker)?.[0] });
        } else if (parent && routerKinds.has(parent) && HTTP_METHODS.has(method)) {
          registrations.push({ call: node, sourceFile, fileId: context.fileId, router: parent, method, route: staticStrings(routeExpression, input.checker)?.[0], handlers });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const prefixes = (router: RouterKey, seen = new Set<RouterKey>()): Array<string | undefined> => {
    if (seen.has(router)) return [undefined];
    const incoming = mounts.filter((mount) => mount.child === router);
    if (!incoming.length) return [routerKinds.get(router) === "app" ? "" : undefined];
    seen.add(router);
    return incoming.flatMap((mount) => prefixes(mount.parent, new Set(seen)).map((base) => base === undefined || mount.path === undefined ? undefined : joinPath(base, mount.path)));
  };
  return registrations.flatMap((registration) => prefixes(registration.router).map((prefix, index) => {
    const routePath = prefix === undefined || registration.route === undefined ? undefined : joinPath(prefix, registration.route);
    const targets = registration.handlers.map((handler, handlerIndex) => target(handlerIndex === registration.handlers.length - 1 ? "handler" : "middleware", handler, input, registration.sourceFile, registration.fileId));
    if (!targets.length) targets.push({ role: "handler", source: input.span(registration.sourceFile, registration.fileId, registration.call), expression: registration.call.getText(registration.sourceFile), status: "partial", reason: "등록된 handler가 없습니다." });
    return finalize({ id: `entry:express:${registration.fileId}:${registration.call.getStart(registration.sourceFile)}:${index}`, kind: "endpoint", framework: "express", label: `${registration.method.toUpperCase()} ${routePath ?? "동적 경로"}`, path: routePath, method: registration.method.toUpperCase(), source: input.span(registration.sourceFile, registration.fileId, registration.call), targets }, routePath === undefined ? ["동적 경로 또는 mount를 정적으로 연결할 수 없습니다."] : []);
  }));
};

type RouteOptions = { framework: "react-router" | "vue-router"; registrationKey: string; input: Input };

const sourceContext = (sourceFile: ts.SourceFile, input: Input): { fileId: string; imports: Map<string, ImportRef> } | undefined => {
  const relative = posix(path.relative(input.projectRoot, realpathSync(sourceFile.fileName)));
  const fileId = input.fileIds.get(relative);
  return fileId ? { fileId, imports: importsFor(sourceFile) } : undefined;
};

const routeEntries = (expression: ts.Expression, parentPath: string, options: RouteOptions, seen = new Set<ts.Expression>()): EntryPoint[] => {
  const resolved = resolveAlias(expression, options.input.checker);
  if (seen.has(resolved)) return [];
  seen.add(resolved);
  if (!ts.isArrayLiteralExpression(resolved)) return [];
  return resolved.elements.flatMap((element, routeIndex) => {
    if (!ts.isExpression(element)) return [];
    const route = resolveAlias(element, options.input.checker);
    if (!ts.isObjectLiteralExpression(route)) return [];
    const sourceFile = route.getSourceFile();
    const context = sourceContext(sourceFile, options.input);
    if (!context) return [];
    const { fileId, imports } = context;
    const rawPath = objectProperty(route, "path");
    const pathValue = rawPath ? staticStrings(rawPath, options.input.checker)?.[0] : undefined;
    const dynamicPath = Boolean(rawPath && pathValue === undefined);
    const indexValue = objectProperty(route, "index");
    const isIndex = indexValue?.kind === ts.SyntaxKind.TrueKeyword;
    const routePath = isIndex ? parentPath || "/" : pathValue === undefined ? parentPath || "/" : joinPath(parentPath, pathValue);
    const targets: EntryPointTarget[] = [];
    const component = objectProperty(route, "Component") ?? objectProperty(route, "component");
    if (component) {
      const importedVue = options.framework === "vue-router" && ts.isIdentifier(component) && imports.get(component.text)?.module.endsWith(".vue") ? imports.get(component.text)!.module : undefined;
      const lazyVue = options.framework === "vue-router" && ts.isArrowFunction(component) && ts.isCallExpression(component.body) && component.body.expression.kind === ts.SyntaxKind.ImportKeyword && component.body.arguments[0] && ts.isStringLiteral(component.body.arguments[0]) ? component.body.arguments[0].text : undefined;
      if (importedVue || lazyVue) {
        const candidate = path.resolve(path.dirname(sourceFile.fileName), importedVue ?? lazyVue!);
        let absolute = candidate;
        try { absolute = realpathSync(candidate); } catch { /* keep the unresolved candidate */ }
        const source = options.input.vueSources.get(absolute);
        targets.push(source
          ? { role: "component", source, expression: component.getText(sourceFile), status: "partial", reason: "Vue SFC 내부 함수 흐름은 분석하지 않습니다." }
          : { role: "component", source: options.input.span(sourceFile, fileId, component), expression: component.getText(sourceFile), status: "partial", reason: "Vue component 원문을 안전하게 연결할 수 없습니다." });
      } else targets.push(target("component", component, options.input, sourceFile, fileId));
    }
    const elementValue = objectProperty(route, "element");
    if (elementValue) {
      const tag = ts.isJsxElement(elementValue) ? elementValue.openingElement.tagName : ts.isJsxSelfClosingElement(elementValue) ? elementValue.tagName : undefined;
      targets.push(tag && ts.isIdentifier(tag) ? target("component", tag, options.input, sourceFile, fileId) : { role: "component", source: options.input.span(sourceFile, fileId, elementValue), expression: elementValue.getText(sourceFile), status: "partial", reason: "element component를 정적으로 연결할 수 없습니다." });
    }
    for (const role of ["loader", "action"] as const) {
      const value = objectProperty(route, role);
      if (value) targets.push(target(role, value, options.input, sourceFile, fileId));
    }
    if (!targets.length) targets.push({ role: "component", source: options.input.span(sourceFile, fileId, route), expression: route.getText(sourceFile), status: "partial", reason: "route target이 없거나 lazy target입니다." });
    const reasons = dynamicPath ? ["동적 route path를 해석할 수 없습니다."] : [];
    const entry = finalize({ id: `entry:${options.framework}:${options.registrationKey}:${fileId}:${route.getStart(sourceFile)}:${routeIndex}`, kind: "page", framework: options.framework, label: dynamicPath ? "동적 경로" : isIndex ? `${routePath} (index)` : rawPath ? routePath : `${routePath} (pathless)`, path: dynamicPath ? undefined : routePath, source: options.input.span(sourceFile, fileId, route), targets }, reasons);
    const children = objectProperty(route, "children");
    return [entry, ...(children ? routeEntries(children, routePath, options, new Set(seen)) : [])];
  });
};

const jsxRouteEntries = (sourceFile: ts.SourceFile, fileId: string, imports: Map<string, ImportRef>, input: Input): EntryPoint[] => {
  const entries: EntryPoint[] = [];
  const visit = (node: ts.Node, parentPath = ""): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName;
      const ref = ts.isIdentifier(tag) ? imports.get(tag.text) : undefined;
      if (ref?.imported === "Route" && (ref.module === "react-router" || ref.module === "react-router-dom")) {
        const attribute = (name: string) => opening.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(sourceFile) === name)?.initializer;
        const pathAttribute = attribute("path");
        const rawPath = pathAttribute && (ts.isStringLiteral(pathAttribute) ? pathAttribute : ts.isJsxExpression(pathAttribute) ? pathAttribute.expression : undefined);
        const child = rawPath ? staticStrings(rawPath, input.checker)?.[0] : undefined;
        const dynamicPath = Boolean(rawPath && child === undefined);
        const index = Boolean(attribute("index"));
        const routePath = index ? parentPath || "/" : child === undefined ? parentPath || "/" : joinPath(parentPath, child);
        const element = attribute("element");
        const expression = element && ts.isJsxExpression(element) ? element.expression : undefined;
        const component = expression && (ts.isJsxElement(expression) ? expression.openingElement.tagName : ts.isJsxSelfClosingElement(expression) ? expression.tagName : undefined);
        const targets = expression ? [target("component", component && ts.isIdentifier(component) ? component : expression, input, sourceFile, fileId)] : [{ role: "component" as const, source: input.span(sourceFile, fileId, opening), expression: opening.getText(sourceFile), status: "partial" as const, reason: "JSX Route element를 연결할 수 없습니다." }];
        entries.push(finalize({ id: `entry:react-jsx:${fileId}:${opening.getStart(sourceFile)}`, kind: "page", framework: "react-router", label: dynamicPath ? "동적 경로" : index ? `${routePath} (index)` : child === undefined ? `${routePath} (pathless)` : routePath, path: dynamicPath ? undefined : routePath, source: input.span(sourceFile, fileId, opening), targets }, dynamicPath ? ["동적 route path를 해석할 수 없습니다."] : []));
        if (ts.isJsxElement(node)) for (const childNode of node.children) visit(childNode, routePath);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, parentPath));
  };
  visit(sourceFile);
  return entries;
};

export const detectEntryPoints = (input: Input): EntryPoint[] => {
  const entries: EntryPoint[] = detectExpress(input);
  for (const sourceFile of input.sourceFiles) {
    const relative = posix(path.relative(input.projectRoot, realpathSync(sourceFile.fileName)));
    const fileId = input.fileIds.get(relative);
    if (!fileId) continue;
    const imports = importsFor(sourceFile);
    entries.push(...detectNest(sourceFile, fileId, imports, input));
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (importedCall(node.expression, imports, new Set(["react-router", "react-router-dom"]), new Set(["createBrowserRouter", "createHashRouter", "useRoutes"])) && node.arguments[0]) {
          entries.push(...routeEntries(node.arguments[0], "", { framework: "react-router", registrationKey: `${fileId}:${node.getStart(sourceFile)}`, input }));
        }
        if (importedCall(node.expression, imports, new Set(["vue-router"]), new Set(["createRouter"])) && node.arguments[0]) {
          const options = resolveAlias(node.arguments[0], input.checker);
          if (ts.isObjectLiteralExpression(options)) {
            const routes = objectProperty(options, "routes");
            if (routes) entries.push(...routeEntries(routes, "", { framework: "vue-router", registrationKey: `${fileId}:${node.getStart(sourceFile)}`, input }));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    entries.push(...jsxRouteEntries(sourceFile, fileId, imports, input));
  }
  for (const entry of entries) {
    if (entry.status === "partial") input.diagnostics.push({ severity: "warning", code: "ENTRYPOINT_UNRESOLVED", message: `${entry.framework}: ${entry.label} — ${entry.reasons.join(" ")}`, source: entry.source });
  }
  return entries;
};
