import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Setup DOM mock for abcjs (browser DOM required)
const domImpl = new DOMImplementation();
const doc = domImpl.createDocument("http://www.w3.org/1999/xhtml", "html", null);
const body = doc.createElement("body");
(doc.documentElement || doc).appendChild(body);

const NodeProto = Object.getPrototypeOf(doc.createElement("span"));

function patchEl(el: any): any {
	if (!el || el._patched) return el;
	el._patched = true;
	if (!el.style) el.style = {};
	el.addEventListener = () => {};
	el.removeEventListener = () => {};
	el.getBBox = () => ({ width: 8, height: 12, x: 0, y: 0 });
	const origAC = el.appendChild.bind(el);
	el.appendChild = (child: any) => { patchEl(child); return origAC(child); };
	const origIB = el.insertBefore.bind(el);
	el.insertBefore = (child: any, ref: any) => { patchEl(child); return origIB(child, ref); };
	return el;
}

const origCE = doc.createElement.bind(doc);
const origCENS = doc.createElementNS.bind(doc);
doc.createElement = (tag: string) => patchEl(origCE(tag));
doc.createElementNS = (ns: string, tag: string) => patchEl(origCENS(ns, tag));

if (!Object.getOwnPropertyDescriptor(NodeProto, "children")) {
	Object.defineProperty(NodeProto, "children", {
		get() {
			const a: any[] = [];
			let c = this.firstChild;
			while (c) { if (c.nodeType === 1) a.push(c); c = c.nextSibling; }
			return a;
		},
		configurable: true,
	});
}

if (!Object.getOwnPropertyDescriptor(NodeProto, "parentElement")) {
	Object.defineProperty(NodeProto, "parentElement", {
		get() { return (this.parentNode?.nodeType === 1) ? this.parentNode : null; },
		configurable: true,
	});
}

if (!Object.getOwnPropertyDescriptor(NodeProto, "textContent")) {
	Object.defineProperty(NodeProto, "textContent", {
		get() { return this.nodeValue || ""; },
		set(v: string) {
			while (this.firstChild) this.removeChild(this.firstChild);
			this.appendChild(doc.createTextNode(v));
		},
		configurable: true,
	});
}

doc.querySelector = (sel: string) => sel === "body" ? body : null;
(doc as any).querySelectorAll = () => [];

(global as any).document = doc;
(global as any).window = { addEventListener: () => {} };

// Now import abcjs (after DOM is set up)
const abcjsMod = await import("abcjs");
const abcjs = (abcjsMod as any).default ?? abcjsMod;

const ABC_DIR = path.join(__dirname, "assets/abc");
const OUT_DIR = path.join(__dirname, "output/from-abc-svg");
const LOG_FILE = path.join(__dirname, "output/abc-abcjs-svg.log");

fs.mkdirSync(OUT_DIR, { recursive: true });

const abcFiles = fs.readdirSync(ABC_DIR).filter(f => f.endsWith(".abc")).sort();
const serializer = new XMLSerializer();

const logLines: string[] = [];
let passCount = 0;
let skipCount = 0;

for (const fname of abcFiles) {
	const abcPath = path.join(ABC_DIR, fname);
	const abcContent = fs.readFileSync(abcPath, "utf-8");
	const baseName = fname.replace(/\.abc$/, "");
	const svgPath = path.join(OUT_DIR, baseName + ".svg");

	try {
		// Create a fresh div container for each file
		const div = doc.createElement("div");
		patchEl(div);

		abcjs.renderAbc(div as any, abcContent, {});

		// Collect all non-empty SVGs (abcjs may produce one per tune + empty placeholders)
		const svgs: any[] = [];
		collectSvgs(div, svgs);
		const nonEmpty = svgs.filter(s => s.childNodes?.length > 0);
		if (nonEmpty.length === 0) {
			throw new Error("No non-empty SVG element found in output");
		}

		const svgStr = nonEmpty.map(s => serializer.serializeToString(s)).join("\n");
		fs.writeFileSync(svgPath, svgStr, "utf-8");

		console.log(`PASS  ${fname}`);
		passCount++;
	}
	catch (err: any) {
		const msg = err?.message || String(err);
		console.error(`SKIP  ${fname}  — ${msg}`);
		logLines.push(`${fname}: ${msg}`);
		skipCount++;
	}
}

fs.writeFileSync(LOG_FILE, logLines.join("\n") + (logLines.length ? "\n" : ""), "utf-8");

console.log(`\nResults: ${passCount} pass, ${skipCount} skip out of ${abcFiles.length}`);
if (logLines.length) {
	console.log(`Error log: ${LOG_FILE}`);
}


function findLastNonEmptySvg(el: any): any {
	const svgs: any[] = [];
	collectSvgs(el, svgs);
	// Return the last SVG that has children
	for (let i = svgs.length - 1; i >= 0; i--) {
		if (svgs[i].childNodes?.length > 0) return svgs[i];
	}
	return svgs[svgs.length - 1] ?? null;
}

function collectSvgs(el: any, out: any[]): void {
	if (el.tagName === "svg" || el.localName === "svg") out.push(el);
	let c = el.firstChild;
	while (c) { collectSvgs(c, out); c = c.nextSibling; }
}

function findFirstSvg(el: any): any {
	if (el.tagName === "svg" || el.localName === "svg") return el;
	let c = el.firstChild;
	while (c) {
		const found = findFirstSvg(c);
		if (found) return found;
		c = c.nextSibling;
	}
	return null;
}
