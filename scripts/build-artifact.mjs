// Construit la version Artifact (claude.ai) en un seul fichier HTML :
// artifact/page.html + moteur partagé (artifact/core.ts, empaqueté) + artifact/app.js.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const out = await build({
  entryPoints: ["artifact/core.ts"],
  bundle: true,
  format: "iife",
  globalName: "LocCore",
  minify: true,
  target: "es2020",
  write: false,
  tsconfig: "tsconfig.json",
});
const inline = (s) => s.replace(/<\/script/gi, "<\\/script");
const core = inline(out.outputFiles[0].text);
const app = inline(readFileSync("artifact/app.js", "utf8"));
const example = {
  url: "https://www.studapart.com/fr/residence/4337",
  text: readFileSync("artifact/example-studapart-4337.txt", "utf8"),
};
const html = [
  readFileSync("artifact/page.html", "utf8"),
  // export .xlsx (UMD, global writeXlsxFile)
  '<script src="https://cdn.jsdelivr.net/npm/write-excel-file@4.1.1/bundle/write-excel-file.min.js"></script>',
  `<script>${core}</script>`,
  `<script>window.LOC_EXAMPLE=${inline(JSON.stringify(example))};</script>`,
  `<script>${app}</script>`,
  "",
].join("\n");
mkdirSync("artifact/dist", { recursive: true });
writeFileSync("artifact/dist/loccompare.html", html);
console.log(`artifact/dist/loccompare.html — ${(html.length / 1024).toFixed(0)} Ko`);
