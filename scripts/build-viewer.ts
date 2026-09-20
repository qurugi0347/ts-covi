import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const result = await build({
  entryPoints: ["src/ui/main.tsx"],
  bundle: true,
  minify: true,
  write: false,
  outdir: "dist-tmp",
  format: "iife",
  target: ["es2022"],
  loader: { ".css": "css" },
});
const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
if (!javascript) throw new Error("Viewer JavaScript bundle was not produced.");
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ts-covi</title><style>${css}</style></head>
<body><div id="root"></div><script>${javascript}</script></body></html>`;
await writeFile("dist/viewer.html", html);
const built = await readFile("dist/viewer.html", "utf8");
if (/\b(?:src|href)=["'][^"']+["']/.test(built)) throw new Error("viewer.html contains an external asset reference.");
console.log(`Built dist/viewer.html (${Buffer.byteLength(built)} bytes)`);
