import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { validateFlowDocument, type FlowDocument } from "../model/flow.js";
import "./styles.css";

function App() {
  const [document, setDocument] = useState<FlowDocument>();
  const [error, setError] = useState("");

  const load = async (file: File) => {
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("20 MB 이하의 JSON을 선택하세요.");
      setDocument(validateFlowDocument(JSON.parse(await file.text())));
      setError("");
    } catch (cause) {
      setDocument(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const first = document?.functions[0];
  return <main>
    <h1>ts-covi</h1>
    <p>분석 JSON을 선택해 함수 흐름을 읽습니다.</p>
    <label className="picker">JSON 선택<input type="file" accept="application/json,.json" onChange={(event) => {
      const file = event.target.files?.[0];
      if (file) void load(file);
    }} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    {first && <section className="function">
      <h2>{first.name}</h2>
      <code>{first.signature}</code>
      {first.body.children.slice(0, 1).map((node) => <article className={`block block-${node.kind}`} key={node.id}>
        <strong>{node.kind}</strong>
        <span>{node.kind === "call" ? node.calleeExpression : node.kind}</span>
      </article>)}
    </section>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
