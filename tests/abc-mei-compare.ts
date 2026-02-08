
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// @ts-ignore
import createVerovioModule from "verovio/wasm";
// @ts-ignore
import { VerovioToolkit } from "verovio/esm";
import { DOMParser } from "@xmldom/xmldom";

import { abcDecoder, meiEncoder } from "../source/lilylet/index";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABC_DIR = path.join(__dirname, "assets/abc");
const OUTPUT_DIR = path.join(__dirname, "output/abc-mei-compare");

const MEI_NS = "http://www.music-encoding.org/ns/mei";


/** Count V: declarations in ABC source to determine voice count. */
const countAbcVoices = (abc: string): number => {
	const voiceIds = new Set<string>();
	for (const line of abc.split("\n")) {
		const m = line.match(/^V:\s*(\S+)/);
		if (m) voiceIds.add(m[1]);
		// Also count inline [V:x] directives
		const inlines = line.matchAll(/\[V:(\S+?)\]/g);
		for (const im of inlines) voiceIds.add(im[1]);
	}
	return Math.max(1, voiceIds.size);
};


/** Extract only voice-1 measures from Verovio's flat measure list.
 *  Verovio creates one <measure> per [V:x]..| segment, cycling through voices.
 *  Voice 1 measures are at indices 0, numVoices, 2*numVoices, etc.
 */
const extractVoice1Measures = (allMeasures: MeasureInfo[], numVoices: number): MeasureInfo[] => {
	if (numVoices <= 1) return allMeasures;
	const result: MeasureInfo[] = [];
	for (let i = 0; i < allMeasures.length; i += numVoices) {
		result.push({ ...allMeasures[i], number: result.length + 1 });
	}
	return result;
};


interface IVerovioToolkit {
	loadData(data: string): boolean;
	renderToSVG(page?: number): string;
	setOptions(options: object): void;
	getLog(): string;
	getMEI(options?: object): string;
}


interface NoteInfo {
	pname: string;       // c, d, e, f, g, a, b
	oct: number;
	accid?: string;      // s, f, n, ss, ff
	dur: string;         // 1, 2, 4, 8, 16...
	dots: number;
	isRest: boolean;
}

interface MeasureInfo {
	number: number;
	keySig?: string;     // e.g. "3s", "2f"
	timeSig?: string;    // "4/4", "6/8"
	notes: NoteInfo[];   // flattened from staff 1, layer 1
}

interface FileResult {
	name: string;
	verovioMeasures: MeasureInfo[];
	lilyletMeasures: MeasureInfo[];
	verovioLog: string;
	error?: string;
	matchPercent: number;
	totalNotes: { verovio: number; lilylet: number };
	diffs: DiffEntry[];
}

interface DiffEntry {
	measure: number;
	index: number;
	field: string;
	verovio: string;
	lilylet: string;
}


// ─── MEI XML Extraction ─────────────────────────────────────────────

const extractMeasures = (meiXml: string): MeasureInfo[] => {
	const doc = new DOMParser().parseFromString(meiXml, "text/xml");
	const measures: MeasureInfo[] = [];

	const body = doc.getElementsByTagNameNS(MEI_NS, "body")[0]
		|| doc.getElementsByTagName("body")[0];
	if (!body) return measures;

	const sections = body.getElementsByTagNameNS(MEI_NS, "section");
	const section = sections.length > 0 ? sections[0] : body;

	// Collect all <measure> elements
	const measureEls = section.getElementsByTagNameNS(MEI_NS, "measure");

	for (let mi = 0; mi < measureEls.length; mi++) {
		const measureEl = measureEls[mi];
		const mNum = parseInt(measureEl.getAttribute("n") || String(mi + 1));

		const info: MeasureInfo = { number: mNum, notes: [] };

		// Find staff 1
		const staves = measureEl.getElementsByTagNameNS(MEI_NS, "staff");
		let staff1: Element | null = null;
		for (let si = 0; si < staves.length; si++) {
			if (staves[si].getAttribute("n") === "1") {
				staff1 = staves[si];
				break;
			}
		}
		if (!staff1 && staves.length > 0) staff1 = staves[0];
		if (!staff1) {
			measures.push(info);
			continue;
		}

		// Find layer 1
		const layers = staff1.getElementsByTagNameNS(MEI_NS, "layer");
		let layer1: Element | null = null;
		for (let li = 0; li < layers.length; li++) {
			if (layers[li].getAttribute("n") === "1") {
				layer1 = layers[li];
				break;
			}
		}
		if (!layer1 && layers.length > 0) layer1 = layers[0];
		if (!layer1) {
			measures.push(info);
			continue;
		}

		// Extract key/time from scoreDef or staffDef preceding this measure
		const scoreDefs = measureEl.getElementsByTagNameNS(MEI_NS, "scoreDef");
		if (scoreDefs.length > 0) {
			const sd = scoreDefs[0];
			const keySig = sd.getAttribute("key.sig");
			const timeSig = sd.getAttribute("meter.count") && sd.getAttribute("meter.unit")
				? `${sd.getAttribute("meter.count")}/${sd.getAttribute("meter.unit")}`
				: undefined;
			if (keySig) info.keySig = keySig;
			if (timeSig) info.timeSig = timeSig;
		}

		// Also check staffDef inside the measure for key/time
		const staffDefs = measureEl.getElementsByTagNameNS(MEI_NS, "staffDef");
		for (let sdi = 0; sdi < staffDefs.length; sdi++) {
			const sd = staffDefs[sdi];
			if (sd.getAttribute("n") === "1" || !sd.getAttribute("n")) {
				const keySig = sd.getAttribute("key.sig");
				const meterCount = sd.getAttribute("meter.count");
				const meterUnit = sd.getAttribute("meter.unit");
				if (keySig) info.keySig = keySig;
				if (meterCount && meterUnit) info.timeSig = `${meterCount}/${meterUnit}`;
			}
		}

		// Extract notes and rests from layer 1
		extractNotesFromElement(layer1, info.notes);

		measures.push(info);
	}

	// Also extract initial key/time from the scoreDef in the header
	const initialScoreDef = doc.getElementsByTagNameNS(MEI_NS, "scoreDef")[0];
	if (initialScoreDef && measures.length > 0) {
		const keySig = initialScoreDef.getAttribute("key.sig");
		const meterCount = initialScoreDef.getAttribute("meter.count");
		const meterUnit = initialScoreDef.getAttribute("meter.unit");
		if (keySig && !measures[0].keySig) measures[0].keySig = keySig;
		if (meterCount && meterUnit && !measures[0].timeSig) {
			measures[0].timeSig = `${meterCount}/${meterUnit}`;
		}
		// Check inside staffDef too
		const staffDefs = initialScoreDef.getElementsByTagNameNS(MEI_NS, "staffDef");
		for (let i = 0; i < staffDefs.length; i++) {
			const sd = staffDefs[i];
			if (sd.getAttribute("n") === "1" || !sd.getAttribute("n")) {
				const ks = sd.getAttribute("key.sig");
				const mc = sd.getAttribute("meter.count");
				const mu = sd.getAttribute("meter.unit");
				if (ks && !measures[0].keySig) measures[0].keySig = ks;
				if (mc && mu && !measures[0].timeSig) measures[0].timeSig = `${mc}/${mu}`;
			}
		}
	}

	return measures;
};


const extractNotesFromElement = (el: Element, notes: NoteInfo[]): void => {
	for (let i = 0; i < el.childNodes.length; i++) {
		const child = el.childNodes[i] as Element;
		if (!child.tagName) continue;

		const localName = child.localName || child.tagName.replace(/^.*:/, "");

		if (localName === "note") {
			const pname = child.getAttribute("pname");
			const oct = child.getAttribute("oct");
			const dur = child.getAttribute("dur");
			if (pname && oct && dur) {
				const accid = child.getAttribute("accid") || child.getAttribute("accid.ges") || undefined;
				const dots = parseInt(child.getAttribute("dots") || "0");
				notes.push({
					pname,
					oct: parseInt(oct),
					accid,
					dur,
					dots,
					isRest: false,
				});
			}
			// Check for child accid element
			if (pname && oct && dur) {
				const accidEls = child.getElementsByTagNameNS(MEI_NS, "accid");
				if (accidEls.length > 0 && !notes[notes.length - 1].accid) {
					const a = accidEls[0].getAttribute("accid") || accidEls[0].getAttribute("accid.ges");
					if (a) notes[notes.length - 1].accid = a;
				}
			}
		} else if (localName === "rest" || localName === "mRest") {
			const dur = child.getAttribute("dur") || (localName === "mRest" ? "1" : undefined);
			if (dur) {
				notes.push({
					pname: "",
					oct: 0,
					dur,
					dots: parseInt(child.getAttribute("dots") || "0"),
					isRest: true,
				});
			}
		} else if (localName === "chord") {
			// For chords, extract all notes inside
			extractNotesFromElement(child, notes);
		} else if (localName === "beam" || localName === "tuplet") {
			// Recurse into containers
			extractNotesFromElement(child, notes);
		}
	}
};


// ─── Comparison Logic ────────────────────────────────────────────────

const compareFiles = (verovioMeasures: MeasureInfo[], lilyletMeasures: MeasureInfo[]): { matchPercent: number; diffs: DiffEntry[] } => {
	const diffs: DiffEntry[] = [];
	const measureCount = Math.min(verovioMeasures.length, lilyletMeasures.length);
	let totalCompared = 0;
	let totalMatched = 0;

	for (let mi = 0; mi < measureCount; mi++) {
		const vm = verovioMeasures[mi];
		const lm = lilyletMeasures[mi];

		// Compare key/time sigs
		if (vm.keySig && lm.keySig && vm.keySig !== lm.keySig) {
			diffs.push({ measure: mi + 1, index: -1, field: "keySig", verovio: vm.keySig, lilylet: lm.keySig });
		}
		if (vm.timeSig && lm.timeSig && vm.timeSig !== lm.timeSig) {
			diffs.push({ measure: mi + 1, index: -1, field: "timeSig", verovio: vm.timeSig, lilylet: lm.timeSig });
		}

		// Compare notes
		const noteCount = Math.min(vm.notes.length, lm.notes.length);
		if (vm.notes.length !== lm.notes.length) {
			diffs.push({
				measure: mi + 1,
				index: -1,
				field: "noteCount",
				verovio: String(vm.notes.length),
				lilylet: String(lm.notes.length),
			});
		}

		for (let ni = 0; ni < noteCount; ni++) {
			const vn = vm.notes[ni];
			const ln = lm.notes[ni];
			totalCompared++;

			let matched = true;

			if (vn.isRest !== ln.isRest) {
				diffs.push({ measure: mi + 1, index: ni, field: "rest/note", verovio: vn.isRest ? "rest" : "note", lilylet: ln.isRest ? "rest" : "note" });
				matched = false;
			} else if (!vn.isRest) {
				// Compare pitch
				if (vn.pname !== ln.pname || vn.oct !== ln.oct) {
					diffs.push({ measure: mi + 1, index: ni, field: "pitch", verovio: `${vn.pname}${vn.oct}`, lilylet: `${ln.pname}${ln.oct}` });
					matched = false;
				}
				// Compare accidentals
				if ((vn.accid || "") !== (ln.accid || "")) {
					diffs.push({ measure: mi + 1, index: ni, field: "accid", verovio: vn.accid || "none", lilylet: ln.accid || "none" });
					matched = false;
				}
			}

			// Compare duration
			if (vn.dur !== ln.dur) {
				diffs.push({ measure: mi + 1, index: ni, field: "dur", verovio: vn.dur, lilylet: ln.dur });
				matched = false;
			}
			if (vn.dots !== ln.dots) {
				diffs.push({ measure: mi + 1, index: ni, field: "dots", verovio: String(vn.dots), lilylet: String(ln.dots) });
				matched = false;
			}

			if (matched) totalMatched++;
		}
	}

	const matchPercent = totalCompared > 0 ? Math.round((totalMatched / totalCompared) * 100) : 0;
	return { matchPercent, diffs };
};


// ─── Main ────────────────────────────────────────────────────────────

const main = async () => {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	// Initialize Verovio
	console.log("Initializing Verovio...");
	const VerovioModule = await createVerovioModule();
	const vrvToolkit = new VerovioToolkit(VerovioModule) as IVerovioToolkit;
	console.log("Verovio initialized.\n");

	const files = fs.readdirSync(ABC_DIR).filter(f => f.endsWith(".abc")).sort();
	console.log(`Found ${files.length} ABC files\n`);

	const results: FileResult[] = [];

	for (const file of files) {
		const baseName = path.basename(file, ".abc");
		const abcContent = fs.readFileSync(path.join(ABC_DIR, file), "utf-8");

		let verovioMei = "";
		let lilyletMei = "";
		let verovioLog = "";
		let error: string | undefined;

		// ── Direct path: ABC → Verovio → MEI ──
		try {
			vrvToolkit.setOptions({
				scale: 40,
				adjustPageHeight: true,
				pageHeight: 6000,
				pageWidth: 2100,
				inputFrom: "abc",
			});
			const loaded = vrvToolkit.loadData(abcContent);
			verovioLog = vrvToolkit.getLog();
			if (loaded) {
				verovioMei = vrvToolkit.getMEI();

				// Render Verovio SVG
				const verovioSvg = vrvToolkit.renderToSVG(1);
				if (verovioSvg) {
					fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.verovio.svg`), verovioSvg);
				}
			} else {
				error = `Verovio failed to load: ${verovioLog}`;
			}
		} catch (err: any) {
			error = `Verovio error: ${err.message}`;
		}

		// ── Indirect path: ABC → lilylet abcDecoder → meiEncoder → MEI ──
		try {
			const doc = abcDecoder.decode(abcContent);
			lilyletMei = meiEncoder.encode(doc);
		} catch (err: any) {
			error = (error ? error + "; " : "") + `Lilylet error: ${err.message}`;
		}

		// Render lilylet MEI via a fresh Verovio toolkit (ABC mode contaminates state)
		if (lilyletMei) {
			try {
				const vrvMei = new VerovioToolkit(VerovioModule) as IVerovioToolkit;
				vrvMei.setOptions({
					scale: 40,
					adjustPageHeight: true,
					pageHeight: 6000,
					pageWidth: 2100,
				});
				const loaded = vrvMei.loadData(lilyletMei);
				if (loaded) {
					const lilyletSvg = vrvMei.renderToSVG(1);
					if (lilyletSvg) {
						fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.lilylet.svg`), lilyletSvg);
					}
				}
			} catch {
				// Verovio rendering of lilylet MEI failed — not a comparison error
			}
		}

		// Save MEI files
		if (verovioMei) {
			fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.verovio.mei`), verovioMei);
		}
		if (lilyletMei) {
			fs.writeFileSync(path.join(OUTPUT_DIR, `${baseName}.lilylet.mei`), lilyletMei);
		}

		// ── Extract and compare ──
		const numVoices = countAbcVoices(abcContent);
		const verovioAllMeasures = verovioMei ? extractMeasures(verovioMei) : [];
		const verovioMeasures = extractVoice1Measures(verovioAllMeasures, numVoices);
		const lilyletMeasures = lilyletMei ? extractMeasures(lilyletMei) : [];

		const { matchPercent, diffs } = compareFiles(verovioMeasures, lilyletMeasures);

		const totalNotes = {
			verovio: verovioMeasures.reduce((s, m) => s + m.notes.length, 0),
			lilylet: lilyletMeasures.reduce((s, m) => s + m.notes.length, 0),
		};

		const result: FileResult = {
			name: baseName,
			verovioMeasures,
			lilyletMeasures,
			verovioLog,
			error,
			matchPercent,
			totalNotes,
			diffs,
		};
		results.push(result);

		// Console summary
		const status = error ? "ERR" : matchPercent >= 90 ? "OK " : "DIF";
		const noteInfo = `notes V:${totalNotes.verovio} L:${totalNotes.lilylet}`;
		const measInfo = `meas V:${verovioMeasures.length} L:${lilyletMeasures.length}`;
		console.log(`[${status}] ${baseName.padEnd(28)} ${measInfo.padEnd(16)} ${noteInfo.padEnd(20)} match:${matchPercent}%`);
		if (error) console.log(`      ${error.substring(0, 120)}`);
	}

	// ── Generate report ──
	generateReport(results);

	// ── Generate comparison HTML gallery ──
	generateComparisonHtml(results);

	// Summary
	console.log(`\n${"=".repeat(80)}`);
	const ok = results.filter(r => !r.error && r.matchPercent >= 90).length;
	const diff = results.filter(r => !r.error && r.matchPercent < 90).length;
	const err = results.filter(r => r.error).length;
	console.log(`Results: ${ok} match(>=90%), ${diff} differ, ${err} error out of ${results.length}`);
	console.log(`Output: ${OUTPUT_DIR}`);
	console.log(`Report: ${OUTPUT_DIR}/report.md`);
};


// ─── Report ──────────────────────────────────────────────────────────

const generateReport = (results: FileResult[]) => {
	const lines: string[] = [];
	lines.push("# ABC → MEI Comparison Report\n");
	lines.push(`Generated: ${new Date().toISOString()}\n`);

	// Summary table
	lines.push("## Summary\n");
	lines.push("| File | Measures (V/L) | Notes (V/L) | Match % | Status |");
	lines.push("|------|---------------|-------------|---------|--------|");

	for (const r of results) {
		const measV = r.verovioMeasures.length;
		const measL = r.lilyletMeasures.length;
		const status = r.error ? "Error" : r.matchPercent >= 90 ? "OK" : "Diff";
		lines.push(`| ${r.name} | ${measV}/${measL} | ${r.totalNotes.verovio}/${r.totalNotes.lilylet} | ${r.matchPercent}% | ${status} |`);
	}

	// Per-file details
	lines.push("\n## Per-File Details\n");

	for (const r of results) {
		if (r.error || r.diffs.length === 0) {
			if (r.error) {
				lines.push(`### ${r.name}\n`);
				lines.push(`**Error**: ${r.error}\n`);
			}
			continue;
		}

		lines.push(`### ${r.name}\n`);
		lines.push(`- Measures: Verovio ${r.verovioMeasures.length}, Lilylet ${r.lilyletMeasures.length}`);
		lines.push(`- Notes: Verovio ${r.totalNotes.verovio}, Lilylet ${r.totalNotes.lilylet}`);
		lines.push(`- Match: ${r.matchPercent}%`);
		if (r.verovioLog) {
			lines.push(`- Verovio log: ${r.verovioLog.substring(0, 200).replace(/\n/g, " ")}`);
		}
		lines.push("");

		// Categorize diffs
		const diffCats: Record<string, DiffEntry[]> = {};
		for (const d of r.diffs) {
			const cat = d.field;
			if (!diffCats[cat]) diffCats[cat] = [];
			diffCats[cat].push(d);
		}

		// Show first 20 diffs per category
		for (const [cat, diffs] of Object.entries(diffCats)) {
			lines.push(`**${cat}** (${diffs.length} differences):`);
			const shown = diffs.slice(0, 20);
			for (const d of shown) {
				const loc = d.index >= 0 ? `m${d.measure}[${d.index}]` : `m${d.measure}`;
				lines.push(`- ${loc}: V=\`${d.verovio}\` L=\`${d.lilylet}\``);
			}
			if (diffs.length > 20) lines.push(`- ... and ${diffs.length - 20} more`);
			lines.push("");
		}
	}

	// Analysis
	lines.push("## Analysis\n");

	const totalDiffs = results.reduce((s, r) => s + r.diffs.length, 0);
	const pitchDiffs = results.reduce((s, r) => s + r.diffs.filter(d => d.field === "pitch").length, 0);
	const durDiffs = results.reduce((s, r) => s + r.diffs.filter(d => d.field === "dur").length, 0);
	const dotDiffs = results.reduce((s, r) => s + r.diffs.filter(d => d.field === "dots").length, 0);
	const accidDiffs = results.reduce((s, r) => s + r.diffs.filter(d => d.field === "accid").length, 0);
	const countDiffs = results.reduce((s, r) => s + r.diffs.filter(d => d.field === "noteCount").length, 0);
	const restNoteDiffs = results.reduce((s, r) => s + r.diffs.filter(d => d.field === "rest/note").length, 0);

	lines.push(`Total differences: ${totalDiffs}`);
	lines.push(`- Pitch: ${pitchDiffs}`);
	lines.push(`- Duration: ${durDiffs}`);
	lines.push(`- Dots: ${dotDiffs}`);
	lines.push(`- Accidentals: ${accidDiffs}`);
	lines.push(`- Note counts: ${countDiffs}`);
	lines.push(`- Rest/note type: ${restNoteDiffs}`);
	lines.push("");
	lines.push("**Note**: Verovio's ABC import does NOT support multi-voice music. It only parses voice 1 content,");
	lines.push("so differences may arise from Verovio merging/dropping multi-voice data. Comparison is limited to staff 1, layer 1.");

	fs.writeFileSync(path.join(OUTPUT_DIR, "report.md"), lines.join("\n"));
};


// ─── Comparison HTML Gallery ─────────────────────────────────────────

const generateComparisonHtml = (results: FileResult[]) => {
	const cards = results.map(r => {
		const status = r.error ? "error" : r.matchPercent >= 90 ? "ok" : "diff";
		const statusLabel = r.error ? "Error" : r.matchPercent >= 90 ? `${r.matchPercent}% Match` : `${r.matchPercent}% Match`;
		return `        <div class="card ${status}">
            <div class="card-header">
                <span class="name">${r.name}</span>
                <span class="status-badge ${status}">${statusLabel}</span>
            </div>
            <div class="comparison">
                <div class="side">
                    <div class="side-label">Verovio (direct ABC→MEI)</div>
                    <img src="${r.name}.verovio.svg" alt="Verovio" onerror="this.parentElement.innerHTML='<p>No SVG</p>'">
                </div>
                <div class="side">
                    <div class="side-label">Lilylet (ABC→lilylet→MEI)</div>
                    <img src="${r.name}.lilylet.svg" alt="Lilylet" onerror="this.parentElement.innerHTML='<p>No SVG</p>'">
                </div>
            </div>
            <div class="card-footer">
                <span>Measures: V:${r.verovioMeasures.length} L:${r.lilyletMeasures.length} | Notes: V:${r.totalNotes.verovio} L:${r.totalNotes.lilylet}</span>
                <span><a href="${r.name}.verovio.mei">V-MEI</a> | <a href="${r.name}.lilylet.mei">L-MEI</a></span>
            </div>
        </div>`;
	}).join("\n");

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>ABC→MEI Comparison</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        h1 { text-align: center; color: #333; }
        .gallery { display: flex; flex-direction: column; gap: 24px; max-width: 1400px; margin: 0 auto; }
        .card { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
        .card.error { border-left: 4px solid #e74c3c; }
        .card.diff { border-left: 4px solid #f39c12; }
        .card.ok { border-left: 4px solid #2ecc71; }
        .card-header { padding: 12px 16px; background: #f8f9fa; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .card-header .name { font-weight: 600; font-size: 15px; }
        .status-badge { padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .status-badge.ok { background: #d4edda; color: #155724; }
        .status-badge.diff { background: #fff3cd; color: #856404; }
        .status-badge.error { background: #f8d7da; color: #721c24; }
        .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #eee; }
        .side { background: white; padding: 12px; text-align: center; }
        .side-label { font-size: 12px; color: #888; margin-bottom: 8px; font-weight: 500; }
        .side img { max-width: 100%; height: auto; }
        .card-footer { padding: 8px 16px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 12px; color: #666; display: flex; justify-content: space-between; }
        .card-footer a { color: #4a90d9; text-decoration: none; }
    </style>
</head>
<body>
    <h1>ABC → MEI Comparison: Verovio vs Lilylet</h1>
    <div class="gallery">
${cards}
    </div>
</body>
</html>`;

	fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), html);
};


main();
