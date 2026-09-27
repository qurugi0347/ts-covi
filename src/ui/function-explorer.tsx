import React, { useId, useLayoutEffect, useState } from "react";
import type { FlowDocument, FlowFunction } from "../model/flow.js";

type Item = { id: string; name: string; kind: "folder" | "file" | "class" | "function"; children: Map<string, Item>; functionId?: string; classId?: string; selected: boolean; active?: boolean };

export function explorerItems(flow: FlowDocument, query: string, selectedId?: string, selectedClassId?: string): Item[] {
  const root = new Map<string, Item>();
  const functionsByFile = new Map<string, FlowFunction[]>();
  for (const fn of flow.functions) {
    const list = functionsByFile.get(fn.source.fileId) ?? [];
    list.push(fn);
    functionsByFile.set(fn.source.fileId, list);
  }
  const search = query.toLocaleLowerCase();
  const matches = (text: string) => text.toLocaleLowerCase().includes(search);
  for (const file of flow.files) {
    const fileMatches = matches(file.path);
    const functions = (functionsByFile.get(file.id) ?? []).filter((fn) => fileMatches || matches(`${fn.className ?? ""} ${fn.name} ${fn.signature} ${fn.description ?? ""}`));
    const classes = flow.classes?.filter((entry) => entry.source.fileId === file.id && (fileMatches || matches(`${entry.name} ${entry.description ?? ""}`) || entry.methods.some((method) => matches(`${method.name} ${method.signature} ${method.description ?? ""}`)))) ?? [];
    if (search && !functions.length && !classes.length && !fileMatches) continue;
    let children = root;
    const parents: Item[] = [];
    const parts = file.path.split("/");
    for (const [index, name] of parts.entries()) {
      const id = parts.slice(0, index + 1).join("/");
      let item = children.get(id);
      if (!item) {
        item = { id, name, kind: index === parts.length - 1 ? "file" : "folder", children: new Map(), selected: false };
        children.set(id, item);
      }
      parents.push(item);
      children = item.children;
    }
    for (const entry of classes) {
      const selected = entry.id === selectedClassId || entry.methods.some((method) => method.functionId === selectedId && selectedId !== undefined);
      children.set(entry.id, { id: entry.id, name: entry.name, kind: "class", children: new Map(), classId: entry.id, selected, active: entry.id === selectedClassId });
      if (selected) parents.forEach((parent) => { parent.selected = true; });
    }
    for (const fn of functions) {
      let members = children;
      if (flow.classes && fn.classId) {
        const item = children.get(fn.classId);
        if (!item) continue;
        members = item.children;
      } else if (!flow.classes && fn.className) {
        const id = `class:${fn.className}`;
        let item = children.get(id);
        if (!item) {
          item = { id, name: fn.className, kind: "class", children: new Map(), selected: false };
          children.set(id, item);
        }
        item.selected ||= fn.id === selectedId;
        members = item.children;
      }
      members.set(fn.id, { id: fn.id, name: fn.name, kind: "function", children: new Map(), functionId: fn.id, selected: fn.id === selectedId });
      if (fn.id === selectedId) parents.forEach((parent) => { parent.selected = true; });
    }
  }
  return [...root.values()];
}

type BranchProps = { searching: boolean; onSelect: (id: string) => void; onClassSelect: (id: string) => void };

function ExplorerBranch({ items, ...props }: BranchProps & { items: Item[] }) {
  return <ul>{items.sort((a, b) => Number(a.kind === "function") - Number(b.kind === "function") || a.name.localeCompare(b.name)).map((item) => <li key={item.id}>{item.kind === "function"
    ? <button type="button" className={item.selected ? "active" : ""} aria-pressed={item.selected} onClick={() => props.onSelect(item.functionId!)}><span>{item.name}</span></button>
    : <ExplorerFolder item={item} {...props} />}</li>)}</ul>;
}

function ExplorerFolder({ item, ...props }: BranchProps & { item: Item }) {
  const [open, setOpen] = useState(props.searching || item.selected);
  const region = useId();
  useLayoutEffect(() => { if (props.searching || item.selected) setOpen(true); }, [props.searching, item.selected]);
  const contents = open && (item.children.size ? <ExplorerBranch items={[...item.children.values()]} {...props} /> : <p className="empty-list">표시할 함수가 없습니다.</p>);
  if (item.classId) return <div className="explorer-class"><div className="explorer-class-row"><button type="button" className="explorer-toggle" aria-label={`${item.name} 메서드 ${open ? "접기" : "펼치기"}`} aria-expanded={open} aria-controls={region} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button><button type="button" className={item.active ? "active" : ""} aria-pressed={!!item.active} onClick={() => props.onClassSelect(item.classId!)}><span><span className="explorer-kind">클래스</span> {item.name}</span></button></div><div id={region}>{contents}</div></div>;
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary><span className="explorer-kind">{item.kind === "folder" ? "폴더" : item.kind === "file" ? "파일" : "클래스"}</span> {item.name}</summary>{contents}</details>;
}

export function FunctionExplorer({ flow, query, selectedId, selectedClassId, onSelect, onClassSelect }: { flow: FlowDocument; query: string; selectedId?: string; selectedClassId?: string; onSelect: (id: string) => void; onClassSelect: (id: string) => void }) {
  const items = explorerItems(flow, query, selectedId, selectedClassId);
  return <nav className="function-explorer" aria-label="폴더와 파일 탐색">{!flow.classes && <p className="empty-list">클래스 개요를 보려면 다시 분석해 주세요.</p>}{items.length ? <ExplorerBranch items={items} searching={!!query} onSelect={onSelect} onClassSelect={onClassSelect} /> : <p className="empty-list">검색 결과가 없습니다.</p>}</nav>;
}
