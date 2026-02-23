import fs from "fs";
// @ts-ignore
import createVerovioModule from "verovio/wasm";
// @ts-ignore
import { VerovioToolkit } from "verovio/esm";
import * as lilylet from "../source/lilylet";

const lylPath = process.argv[2];
if (!lylPath) { console.error("Usage: tsx tests/render-lyl.ts <file.lyl> [output.svg]"); process.exit(1); }
const svgPath = process.argv[3] || lylPath.replace(/\.lyl$/, ".svg");

const code = fs.readFileSync(lylPath, "utf-8");
const doc = lilylet.parseCode(code);
const mei = lilylet.meiEncoder.encode(doc);

const measureCount = doc.measures?.length || 1;
let staffCount = 1;
if (doc.measures.length > 0) {
	const fm = doc.measures[0];
	staffCount = fm.parts.reduce((t, p) => {
		const ms = p.voices.reduce((m, v) => Math.max(m, v.staff || 1), 1);
		return t + ms;
	}, 0) || 1;
}
const pageHeight = Math.max(2000, Math.ceil(measureCount / 20) * 2000) * 2 * staffCount;

const VM = await createVerovioModule();
const vt = new VerovioToolkit(VM);
vt.setOptions({ scale: 40, adjustPageHeight: true, pageHeight, pageWidth: 2100 });

if (vt.loadData(mei) === false) { console.error("Verovio failed:", vt.getLog()); process.exit(1); }
const svg = vt.renderToSVG(1);
fs.writeFileSync(svgPath, svg);
console.log("Rendered:", svgPath);
