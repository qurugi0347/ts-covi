import React, { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type CallNode, type EntryPoint, type FlowDocument, type FlowFunction, type FlowNode, type SequenceNode, type SourceSpan } from "../model/flow.js";
import { parseEmbeddedDocument } from "./embedded.js";
import { branchArms, compactExit, emptyExpressionBranch, flowSummary, nestedNodes, presentSequence, type PresentedNode } from "./presentation.js";
import { defaultNavigation, readNavigation, navigationUrl, type NavigationState } from "./navigation.js";
import { ClassOverview, ClassInspector } from "./class-overview.js";
import { FunctionExplorer } from "./function-explorer.js";
import "./styles.css";

const initialDocument = parseEmbeddedDocument(document.getElementById("ts-covi-data")?.textContent ?? undefined);

const shortExpression = (expression: string, limit = 100): string => expression.length > limit ? `${expression.slice(0, limit)}…` : expression;

const findNode = (node: FlowNode, id: string): FlowNode | undefined => {
  if (node.id === id) return node;
  for (const child of nestedNodes(node)) {
    const found = findNode(child, id);
    if (found) return found;
  }
};

const findCallStatement = (node: FlowNode, callId: string): FlowNode | undefined => {
  if ((node.kind === "statement" || node.kind === "return" || node.kind === "throw") && node.primaryCallId === callId) return node;
  for (const child of nestedNodes(node)) {
    const found = findCallStatement(child, callId);
    if (found) return found;
  }
};

const nodeSummary = (node: FlowNode, document: FlowDocument): string => {
  if (node.kind === "call") return node.annotation?.label ?? (node.targetFunctionId ? document.functions.find((fn) => fn.id === node.targetFunctionId)?.description : undefined) ?? node.displayExpression ?? node.calleeExpression;
  if (node.kind === "statement") return node.code;
  if (node.kind === "branch") return node.condition;
  if (node.kind === "loop") return `${node.loopKind}: ${node.condition ?? "반복"}`;
  if (node.kind === "return" || node.kind === "throw") return node.expression ? `${node.kind} ${node.expression}` : node.kind;
  if (node.kind === "unsupported") return `${node.syntax}: ${node.reason}`;
  if (node.kind === "break" || node.kind === "continue") return node.targetLabel ? `${node.kind} ${node.targetLabel}` : node.kind;
  if (node.kind === "try") return node.finallyOverrides ? "try (finally가 종료를 덮어씀)" : "try";
  return node.kind;
};

const branchLabels = (when: import("../model/flow.js").BranchNode["when"]): [string, string] => {
  if (when === "falsy") return ["falsy일 때", "그 외"];
  if (when === "nullish") return ["nullish일 때", "그 외"];
  if (when === "non-nullish") return ["값이 있을 때", "값이 없을 때"];
  return ["truthy일 때", "그 외"];
};

type NodeListProps = {
  sequence: SequenceNode;
  document: FlowDocument;
  ancestors: string[];
  expanded: Set<string>;
  selectedNodeId?: string;
  onToggle: (id: string) => void;
  onSelect: (id: string, ancestors: string[], callKey?: string) => void;
  label?: string;
  path?: string;
};

function NodeList(props: NodeListProps) {
  return <div className="node-list" aria-label={props.label}>{props.sequence.children.length
    ? presentSequence(props.sequence).map(({ node, statement }) => <FlowBlock key={node.id} node={node} statement={statement} {...props} />)
    : <p className="empty-nested">표시할 단계가 없습니다.</p>}
  </div>;
}

type FlowBlockProps = Omit<NodeListProps, "sequence"> & PresentedNode;

function FlowBlock({ node, statement, document, ancestors, expanded, selectedNodeId, onToggle, onSelect, path = "root" }: FlowBlockProps) {
  if (node.kind === "sequence") return <NodeList sequence={node} document={document} ancestors={ancestors} expanded={expanded} selectedNodeId={selectedNodeId} onToggle={onToggle} onSelect={onSelect} path={path} />;
  if (emptyExpressionBranch(node) && node.kind === "branch" && !node.conditionFlow?.children.length) return null;
  const target = node.kind === "call" && node.targetFunctionId ? document.functions.find((fn) => fn.id === node.targetFunctionId) : undefined;
  const recursive = Boolean(target && ancestors.includes(target.id));
  const callKey = `${path}:${node.id}`;
  const isExpanded = node.kind === "call" && expanded.has(callKey);
  const regionId = `expanded-${callKey}`;
  const childProps = { document, ancestors, expanded, selectedNodeId, onToggle, onSelect, path };
  const expressionOnly = emptyExpressionBranch(node);
  const baseTitle = statement && node.kind === "call" && !node.annotation?.label ? nodeSummary(statement, document) : nodeSummary(node, document);
  const structural = node.kind === "branch" || node.kind === "loop" || node.kind === "try";
  const bodyKey = `body:${callKey}`;
  const bodyOpen = expanded.has(bodyKey);
  const compact = node.kind === "branch" && node.origin === "statement" && !expressionOnly && compactExit(node.then) && (!node.else || compactExit(node.else));
  const title = baseTitle;
  const bodyVisible = bodyOpen;
  const bodyRegion = `body-${callKey}`;

  return <article className={`flow-block block-${node.kind}${selectedNodeId === node.id || (statement && selectedNodeId === statement.id) ? " selected" : ""}`}>
    <header className="block-header">
      <button className="block-main" type="button" aria-pressed={selectedNodeId === node.id} onClick={() => onSelect(node.id, ancestors, target && !recursive ? callKey : undefined)}>
        <span className="kind">{statement && statement.kind !== "statement" ? statement.kind : node.kind}</span><span className="block-title">{node.kind === "branch" ? title : shortExpression(title)}</span>
      </button>
      {node.kind === "call" && node.args.length > 0 && <span className="badge">인자 {node.args.length}</span>}
      {node.kind === "call" && node.boundary && <span className="badge boundary">{node.boundary}</span>}
      {structural && !expressionOnly && <button className="detail-button" type="button" aria-controls={bodyRegion} aria-expanded={bodyOpen} onClick={() => onToggle(bodyKey)}>{bodyOpen ? "본문 접기" : compact ? "상세 펼치기" : "본문 펼치기"}</button>}
      {recursive && <span className="badge recursive">재귀 경계</span>}
      {target && !recursive && <button className="expand" type="button" aria-controls={regionId} aria-expanded={isExpanded} aria-label={`${nodeSummary(node, document)} ${isExpanded ? "접기" : "펼치기"}`} onClick={() => onToggle(callKey)}>{isExpanded ? "−" : "+"}</button>}
    </header>

    {node.kind === "call" && <code className="step-source">{document.files.find((file) => file.id === (statement ?? node).source.fileId)?.source.slice((statement ?? node).source.start, (statement ?? node).source.end) ?? node.calleeExpression}</code>}
    {node.kind === "unsupported" && <code className="code-line">{node.code}</code>}

    {structural && !expressionOnly && <p className="flow-summary">{flowSummary(node, ancestors)}</p>}
    {node.kind === "branch" && !expressionOnly && bodyVisible && <div className={`nested-grid${compact ? " compact-guard" : ""}`} id={bodyRegion}>{branchArms(node).map(({ node: arm, otherwise }, index) => <React.Fragment key={arm.id}><section><h4>{index === 0 ? branchLabels(arm.when)[0] : <button className="condition-button" type="button" onClick={() => onSelect(arm.id, ancestors)}>다른 조건: {arm.condition}</button>}</h4><NodeList sequence={arm.then} {...childProps} label={branchLabels(arm.when)[0]} /></section>{otherwise && <section><h4>{branchLabels(arm.when)[1]}</h4><NodeList sequence={otherwise} {...childProps} label={branchLabels(arm.when)[1]} /></section>}</React.Fragment>)}</div>}
    {node.kind === "loop" && bodyVisible && <div className="nested-grid loop-parts" id={bodyRegion}>
      {node.loopKind === "do" ? <>
        <section><h4>본문</h4><NodeList sequence={node.body} {...childProps} /></section>
        {node.condition && <section><h4>조건</h4><code>{node.condition}</code>{node.conditionFlow && <NodeList sequence={node.conditionFlow} {...childProps} />}</section>}
      </> : <>
        {node.initializer && <section><h4>초기화</h4><code>{node.initializer}</code>{node.initializerFlow && <NodeList sequence={node.initializerFlow} {...childProps} />}</section>}
        {node.condition && <section><h4>조건</h4><code>{node.condition}</code>{node.conditionFlow && <NodeList sequence={node.conditionFlow} {...childProps} />}</section>}
        <section><h4>본문</h4><NodeList sequence={node.body} {...childProps} /></section>
        {node.incrementor && <section><h4>갱신</h4><code>{node.incrementor}</code>{node.incrementorFlow && <NodeList sequence={node.incrementorFlow} {...childProps} />}</section>}
      </>}
    </div>}
    {node.kind === "try" && bodyVisible && <div className="nested-grid" id={bodyRegion}><section><h4>try</h4><NodeList sequence={node.body} {...childProps} /></section>{node.catch && <section><h4>catch {node.catch.variable}</h4><NodeList sequence={node.catch.body} {...childProps} /></section>}{node.finally && <section><h4>finally</h4><NodeList sequence={node.finally} {...childProps} /></section>}</div>}
    {target && isExpanded && !recursive && <section className="expanded-function" id={regionId}><h4>{target.name}</h4><NodeList sequence={target.body} {...childProps} ancestors={[...ancestors, target.id]} path={`${path}/${node.id}`} /></section>}
  </article>;
}

function Inspector({ document, node, source, fn, ancestors, onOpen }: { document: FlowDocument; node?: FlowNode; source?: SourceSpan; fn?: FlowFunction; ancestors: string[]; onOpen: (call: CallNode, ancestors: string[]) => void }) {
  const target = node?.kind === "call" ? document.functions.find((entry) => entry.id === node.targetFunctionId) : undefined;
  const sourceCode = (span: SourceSpan) => document.files.find((entry) => entry.id === span.fileId)?.source.slice(span.start, span.end) ?? "원문을 찾을 수 없습니다.";
  if (!node && fn) return <aside className="inspector"><h2>함수 상세</h2><h3>{fn.name}</h3>{fn.description && <p>{fn.description}</p>}<h4>함수 시그니처</h4><pre><code>{fn.signature}</code></pre><details><summary>함수 원문</summary><pre><code>{sourceCode(fn.source)}</code></pre></details>{source && <details><summary>진입점 원문</summary><pre><code>{sourceCode(source)}</code></pre></details>}</aside>;
  const statement = node?.kind === "call" ? [...document.functions, ...(document.modules ?? [])].map((entry) => findCallStatement(entry.body, node.id)).find(Boolean) : undefined;
  const selectedSource = statement?.source ?? node?.source ?? source;
  if (!selectedSource) return <aside className="inspector"><h2>원문</h2><p>블록이나 원문 대상을 선택하면 코드와 위치를 표시합니다.</p></aside>;
  const file = document.files.find((entry) => entry.id === selectedSource.fileId);
  return <aside className="inspector"><h2>함수 상세</h2>
    <pre><code>{sourceCode(selectedSource)}</code></pre>
    <p className="source-location">{file?.path}:{selectedSource.startLine}:{selectedSource.startColumn}</p>
    {node?.kind === "call" && <>
      {(node.annotation?.label ?? target?.description) && <p>{node.annotation?.label ?? target?.description}</p>}
      <h3>함수 시그니처</h3>
      <pre><code>{node.signature ?? target?.signature ?? "시그니처 정보 없음 — 다시 분석해 주세요."}</code></pre>
      {target && !ancestors.includes(target.id) && <button className="detail-button open-function" type="button" onClick={() => onOpen(node, ancestors)}>함수 자세히 보기</button>}
      {node.args.length > 0 && <section className="arguments"><h3>인자</h3>{node.args.map((argument, index) => <section key={index}><h4>{argument.parameterName ?? "매개변수 이름 확인 불가"}</h4><pre><code>{argument.expression}</code></pre>{(argument.annotation ?? argument.description) && <p>{argument.annotation ?? argument.description}</p>}</section>)}</section>}
    </>}
  </aside>;
}

const listedEntryPoints = (flow?: FlowDocument): EntryPoint[] => flow?.entrypoints ?? flow?.roots.flatMap((id) => {
  const fn = flow.functions.find((entry) => entry.id === id);
  return fn ? [{ id: `legacy:${id}`, kind: "manual" as const, label: fn.description ?? fn.name, source: fn.source, targets: [{ role: "handler" as const, functionId: id, expression: fn.name, status: "complete" as const }], status: "complete" as const, reasons: [] }] : [];
}) ?? [];

const entryGroup = (entry: EntryPoint, flow?: FlowDocument): string => {
  if (entry.kind === "endpoint") return "API";
  if (entry.kind === "page") return "페이지";
  if (entry.kind === "script") return "스크립트";
  const fn = entry.targets.map((target) => flow?.functions.find((item) => item.id === target.functionId)).find(Boolean);
  return fn?.groupPath?.length ? `수동 / ${fn.groupPath.join(" / ")}` : "수동";
};

function App() {
  const flow = initialDocument.flow;
  const entrypoints = listedEntryPoints(flow);
  const supplement = (state: NavigationState): NavigationState => {
    const saved = history.state?.covi;
    try {
      if (saved?.v !== 1 || !saved.state || navigationUrl(new URL(location.href), saved.state).href !== navigationUrl(new URL(location.href), state).href) return state;
      state.trail = state.trail.map((frame, index) => {
        const prior = saved.state.trail?.[index];
        if (prior?.callNodeId !== frame.callNodeId || !Array.isArray(prior.expanded)) return frame;
        const validated = readNavigation(navigationUrl(new URL(location.href), { ...state, functionId: frame.functionId, moduleId: frame.moduleId, node: prior.nodeId, ancestors: frame.ancestors, open: prior.expanded, trail: state.trail.slice(0, index) }), flow, entrypoints).state;
        return { ...frame, nodeId: validated.node, expanded: validated.open, scrollY: Number.isFinite(prior.scrollY) && prior.scrollY >= 0 ? prior.scrollY : 0 };
      });
    } catch { /* A stale browser snapshot cannot override the URL. */ }
    return state;
  };
  const initial = useRef(flow ? readNavigation(new URL(location.href), flow, entrypoints) : { state: defaultNavigation(flow, entrypoints) });
  const [navigation, setNavigation] = useState<NavigationState>(() => supplement(initial.current.state));
  const [classSource, setClassSource] = useState<SourceSpan | undefined>();
  const [navigationWarning, setNavigationWarning] = useState(initial.current.warning ?? "");
  const current = useRef(navigation);
  const pendingScroll = useRef<number | undefined>(undefined);
  const { mode, entry: selectedEntryPointId, target: selectedTargetIndex, functionId: selectedFunctionId, moduleId: selectedModuleId, classId: selectedClassId, node: selectedNodeId, ancestors: selectedAncestors, q: query = "", trail: visits } = navigation;
  useLayoutEffect(() => { setClassSource(undefined); }, [selectedClassId]);
  const expanded = new Set(navigation.open);
  const writeHistory = (state: NavigationState, kind: "push" | "replace", scrollY = window.scrollY) => {
    try {
      const url = navigationUrl(new URL(location.href), state);
      const saved = { ...history.state, covi: { v: 1, state, scrollY } };
      if (kind === "push" && url.href !== location.href) history.pushState(saved, "", url);
      else history.replaceState(saved, "", url);
      setNavigationWarning("");
    } catch (error) {
      setNavigationWarning(`탐색 상태를 URL에 저장할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const navigate = (next: NavigationState, kind: "push" | "replace", scrollY?: number) => {
    if (kind === "push") writeHistory(current.current, "replace");
    current.current = next;
    if (scrollY !== undefined) pendingScroll.current = scrollY;
    writeHistory(next, kind, scrollY ?? window.scrollY);
    setNavigation(next);
  };
  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    writeHistory(current.current, "replace");
    if (initial.current.warning) setNavigationWarning(initial.current.warning);
    const restore = () => {
      if (!flow) return;
      const parsed = readNavigation(new URL(location.href), flow, entrypoints);
      const saved = history.state?.covi;
      supplement(parsed.state);
      current.current = parsed.state;
      pendingScroll.current = Number.isFinite(saved?.scrollY) && saved.scrollY >= 0 ? saved.scrollY : 0;
      setNavigation(parsed.state);
      writeHistory(parsed.state, "replace", pendingScroll.current);
      setNavigationWarning(parsed.warning ?? "");
    };
    window.addEventListener("popstate", restore);
    return () => { window.removeEventListener("popstate", restore); history.scrollRestoration = previous; };
  }, []);
  useLayoutEffect(() => {
    if (pendingScroll.current === undefined) return;
    window.scrollTo({ top: pendingScroll.current, behavior: "instant" });
    pendingScroll.current = undefined;
  }, [navigation]);
  const selectNode = (id: string, ancestors: string[], callKey?: string) => navigate({ ...navigation, node: id, ancestors, open: callKey ? [...new Set([...navigation.open, callKey])] : navigation.open }, "replace");
  const error = initialDocument.error ?? "";
  const selectedEntryPoint = entrypoints.find((entry) => entry.id === selectedEntryPointId);
  const selectedFunction = flow?.functions.find((entry) => entry.id === selectedFunctionId);
  const selectedClass = flow?.classes?.find((entry) => entry.id === selectedClassId);
  const ownerClass = flow?.classes?.find((entry) => entry.id === selectedFunction?.classId);
  const selectedModule = flow?.modules?.find((entry) => entry.id === selectedModuleId);
  const selectedTarget = selectedEntryPoint?.targets[selectedTargetIndex];
  const selectedNode = flow && selectedNodeId ? [...flow.functions, ...(flow.modules ?? [])].map((entry) => findNode(entry.body, selectedNodeId)).find(Boolean) : undefined;
  const normalizedQuery = query.toLocaleLowerCase();
  const filteredEntries = entrypoints.filter((entry) => {
    const targets = entry.targets.map((target) => flow?.functions.find((fn) => fn.id === target.functionId)?.name ?? target.expression).join(" ");
    return `${entryGroup(entry, flow)} ${entry.label} ${entry.path ?? ""} ${entry.method ?? ""} ${entry.framework ?? ""} ${entry.command ?? ""} ${targets}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const groups = [...new Set(filteredEntries.map((entry) => entryGroup(entry, flow)))];
  const focusAncestors = [...new Set([...visits.flatMap((visit) => visit.ancestors), ...(selectedFunctionId ? [selectedFunctionId] : [])])];
  const clearSelection = { classId: undefined, node: undefined, ancestors: [], open: [], trail: [] };
  const openFunction = (call: CallNode, ancestors: string[]) => {
    if (!call.targetFunctionId || ancestors.includes(call.targetFunctionId)) return;
    navigate({ ...navigation, ...clearSelection, functionId: call.targetFunctionId, moduleId: undefined, trail: [...visits, { functionId: selectedFunctionId, moduleId: selectedModuleId, nodeId: selectedNodeId, expanded: navigation.open, scrollY: window.scrollY, callNodeId: call.id, ancestors }] }, "push", 0);
  };
  const returnTo = (index: number) => {
    const frame = visits[index];
    if (!frame) return;
    navigate({ ...navigation, functionId: frame.functionId, moduleId: frame.moduleId, node: frame.nodeId, ancestors: frame.ancestors, open: frame.expanded, trail: visits.slice(0, index) }, "push", frame.scrollY);
  };
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    navigate({ ...navigation, open: [...next] }, "replace");
  };
  const selectTarget = (entry: EntryPoint, index: number) => {
    const target = entry.targets[index];
    navigate({ ...navigation, ...clearSelection, mode: "entrypoints", entry: entry.id, target: index, functionId: target?.functionId, moduleId: target?.moduleId }, "push", 0);
  };
  const selectFunction = (id: string) => navigate({ ...navigation, ...clearSelection, mode: "functions", entry: undefined, target: 0, functionId: id, moduleId: undefined }, "push", 0);
  const selectClass = (id: string) => {
    setClassSource(undefined);
    navigate({ ...navigation, ...clearSelection, mode: "functions", entry: undefined, target: 0, functionId: undefined, moduleId: undefined, classId: id }, "push", 0);
  };
  const showFunctions = () => {
    if (selectedClassId) { selectClass(selectedClassId); return; }
    const id = selectedTarget?.functionId ?? selectedFunctionId ?? flow?.functions[0]?.id;
    navigate({ ...navigation, ...clearSelection, mode: "functions", q: "", entry: undefined, target: 0, functionId: id, moduleId: undefined }, "push", 0);
  };
  const showEntryPoints = () => navigate(defaultNavigation(flow, entrypoints), "push", 0);

  return <main className="app">
    <header className="hero"><div><span className="eyebrow">STATIC FLOW VIEWER</span><h1>ts-covi</h1><p>같이 생성된 <code>flow.json</code> 분석 결과를 표시합니다.</p></div></header>
    {navigationWarning && <p className="error" role="status">{navigationWarning}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {flow?.coverage.status === "partial" && <section className="partial" role="status"><strong>부분 분석 결과</strong><span>미지원 또는 미해결 항목 {flow.diagnostics.length}개를 확인하세요.</span></section>}
    {flow && <div className="workspace">
      <aside className="functions" aria-label="탐색 목록"><div className="mode-switch" aria-label="탐색 단위"><button type="button" className={mode === "entrypoints" ? "active" : ""} aria-pressed={mode === "entrypoints"} onClick={showEntryPoints}>진입점</button><button type="button" className={mode === "functions" ? "active" : ""} aria-pressed={mode === "functions"} onClick={showFunctions}>파일 탐색</button></div><label htmlFor="function-search">{mode === "entrypoints" ? "진입점 검색" : "파일·클래스·함수 검색"}</label><input id="function-search" type="search" value={query} onChange={(event) => navigate({ ...navigation, q: event.target.value }, "replace")} />
        {mode === "entrypoints" ? entrypoints.length ? groups.map((group) => <section className="entry-group" key={group}><h2>{group}</h2><ul>{filteredEntries.filter((entry) => entryGroup(entry, flow) === group).map((entry) => <li key={entry.id}><button type="button" className={entry.id === selectedEntryPointId ? "active" : ""} aria-pressed={entry.id === selectedEntryPointId} onClick={() => selectTarget(entry, 0)}><span>{entry.method ? `${entry.method} ` : ""}{entry.path ?? entry.label}</span><small>{entry.status === "partial" ? "부분" : entry.framework ?? entry.kind}</small></button></li>)}</ul></section>) : <p className="empty-list">발견된 진입점이 없습니다. <code>@covi-root</code>로 지정할 수 있습니다.</p> : <FunctionExplorer flow={flow} query={query} selectedId={selectedFunctionId} selectedClassId={selectedClassId} onSelect={selectFunction} onClassSelect={selectClass} />}
        {mode === "entrypoints" && entrypoints.length > 0 && filteredEntries.length === 0 && <p className="empty-list">검색 결과가 없습니다.</p>}
      </aside>
      <section className="canvas" aria-label="선택한 흐름">{selectedEntryPoint && <header className="entry-header"><span className="badge boundary">{entryGroup(selectedEntryPoint, flow)}</span><h2>{selectedEntryPoint.label}</h2>{selectedEntryPoint.command && <code>{selectedEntryPoint.command}</code>}{selectedEntryPoint.reasons.map((reason) => <p key={reason}>{reason}</p>)}{selectedEntryPoint.targets.length > 1 && <div className="target-list" aria-label="진입 대상">{selectedEntryPoint.targets.map((target, index) => <button key={`${target.role}:${index}`} type="button" className={index === selectedTargetIndex ? "active" : ""} aria-pressed={index === selectedTargetIndex} onClick={() => selectTarget(selectedEntryPoint, index)}>{target.role}: {target.expression}</button>)}</div>}</header>}{visits.length > 0 && <nav className="breadcrumbs" aria-label="함수 이동 경로"><button type="button" onClick={() => returnTo(visits.length - 1)}>← 돌아가기</button>{visits.map((visit, index) => <React.Fragment key={`${visit.callNodeId}:${index}`}><button type="button" onClick={() => returnTo(index)} title={`호출 위치: ${visit.callNodeId}`}>{flow.functions.find((fn) => fn.id === visit.functionId)?.name ?? selectedEntryPoint?.label ?? "시작 흐름"}</button><span aria-hidden="true">›</span></React.Fragment>)}<span aria-current="page">{selectedFunction?.name}</span></nav>}{selectedClass ? <ClassOverview entry={selectedClass} document={flow} onFunction={selectFunction} onSource={setClassSource} /> : selectedFunction ? <>{ownerClass && <nav className="breadcrumbs" aria-label="소유 클래스 경로"><span>{flow.files.find((file) => file.id === ownerClass.source.fileId)?.path}</span><span aria-hidden="true">›</span><button type="button" onClick={() => selectClass(ownerClass.id)}>{ownerClass.name}</button><span aria-hidden="true">›</span><span aria-current="page">{selectedFunction.name}</span></nav>}<header><h2>{selectedFunction.description ?? selectedFunction.name}</h2><div className="signature"><h3>함수 시그니처</h3><code>{selectedFunction.signature}</code></div></header><NodeList sequence={selectedFunction.body} document={flow} ancestors={focusAncestors} path={selectedFunction.id} expanded={expanded} selectedNodeId={selectedNodeId} onToggle={toggle} onSelect={selectNode} /></> : selectedModule ? <><header><h2>{selectedEntryPoint?.label ?? selectedModule.id}</h2><code>{selectedModule.id}</code></header><NodeList sequence={selectedModule.body} document={flow} ancestors={[]} path={selectedModule.id} expanded={expanded} selectedNodeId={selectedNodeId} onToggle={toggle} onSelect={selectNode} /></> : selectedTarget ? <p>{selectedTarget.reason ?? "연결된 함수 본문 없이 원문만 확인할 수 있습니다."}</p> : <p>{mode === "entrypoints" ? "진입점을 선택하세요." : "함수를 선택하세요."}</p>}</section>
      {selectedClass ? <ClassInspector entry={selectedClass} document={flow} selectedSource={classSource} /> : <Inspector document={flow} ancestors={selectedAncestors} onOpen={openFunction} node={selectedNode} fn={selectedFunction} source={!selectedNode ? selectedTarget?.source ?? selectedEntryPoint?.source : undefined} />}
    </div>}
    {flow && <details className="diagnostics"><summary>진단 {flow.diagnostics.length}개</summary>{flow.diagnostics.length ? <ul>{flow.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}><strong>{item.code}</strong> {item.message}</li>)}</ul> : <p>진단이 없습니다.</p>}</details>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
