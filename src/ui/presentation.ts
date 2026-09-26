import type { ExitNode, FlowNode, SequenceNode, StatementNode } from "../model/flow.js";

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
