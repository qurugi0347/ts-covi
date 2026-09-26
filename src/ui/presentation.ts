import type { BranchNode, ExitNode, FlowNode, SequenceNode, StatementNode } from "../model/flow.js";

export const nestedNodes = (node: FlowNode): FlowNode[] => node.kind === "sequence" ? node.children
  : node.kind === "branch" ? [node.then, ...(node.else ? [node.else] : [])]
  : node.kind === "loop" ? [...(node.initializerFlow ? [node.initializerFlow] : []), ...(node.conditionFlow ? [node.conditionFlow] : []), node.body, ...(node.incrementorFlow ? [node.incrementorFlow] : [])]
  : node.kind === "try" ? [node.body, ...(node.catch ? [node.catch.body] : []), ...(node.finally ? [node.finally] : [])]
  : [];

export type PresentedNode = { node: FlowNode; statement?: StatementNode | ExitNode };

export const presentSequence = (sequence: SequenceNode): PresentedNode[] => {
  const result: PresentedNode[] = [];
  for (const node of sequence.children) {
    const previous = result.at(-1);
    if ((node.kind === "statement" || node.kind === "return" || node.kind === "throw")
      && node.primaryCallId && previous?.node.kind === "call" && previous.node.id === node.primaryCallId) {
      previous.statement = node;
    } else result.push({ node });
  }
  return result;
};

export const emptyExpressionBranch = (node: FlowNode): boolean => node.kind === "branch"
  && node.origin === "expression" && node.then.children.length === 0 && (!node.else || node.else.children.length === 0);

export const compactExit = (sequence: SequenceNode): boolean => {
  const groups = presentSequence(sequence);
  if (groups.length !== 1) return false;
  const { node, statement } = groups[0]!;
  const exit = statement ?? node;
  return ["return", "throw", "break", "continue"].includes(exit.kind);
};

export const flowSummary = (node: FlowNode, ancestors: string[] = []): string => {
  let steps = 0;
  const counts = new Map<string, number>();
  const count = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
  const visit = (entry: FlowNode) => {
    if (entry.kind !== "sequence") steps++;
    if (["return", "throw", "break", "continue", "unsupported"].includes(entry.kind)) count(entry.kind);
    if (entry.kind === "call") {
      if (entry.boundary) count(entry.boundary);
      if (entry.awaited) count("await");
      if (entry.targetFunctionId && ancestors.includes(entry.targetFunctionId)) count("재귀 경계");
    }
    if (entry.kind === "try") {
      if (entry.catch) count("catch");
      if (entry.finally) count("finally");
      if (entry.finallyOverrides) count("finally 종료 덮어쓰기");
    }
    nestedNodes(entry).forEach(visit);
  };
  if (node.kind === "try") {
    if (node.catch) count("catch");
    if (node.finally) count("finally");
    if (node.finallyOverrides) count("finally 종료 덮어쓰기");
  }
  nestedNodes(node).forEach(visit);
  return [`${steps}개 노드`, ...[...counts].map(([label, amount]) => `${label} ${amount}`)].join(" · ");
};

export const branchArms = (branch: BranchNode): { node: BranchNode; otherwise?: SequenceNode }[] => {
  const result: { node: BranchNode; otherwise?: SequenceNode }[] = [];
  let current = branch;
  while (true) {
    const next = current.else?.children;
    if (current.origin === "statement" && next?.length === 1 && next[0]?.kind === "branch" && next[0].origin === "statement") {
      result.push({ node: current });
      current = next[0];
    } else {
      result.push({ node: current, otherwise: current.else });
      return result;
    }
  }
};

export const guardExitSummary = (sequence: SequenceNode): string => {
  const group = presentSequence(sequence)[0]!;
  if (group.node.kind === "call" && group.statement) return `${group.statement.kind} ${group.node.annotation?.label ?? group.node.displayExpression ?? `${group.node.calleeExpression}(…)`}`;
  const node = group.node;
  if (node.kind === "return" || node.kind === "throw") return `${node.kind} ${node.expression ?? ""}`.trim();
  if (node.kind === "break" || node.kind === "continue") return `${node.kind} ${node.targetLabel ?? ""}`.trim();
  return node.kind;
};
