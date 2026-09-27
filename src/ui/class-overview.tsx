import React from "react";
import type { FlowClass, FlowDocument, SourceSpan } from "../model/flow.js";

const modifierLabel = (member: { visibility: string; static?: boolean; readonly?: boolean }) => `${member.visibility}${member.static ? " · static" : ""}${member.readonly ? " · readonly" : ""}`;

type Props = { entry: FlowClass; document: FlowDocument; onFunction: (id: string) => void; onSource: (source: SourceSpan) => void };

export function ClassOverview({ entry, document, onFunction, onSource }: Props) {
  const file = document.files.find((item) => item.id === entry.source.fileId);
  const constructorFields = new Set(entry.constructor?.parameters.filter((parameter) => parameter.visibility).map((parameter) => parameter.source.start));
  const fields = entry.fields.filter((field) => !constructorFields.has(field.source.start));
  return <div className="class-overview"><header><span className="badge boundary">클래스 개요</span><h2>{entry.name}</h2>{entry.description && <p>{entry.description}</p>}<p className="source-location">{file?.path}:{entry.source.startLine}</p>{entry.extends && <p>extends <code>{entry.extends}</code></p>}{entry.implements.length > 0 && <p>implements <code>{entry.implements.join(", ")}</code></p>}</header>
    <section><h3>필드</h3>{fields.length ? <ul className="class-members">{fields.map((field) => <li key={field.source.start}><button type="button" onClick={() => onSource(field.source)}><strong>{field.name}{field.optional ? "?" : ""}</strong><small>{modifierLabel(field)}</small></button><code>{field.type}</code>{field.description && <p>{field.description}</p>}</li>)}</ul> : <p className="empty-list">별도로 선언된 필드가 없습니다.</p>}</section>
    <section><h3>생성자</h3>{entry.constructor ? <><pre><code>{entry.constructor.signature}</code></pre><p className="empty-list">선언 정보만 표시합니다.</p><ul className="class-members">{entry.constructor.parameters.map((parameter) => <li key={parameter.source.start}><button type="button" onClick={() => onSource(parameter.source)}><strong>{parameter.rest ? "..." : ""}{parameter.name}{parameter.optional ? "?" : ""}</strong>{parameter.visibility && <small>{modifierLabel({ ...parameter, visibility: parameter.visibility })} · 생성자에서 선언된 필드</small>}</button><code>{parameter.type}</code>{parameter.description && <p>{parameter.description}</p>}</li>)}</ul></> : <p className="empty-list">직접 선언된 생성자가 없습니다.</p>}</section>
    <section><h3>메서드</h3><p className="empty-list">직접 선언된 멤버 목록입니다. 실행 순서를 의미하지 않습니다.</p>{entry.methods.length ? <ul className="class-members">{entry.methods.map((method) => <li key={`${method.kind}:${method.source.start}`}><div className="class-method-heading"><strong>{method.name}</strong><small>{modifierLabel(method)}{method.kind === "get" || method.kind === "set" ? ` · ${method.kind}` : ""}</small></div>{method.description && <p>{method.description}</p>}<code>{method.signature}</code>{method.functionId ? <button type="button" onClick={() => onFunction(method.functionId!)}>함수 흐름 보기</button> : <button type="button" onClick={() => onSource(method.source)}>원문만 보기</button>}</li>)}</ul> : <p className="empty-list">선언된 메서드가 없습니다.</p>}</section>
  </div>;
}

export function ClassInspector({ entry, document, selectedSource }: { entry: FlowClass; document: FlowDocument; selectedSource?: SourceSpan }) {
  const span = selectedSource ?? entry.source;
  const file = document.files.find((item) => item.id === span.fileId);
  const code = file?.source.slice(span.start, span.end) ?? "원문을 찾을 수 없습니다.";
  return <aside className="inspector"><h2>클래스 상세</h2><h3>{entry.name}</h3><p className="source-location">{file?.path}:{span.startLine}:{span.startColumn}</p>{selectedSource ? <pre><code>{code}</code></pre> : <details><summary>클래스 원문</summary><pre><code>{code}</code></pre></details>}</aside>;
}
