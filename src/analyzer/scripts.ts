import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type ScriptCandidate = {
  origin: { kind: "package-script" | "bin" | "explicit"; name: string };
  command?: string;
  absolutePath?: string;
  relativePath?: string;
  reason?: string;
};

const posix = (value: string): string => value.split(path.sep).join("/");

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const scriptFile = (command: string): string | undefined => {
  if (/[;&|><`$()\n\r]/.test(command)) return undefined;
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2")) ?? [];
  if (tokens[0] !== "tsx" && tokens[0] !== "ts-node") return undefined;
  return tokens.slice(1).find((token) => !token.startsWith("-") && /\.(?:ts|tsx)$/.test(token));
};

const resolveCandidate = (root: string, input: string, origin: ScriptCandidate["origin"], command?: string): ScriptCandidate => {
  const absolute = path.resolve(root, input);
  let real: string;
  try {
    real = realpathSync(absolute);
  } catch {
    return { origin, command, reason: `Entry file does not exist: ${input}` };
  }
  if (!isWithin(root, real)) return { origin, command, reason: `Entry file is outside the project root: ${input}` };
  if (!/\.(?:ts|tsx)$/.test(real)) return { origin, command, reason: `Entry file is not TypeScript: ${input}` };
  return { origin, command, absolutePath: real, relativePath: posix(path.relative(root, real)) };
};

export const discoverScripts = (root: string, explicitEntries: string[], ignored: (relativePath: string) => boolean): ScriptCandidate[] => {
  const result: ScriptCandidate[] = [];
  const packagePath = path.join(root, "package.json");
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, unknown>; bin?: string | Record<string, unknown> };
    for (const [name, value] of Object.entries(packageJson.scripts ?? {})) {
      if (typeof value !== "string") continue;
      const file = scriptFile(value);
      result.push(file ? resolveCandidate(root, file, { kind: "package-script", name }, value) : { origin: { kind: "package-script", name }, command: value, reason: "Only direct tsx or ts-node TypeScript commands are supported." });
    }
    const bins = typeof packageJson.bin === "string" ? { [path.basename(root)]: packageJson.bin } : packageJson.bin ?? {};
    for (const [name, value] of Object.entries(bins)) {
      if (typeof value === "string") result.push(resolveCandidate(root, value, { kind: "bin", name }, value));
    }
  }
  for (const input of explicitEntries) {
    const candidate = resolveCandidate(root, input, { kind: "explicit", name: input }, input);
    if (!candidate.absolutePath) throw new Error(candidate.reason);
    if (ignored(candidate.relativePath!)) throw new Error(`Explicit entry is ignored: ${input}`);
    result.push(candidate);
  }
  return result.map((candidate) => candidate.relativePath && ignored(candidate.relativePath)
    ? { origin: candidate.origin, command: candidate.command, reason: `Entry file is ignored: ${candidate.relativePath}` }
    : candidate);
};
