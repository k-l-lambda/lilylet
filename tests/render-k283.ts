import fs from "fs";
// @ts-ignore
import createVerovioModule from "verovio/wasm";
// @ts-ignore
import { VerovioToolkit } from "verovio/esm";
import * as lilylet from "../source/lilylet";

const code = fs.readFileSync("/home/camus/work/openmusictheory-lilylet/Graphics/lilylet/k283.lyl", "utf-8");
const doc = lilylet.parseCode(code);
const mei = lilylet.meiEncoder.encode(doc);

// Save MEI for debugging
fs.writeFileSync("/home/camus/work/openmusictheory-lilylet/Graphics/lilylet/k283.mei", mei);

const measureCount = doc.measures?.length || 1;
let staffCount = 1;
if (doc.measures.length > 0) {
	const firstMeasure = doc.measures[0];
	staffCount = firstMeasure.parts.reduce((total, part) => {
		const maxStaff = part.voices.reduce((max, voice) => Math.max(max, voice.staff || 1), 1);
		return total + maxStaff;
	}, 0) || 1;
}
const pageHeight = Math.max(2000, Math.ceil(measureCount / 20) * 2000) * 2 * staffCount;

console.log(`Measures: ${measureCount}, Staves: ${staffCount}, PageHeight: ${pageHeight}`);

const VerovioModule = await createVerovioModule();
const vrvToolkit = new VerovioToolkit(VerovioModule);
vrvToolkit.setOptions({ scale: 40, adjustPageHeight: true, pageHeight, pageWidth: 2100 });

const success = vrvToolkit.loadData(mei);
if (success === false) {
	console.error("Failed:", vrvToolkit.getLog());
	process.exit(1);
}

const svg = vrvToolkit.renderToSVG(1);
fs.writeFileSync("/home/camus/work/openmusictheory-lilylet/Graphics/lilylet/k283.svg", svg);
console.log(`Rendered: ${svg.length} bytes → k283.svg`);
