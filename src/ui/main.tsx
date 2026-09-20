import React, { useState, type DragEvent } from "react";
import { createRoot } from "react-dom/client";
import { validateFlowDocument, type CallNode, type FlowDocument, type FlowNode, type SequenceNode } from "../model/flow.js";
import { parseEmbeddedDocument } from "./embedded.js";
import "./styles.css";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const initialDocument = parseEmbeddedDocument(document.getElementById("ts-covi-data")?.textContent ?? undefined);

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

function Inspector({ document, node }: { document: FlowDocument; node?: FlowNode }) {
  if (!node) return <aside className="inspector"><h2>원문</h2><p>블록을 선택하면 코드와 위치를 표시합니다.</p></aside>;
  const file = document.files.find((entry) => entry.id === node.source.fileId);
  return <aside className="inspector"><h2>원문</h2><p className="source-location">{file?.path}:{node.source.startLine}:{node.source.startColumn}</p><pre><code>{file?.source.slice(node.source.start, node.source.end) ?? "원문을 찾을 수 없습니다."}</code></pre>{node.kind === "call" && <dl><dt>호출식</dt><dd>{node.calleeExpression}</dd><dt>await</dt><dd>{node.awaited ? "예" : "아니요"}</dd>{node.annotation?.label && <><dt>설명</dt><dd>{node.annotation.label}</dd></>}</dl>}</aside>;
}

function App() {
  const [flow, setFlow] = useState<FlowDocument | undefined>(initialDocument.flow);
  const [selectedFunctionId, setSelectedFunctionId] = useState<string | undefined>(() => initialDocument.flow?.roots[0] ?? initialDocument.flow?.functions[0]?.id);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState(initialDocument.error ?? "");

  const load = async (file: File) => {
    try {
      if (file.size > MAX_FILE_SIZE) throw new Error("20 MB 이하의 JSON을 선택하세요.");
      const next = validateFlowDocument(JSON.parse(await file.text()));
      setFlow(next);
      setSelectedFunctionId(next.roots[0] ?? next.functions[0]?.id);
      setSelectedNodeId(undefined);
      setExpanded(new Set());
      setError("");
    } catch (cause) {
      setFlow(undefined);
      setSelectedFunctionId(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const drop = (event: DragEvent<HTMLElement>) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void load(file); };
  const selectedFunction = flow?.functions.find((entry) => entry.id === selectedFunctionId);
  const selectedNode = flow && selectedNodeId ? flow.functions.map((entry) => findNode(entry.body, selectedNodeId)).find(Boolean) : undefined;
  const functions = flow?.functions.filter((entry) => `${entry.name} ${entry.signature} ${entry.description ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <main className="app" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
    <header className="hero"><div><span className="eyebrow">STATIC FLOW VIEWER</span><h1>ts-covi</h1><p>생성된 분석 결과를 표시합니다. 다른 JSON을 선택하거나 화면에 놓아 바꿀 수 있습니다.</p></div><label className="picker">JSON 선택<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void load(file); }} /></label></header>
    {error && <p className="error" role="alert">{error}</p>}
    {flow?.coverage.status === "partial" && <section className="partial" role="status"><strong>부분 분석 결과</strong><span>미지원 또는 미해결 항목 {flow.diagnostics.length}개를 확인하세요.</span></section>}
    {flow && <div className="workspace">
      <aside className="functions" aria-label="함수 목록"><label htmlFor="function-search">함수 검색</label><input id="function-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /><ul>{functions.map((fn) => <li key={fn.id}><button type="button" className={fn.id === selectedFunctionId ? "active" : ""} aria-pressed={fn.id === selectedFunctionId} onClick={() => { setSelectedFunctionId(fn.id); setSelectedNodeId(undefined); }}><span>{fn.name}</span>{flow.roots.includes(fn.id) && <small>root</small>}</button></li>)}</ul></aside>
      <section className="canvas" aria-label="함수 흐름">{selectedFunction ? <><header><h2>{selectedFunction.description ?? selectedFunction.name}</h2><code>{selectedFunction.signature}</code></header><NodeList sequence={selectedFunction.body} document={flow} ancestors={[selectedFunction.id]} expanded={expanded} selectedNodeId={selectedNodeId} onToggle={toggle} onSelect={setSelectedNodeId} /></> : <p>함수를 선택하세요.</p>}</section>
      <Inspector document={flow} node={selectedNode} />
    </div>}
    {flow && <details className="diagnostics"><summary>진단 {flow.diagnostics.length}개</summary>{flow.diagnostics.length ? <ul>{flow.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}><strong>{item.code}</strong> {item.message}</li>)}</ul> : <p>진단이 없습니다.</p>}</details>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
