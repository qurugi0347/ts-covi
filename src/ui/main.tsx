import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { type CallNode, type EntryPoint, type FlowDocument, type FlowNode, type SequenceNode, type SourceSpan } from "../model/flow.js";
import { parseEmbeddedDocument } from "./embedded.js";
import "./styles.css";

const initialDocument = parseEmbeddedDocument(document.getElementById("ts-covi-data")?.textContent ?? undefined);
const FUNCTION_RESULT_LIMIT = 100;

const nestedNodes = (node: FlowNode): FlowNode[] => node.kind === "sequence" ? node.children
  : node.kind === "branch" ? [node.then, ...(node.else ? [node.else] : [])]
  : node.kind === "loop" ? [node.body, ...(node.initializerFlow ? [node.initializerFlow] : []), ...(node.conditionFlow ? [node.conditionFlow] : []), ...(node.incrementorFlow ? [node.incrementorFlow] : [])]
  : node.kind === "try" ? [node.body, ...(node.catch ? [node.catch.body] : []), ...(node.finally ? [node.finally] : [])]
  : [];

const findNode = (node: FlowNode, id: string): FlowNode | undefined => {
  if (node.id === id) return node;
  for (const child of nestedNodes(node)) {
    const found = findNode(child, id);
    if (found) return found;
  }
};

const nodeSummary = (node: FlowNode, document: FlowDocument): string => {
  if (node.kind === "call") return node.annotation?.label ?? (node.targetFunctionId ? document.functions.find((fn) => fn.id === node.targetFunctionId)?.description : undefined) ?? node.calleeExpression;
  if (node.kind === "statement") return node.code;
  if (node.kind === "branch") return `조건: ${node.condition}`;
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
  onSelect: (id: string) => void;
  label?: string;
};

function NodeList(props: NodeListProps) {
  return <div className="node-list" aria-label={props.label}>{props.sequence.children.length
    ? props.sequence.children.map((node) => <FlowBlock key={node.id} node={node} {...props} />)
    : <p className="empty-nested">표시할 단계가 없습니다.</p>}
  </div>;
}

type FlowBlockProps = Omit<NodeListProps, "sequence"> & { node: FlowNode };

function FlowBlock({ node, document, ancestors, expanded, selectedNodeId, onToggle, onSelect }: FlowBlockProps) {
  if (node.kind === "sequence") return <NodeList sequence={node} document={document} ancestors={ancestors} expanded={expanded} selectedNodeId={selectedNodeId} onToggle={onToggle} onSelect={onSelect} />;
  const target = node.kind === "call" && node.targetFunctionId ? document.functions.find((fn) => fn.id === node.targetFunctionId) : undefined;
  const recursive = Boolean(target && ancestors.includes(target.id));
  const isExpanded = node.kind === "call" && expanded.has(node.id);
  const regionId = `expanded-${node.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const childProps = { document, ancestors, expanded, selectedNodeId, onToggle, onSelect };
  const labels = node.kind === "branch" ? branchLabels(node.when) : undefined;

  return <article className={`flow-block block-${node.kind}${selectedNodeId === node.id ? " selected" : ""}`}>
    <header className="block-header">
      <button className="block-main" type="button" aria-pressed={selectedNodeId === node.id} onClick={() => onSelect(node.id)}>
        <span className="kind">{node.kind}</span><span className="block-title">{nodeSummary(node, document)}</span>
      </button>
      {node.kind === "call" && node.boundary && <span className="badge boundary">{node.boundary}</span>}
      {recursive && <span className="badge recursive">재귀 경계</span>}
      {target && !recursive && <button className="expand" type="button" aria-controls={regionId} aria-expanded={isExpanded} aria-label={`${nodeSummary(node, document)} ${isExpanded ? "접기" : "펼치기"}`} onClick={() => onToggle(node.id)}>{isExpanded ? "−" : "+"}</button>}
    </header>

    {node.kind === "call" && node.args.length > 0 && <ul className="arguments">{node.args.map((argument, index) => <li key={`${node.id}:arg:${index}`}><code>{argument.expression}</code>{argument.annotation && <span>{argument.annotation}</span>}</li>)}</ul>}
    {node.kind === "statement" && <code className="code-line">{node.code}</code>}
    {node.kind === "unsupported" && <code className="code-line">{node.code}</code>}

    {node.kind === "branch" && <div className="nested-grid"><section><h4>{labels![0]}</h4><NodeList sequence={node.then} {...childProps} label={labels![0]} /></section>{node.else && <section><h4>{labels![1]}</h4><NodeList sequence={node.else} {...childProps} label={labels![1]} /></section>}</div>}
    {node.kind === "loop" && <div className="nested-grid loop-parts">
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
    {node.kind === "try" && <div className="nested-grid"><section><h4>try</h4><NodeList sequence={node.body} {...childProps} /></section>{node.catch && <section><h4>catch {node.catch.variable}</h4><NodeList sequence={node.catch.body} {...childProps} /></section>}{node.finally && <section><h4>finally</h4><NodeList sequence={node.finally} {...childProps} /></section>}</div>}
    {target && isExpanded && !recursive && <section className="expanded-function" id={regionId}><h4>{target.name}</h4><NodeList sequence={target.body} {...childProps} ancestors={[...ancestors, target.id]} /></section>}
  </article>;
}

function Inspector({ document, node, source }: { document: FlowDocument; node?: FlowNode; source?: SourceSpan }) {
  const selectedSource = node?.source ?? source;
  if (!selectedSource) return <aside className="inspector"><h2>원문</h2><p>블록이나 원문 대상을 선택하면 코드와 위치를 표시합니다.</p></aside>;
  const file = document.files.find((entry) => entry.id === selectedSource.fileId);
  return <aside className="inspector"><h2>원문</h2><p className="source-location">{file?.path}:{selectedSource.startLine}:{selectedSource.startColumn}</p><pre><code>{file?.source.slice(selectedSource.start, selectedSource.end) ?? "원문을 찾을 수 없습니다."}</code></pre>{node?.kind === "call" && <dl><dt>호출식</dt><dd>{node.calleeExpression}</dd><dt>await</dt><dd>{node.awaited ? "예" : "아니요"}</dd>{node.annotation?.label && <><dt>설명</dt><dd>{node.annotation.label}</dd></>}</dl>}</aside>;
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
  const initialEntries = listedEntryPoints(initialDocument.flow);
  const [mode, setMode] = useState<"entrypoints" | "functions">(() => initialEntries.length ? "entrypoints" : "functions");
  const [selectedEntryPointId, setSelectedEntryPointId] = useState<string | undefined>(() => initialEntries[0]?.id);
  const [selectedTargetIndex, setSelectedTargetIndex] = useState(0);
  const [selectedFunctionId, setSelectedFunctionId] = useState<string | undefined>(() => initialEntries[0]?.targets[0]?.functionId ?? initialDocument.flow?.roots[0] ?? initialDocument.flow?.functions[0]?.id);
  const [selectedModuleId, setSelectedModuleId] = useState<string | undefined>(() => initialEntries[0]?.targets[0]?.moduleId);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const error = initialDocument.error ?? "";
  const entrypoints = listedEntryPoints(flow);
  const selectedEntryPoint = entrypoints.find((entry) => entry.id === selectedEntryPointId);
  const selectedFunction = flow?.functions.find((entry) => entry.id === selectedFunctionId);
  const selectedModule = flow?.modules?.find((entry) => entry.id === selectedModuleId);
  const selectedTarget = selectedEntryPoint?.targets[selectedTargetIndex];
  const selectedNode = flow && selectedNodeId ? [...flow.functions, ...(flow.modules ?? [])].map((entry) => findNode(entry.body, selectedNodeId)).find(Boolean) : undefined;
  const functions = flow?.functions.filter((entry) => `${entry.name} ${entry.signature} ${entry.description ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const visibleFunctions = functions.slice(0, FUNCTION_RESULT_LIMIT);
  if (selectedFunction && functions.includes(selectedFunction) && !visibleFunctions.includes(selectedFunction)) visibleFunctions[FUNCTION_RESULT_LIMIT - 1] = selectedFunction;
  const normalizedQuery = query.toLocaleLowerCase();
  const filteredEntries = entrypoints.filter((entry) => {
    const targets = entry.targets.map((target) => flow?.functions.find((fn) => fn.id === target.functionId)?.name ?? target.expression).join(" ");
    return `${entryGroup(entry, flow)} ${entry.label} ${entry.path ?? ""} ${entry.method ?? ""} ${entry.framework ?? ""} ${entry.command ?? ""} ${targets}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const groups = [...new Set(filteredEntries.map((entry) => entryGroup(entry, flow)))];
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectTarget = (entry: EntryPoint, index: number) => {
    const target = entry.targets[index];
    setSelectedEntryPointId(entry.id);
    setSelectedTargetIndex(index);
    setSelectedFunctionId(target?.functionId);
    setSelectedModuleId(target?.moduleId);
    setSelectedNodeId(undefined);
    setExpanded(new Set());
  };
  const showFunctions = () => {
    setMode("functions");
    setQuery("");
    setSelectedEntryPointId(undefined);
    setSelectedTargetIndex(0);
    setSelectedFunctionId(selectedTarget?.functionId ?? selectedFunctionId ?? flow?.functions[0]?.id);
    setSelectedModuleId(undefined);
    setSelectedNodeId(undefined);
    setExpanded(new Set());
  };
  const showEntryPoints = () => {
    setMode("entrypoints");
    setQuery("");
    const entry = entrypoints[0];
    if (entry) selectTarget(entry, 0);
    else {
      setSelectedEntryPointId(undefined);
      setSelectedTargetIndex(0);
      setSelectedFunctionId(undefined);
      setSelectedModuleId(undefined);
      setSelectedNodeId(undefined);
      setExpanded(new Set());
    }
  };

  return <main className="app">
    <header className="hero"><div><span className="eyebrow">STATIC FLOW VIEWER</span><h1>ts-covi</h1><p>같이 생성된 <code>flow.json</code> 분석 결과를 표시합니다.</p></div></header>
    {error && <p className="error" role="alert">{error}</p>}
    {flow?.coverage.status === "partial" && <section className="partial" role="status"><strong>부분 분석 결과</strong><span>미지원 또는 미해결 항목 {flow.diagnostics.length}개를 확인하세요.</span></section>}
    {flow && <div className="workspace">
      <aside className="functions" aria-label="탐색 목록"><div className="mode-switch" aria-label="탐색 단위"><button type="button" className={mode === "entrypoints" ? "active" : ""} aria-pressed={mode === "entrypoints"} onClick={showEntryPoints}>진입점</button><button type="button" className={mode === "functions" ? "active" : ""} aria-pressed={mode === "functions"} onClick={showFunctions}>전체 함수</button></div><label htmlFor="function-search">{mode === "entrypoints" ? "진입점 검색" : "함수 검색"}</label><input id="function-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        {mode === "entrypoints" ? entrypoints.length ? groups.map((group) => <section className="entry-group" key={group}><h2>{group}</h2><ul>{filteredEntries.filter((entry) => entryGroup(entry, flow) === group).map((entry) => <li key={entry.id}><button type="button" className={entry.id === selectedEntryPointId ? "active" : ""} aria-pressed={entry.id === selectedEntryPointId} onClick={() => selectTarget(entry, 0)}><span>{entry.method ? `${entry.method} ` : ""}{entry.path ?? entry.label}</span><small>{entry.status === "partial" ? "부분" : entry.framework ?? entry.kind}</small></button></li>)}</ul></section>) : <p className="empty-list">발견된 진입점이 없습니다. <code>@covi-root</code>로 지정할 수 있습니다.</p> : <ul>{visibleFunctions.map((fn) => <li key={fn.id}><button type="button" className={fn.id === selectedFunctionId && !selectedEntryPointId ? "active" : ""} aria-pressed={fn.id === selectedFunctionId && !selectedEntryPointId} onClick={() => { setSelectedEntryPointId(undefined); setSelectedFunctionId(fn.id); setSelectedModuleId(undefined); setSelectedNodeId(undefined); }}><span>{fn.name}</span>{flow.roots.includes(fn.id) && <small>root</small>}</button></li>)}</ul>}
        {mode === "entrypoints" && entrypoints.length > 0 && filteredEntries.length === 0 && <p className="empty-list">검색 결과가 없습니다.</p>}
        {mode === "functions" && functions.length === 0 && <p className="empty-list">검색 결과가 없습니다.</p>}
        {mode === "functions" && functions.length > FUNCTION_RESULT_LIMIT && <p className="empty-list">일치하는 함수 {functions.length}개 중 {FUNCTION_RESULT_LIMIT}개를 표시합니다. 검색어로 범위를 좁혀 주세요.</p>}
      </aside>
      <section className="canvas" aria-label="선택한 흐름">{selectedEntryPoint && <header className="entry-header"><span className="badge boundary">{entryGroup(selectedEntryPoint, flow)}</span><h2>{selectedEntryPoint.label}</h2>{selectedEntryPoint.command && <code>{selectedEntryPoint.command}</code>}{selectedEntryPoint.reasons.map((reason) => <p key={reason}>{reason}</p>)}{selectedEntryPoint.targets.length > 1 && <div className="target-list" aria-label="진입 대상">{selectedEntryPoint.targets.map((target, index) => <button key={`${target.role}:${index}`} type="button" className={index === selectedTargetIndex ? "active" : ""} aria-pressed={index === selectedTargetIndex} onClick={() => selectTarget(selectedEntryPoint, index)}>{target.role}: {target.expression}</button>)}</div>}</header>}{selectedFunction ? <><header><h2>{selectedFunction.description ?? selectedFunction.name}</h2><code>{selectedFunction.signature}</code></header><NodeList sequence={selectedFunction.body} document={flow} ancestors={[selectedFunction.id]} expanded={expanded} selectedNodeId={selectedNodeId} onToggle={toggle} onSelect={setSelectedNodeId} /></> : selectedModule ? <><header><h2>{selectedEntryPoint?.label ?? selectedModule.id}</h2><code>{selectedModule.id}</code></header><NodeList sequence={selectedModule.body} document={flow} ancestors={[]} expanded={expanded} selectedNodeId={selectedNodeId} onToggle={toggle} onSelect={setSelectedNodeId} /></> : selectedTarget ? <p>{selectedTarget.reason ?? "연결된 함수 본문 없이 원문만 확인할 수 있습니다."}</p> : <p>{mode === "entrypoints" ? "진입점을 선택하세요." : "함수를 선택하세요."}</p>}</section>
      <Inspector document={flow} node={selectedNode} source={!selectedNode ? selectedTarget?.source ?? selectedEntryPoint?.source : undefined} />
    </div>}
    {flow && <details className="diagnostics"><summary>진단 {flow.diagnostics.length}개</summary>{flow.diagnostics.length ? <ul>{flow.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}><strong>{item.code}</strong> {item.message}</li>)}</ul> : <p>진단이 없습니다.</p>}</details>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
