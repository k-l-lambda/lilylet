/**
 * lylTimeline.ts
 *
 * Usage: npx tsx tools/lylTimeline.ts <input.lyl> [output.md|output-dir/]
 *
 * Parses a .lyl file and writes a Markdown file containing an SVG timeline
 * for every measure.  Each voice occupies one horizontal row; note/rest events
 * are drawn as coloured rectangles positioned by their tick offset.
 * Staff changes within a voice are shown as ↑/↓ arrows.
 * Each measure is preceded by a ```lyl source block.
 *
 * Tick unit: 480 ticks = 1 quarter note  (whole = 1920)
 */

import { parseCode } from '../source/lilylet/index.js';
import type {
	Event, NoteEvent, RestEvent, TupletEvent, TimesEvent, TremoloEvent,
	ContextChange, Duration,
} from '../source/lilylet/types.js';
import * as fs from 'fs';
import * as path from 'path';

// ─── tick maths ──────────────────────────────────────────────────────────────

const TPQN = 480;

function durationTicks(dur: Duration): number {
	let t = (TPQN * 4) / dur.division;
	let dot = t / 2;
	for (let i = 0; i < dur.dots; i++) { t += dot; dot /= 2; }
	if (dur.tuplet) t = t * dur.tuplet.numerator / dur.tuplet.denominator;
	return Math.round(t);
}

// ─── flat event model ────────────────────────────────────────────────────────

type BarKind = 'note' | 'rest' | 'grace' | 'tremolo' | 'staff-change';

interface Bar {
	start: number;
	dur:   number;
	label: string;
	kind:  BarKind;
}

function pitchLabel(ne: NoteEvent): string {
	if (ne.pitches.length === 0) return '?';
	// Scientific pitch notation: middle C (lilylet octave 0) = C4
	const sciPitch = (p: typeof ne.pitches[0]) => {
		const acc = p.accidental === 'sharp' ? '#'
		          : p.accidental === 'flat'  ? 'b'
		          : p.accidental === 'natural' ? '♮' : '';
		return `${p.phonet.toUpperCase()}${acc}${p.octave + 4}`;
	};
	if (ne.pitches.length === 1) return sciPitch(ne.pitches[0]);
	return `<${ne.pitches.map(p => p.phonet.toUpperCase()).join('')}>`;
}

function flattenEvents(events: Event[], initialStaff: number): Bar[] {
	const bars: Bar[] = [];
	let tick = 0;
	let currentStaff = initialStaff;

	// tickMul accumulates the time-warp from enclosing tuplet/times blocks.
	// Inner event durations from parseCode() are written values with no tuplet
	// ratio applied, so we multiply manually when descending into a block.
	function walk(ev: Event, tickMul: number): void {
		switch (ev.type) {
			case 'note': {
				const ne = ev as NoteEvent;
				if (ne.grace) {
					bars.push({ start: tick, dur: 0, label: pitchLabel(ne), kind: 'grace' });
					return;
				}
				const dur = Math.round(durationTicks(ne.duration) * tickMul);
				bars.push({ start: tick, dur, label: pitchLabel(ne), kind: 'note' });
				tick += dur;
				break;
			}
			case 'rest': {
				const re = ev as RestEvent;
				const dur = Math.round(durationTicks(re.duration) * tickMul);
				const lbl = re.fullMeasure ? 'R' : re.invisible ? 's' : 'r';
				bars.push({ start: tick, dur, label: lbl, kind: 'rest' });
				tick += dur;
				break;
			}
			case 'context': {
				const ce = ev as ContextChange;
				if (ce.staff !== undefined && ce.staff !== currentStaff) {
					const arrow = ce.staff > currentStaff ? '↓' : '↑';
					bars.push({ start: tick, dur: 0, label: arrow, kind: 'staff-change' });
					currentStaff = ce.staff;
				}
				break;
			}
			case 'tuplet':
			case 'times': {
				const te = ev as TupletEvent | TimesEvent;
				const mul = tickMul * te.ratio.numerator / te.ratio.denominator;
				for (const inner of te.events) walk(inner as Event, mul);
				break;
			}
			case 'tremolo': {
				const te = ev as TremoloEvent;
				const dur = te.count * 2 * Math.round((TPQN * 4) / te.division);
				bars.push({ start: tick, dur, label: `trem×${te.count}`, kind: 'tremolo' });
				tick += dur;
				break;
			}
		}
	}

	for (const ev of events) walk(ev, 1);
	return bars;
}

// ─── source extraction ───────────────────────────────────────────────────────

function extractMeasureSources(src: string): string[] {
	// Split on the | %N measure-end markers
	const chunks = src.split(/[ \t]*\|[ \t]*%\d+[ \t]*/);
	const results: string[] = [];
	for (let i = 0; i < chunks.length - 1; i++) {
		let chunk = chunks[i].trim();
		if (i === 0) {
			// Strip leading metadata lines ([title ...] etc.)
			const lines = chunk.split('\n');
			const first = lines.findIndex(l => l.trim() !== '' && !l.trim().startsWith('['));
			chunk = first >= 0 ? lines.slice(first).join('\n').trim() : chunk;
		}
		results.push(chunk);
	}
	return results;
}

// ─── SVG rendering ───────────────────────────────────────────────────────────

// Palette: [rowBg, barFill, barStroke]
const PALETTE: [string, string, string][] = [
	['#fde8e8', '#e05555', '#b03030'],
	['#d7f5e3', '#2daa60', '#1a7a40'],
	['#dceeff', '#4488dd', '#2255aa'],
	['#fef5d6', '#d4960a', '#a06800'],
	['#f0e6ff', '#8844cc', '#5522aa'],
	['#d6f5f5', '#1aabab', '#0a7a7a'],
	['#fff0e0', '#cc7722', '#993300'],
	['#eaeaea', '#778899', '#445566'],
];

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function measureSvg(voices: { label: string; bars: Bar[] }[]): string {
	let measureTicks = 0;
	for (const v of voices) {
		for (const b of v.bars) {
			if (b.start + b.dur > measureTicks) measureTicks = b.start + b.dur;
		}
	}
	if (measureTicks === 0) measureTicks = TPQN * 4;

	const LABEL_W = 80;
	// Minimum bar width (px) to show pitch text legibly
	const MIN_BAR_PX = 22;
	const BASE_PLOT_W = 410;
	const MAX_PLOT_W  = 1640;
	// Find narrowest non-zero event duration to determine required plot width
	let minDur = Infinity;
	for (const v of voices)
		for (const b of v.bars)
			if (b.dur > 0) minDur = Math.min(minDur, b.dur);
	const PLOT_W = minDur === Infinity ? BASE_PLOT_W
		: Math.min(MAX_PLOT_W, Math.max(BASE_PLOT_W, Math.ceil(MIN_BAR_PX * measureTicks / minDur)));
	const SVG_W = LABEL_W + PLOT_W + 10;
	const ROW_H    = 26;
	const ROW_GAP  = 3;
	const M_TOP    = 22;
	const M_BOTTOM = 6;
	const nVoices  = voices.length;
	const SVG_H    = M_TOP + nVoices * (ROW_H + ROW_GAP) - ROW_GAP + M_BOTTOM + 1;

	function xOf(tick: number): number {
		return LABEL_W + (tick / measureTicks) * PLOT_W;
	}

	const lines: string[] = [];
	lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" style="font-family:monospace;font-size:11px">`);
	lines.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#f8f8f8" rx="4"/>`);

	// ── tick axis ──
	lines.push(`<line x1="${xOf(0)}" y1="${M_TOP}" x2="${xOf(measureTicks)}" y2="${M_TOP}" stroke="#aaa" stroke-width="0.5"/>`);
	for (let t = 0; t <= measureTicks; t += TPQN) {
		const x = xOf(t);
		lines.push(`<line x1="${x}" y1="${M_TOP - 4}" x2="${x}" y2="${M_TOP}" stroke="#888" stroke-width="0.8"/>`);
		lines.push(`<text x="${x}" y="${M_TOP - 6}" text-anchor="middle" fill="#666" font-size="10">${t}</text>`);
	}

	// ── voices ──
	for (let vi = 0; vi < nVoices; vi++) {
		const { label, bars } = voices[vi];
		const [rowBg, barFill, barStroke] = PALETTE[vi % PALETTE.length];
		const rowY = M_TOP + vi * (ROW_H + ROW_GAP);

		lines.push(`<rect x="${LABEL_W}" y="${rowY}" width="${PLOT_W}" height="${ROW_H}" fill="${rowBg}" rx="2"/>`);
		lines.push(`<text x="${LABEL_W - 4}" y="${rowY + ROW_H / 2 + 4}" text-anchor="end" fill="#333">${escapeXml(label)}</text>`);

		for (const bar of bars) {
			const bx = xOf(bar.start);

			if (bar.kind === 'grace') {
				const gy = rowY + ROW_H / 2;
				lines.push(`<polygon points="${bx},${gy - 5} ${bx + 5},${gy} ${bx},${gy + 5} ${bx - 5},${gy}" fill="${barFill}" opacity="0.7"/>`);
				continue;
			}

			if (bar.kind === 'staff-change') {
				// Dashed vertical line; arrow text to the LEFT so it doesn't overlap the following note
				lines.push(`<line x1="${bx}" y1="${rowY + 1}" x2="${bx}" y2="${rowY + ROW_H - 1}" stroke="#777" stroke-width="1.2" stroke-dasharray="3,2"/>`);
				lines.push(`<text x="${bx - 3}" y="${rowY + ROW_H / 2 + 5}" text-anchor="end" fill="#555" font-size="13" font-weight="bold">${bar.label}</text>`);
				continue;
			}

			const x1 = xOf(bar.start + bar.dur);
			const bw = Math.max(x1 - bx - 1, 1);
			const opacity = bar.kind === 'rest' ? '0.45' : bar.kind === 'tremolo' ? '0.75' : '0.85';
			const rx = bar.kind === 'rest' ? '0' : '3';

			lines.push(`<rect x="${bx}" y="${rowY + 1}" width="${bw}" height="${ROW_H - 2}" fill="${barFill}" stroke="${barStroke}" stroke-width="0.5" rx="${rx}" opacity="${opacity}"/>`);

			if (bw > 24) {
				const textX = bx + 4;
				const charLimit = Math.floor((bw - 8) / 7);
				const lbl = bar.label.length > charLimit
				          ? bar.label.slice(0, Math.max(charLimit - 1, 1)) + '…'
				          : bar.label;
				lines.push(`<text x="${textX}" y="${rowY + ROW_H / 2 + 4}" fill="#fff" font-weight="bold" font-size="10.5" style="text-shadow:0 0 2px #0004">${escapeXml(lbl)}</text>`);
			}
		}
	}

	lines.push(`<line x1="${LABEL_W}" y1="${SVG_H - M_BOTTOM}" x2="${LABEL_W + PLOT_W}" y2="${SVG_H - M_BOTTOM}" stroke="#ccc" stroke-width="0.5"/>`);
	lines.push('</svg>');
	return lines.join('\n');
}

// ─── per-file logic ───────────────────────────────────────────────────────────

function processFile(inputPath: string, outputPath: string): void {
	const src = fs.readFileSync(inputPath, 'utf-8');
	const doc = parseCode(src);
	const measureSources = extractMeasureSources(src);

	const mdLines: string[] = [];
	mdLines.push(`# Timeline: ${path.basename(inputPath)}\n`);

	for (let mi = 0; mi < doc.measures.length; mi++) {
		const measure = doc.measures[mi];

		let timeLbl = '';
		if (measure.timeSig) {
			const { numerator, denominator } = measure.timeSig;
			timeLbl = ` — ${numerator}/${denominator}`;
		}

		const voiceEntries: { label: string; bars: Bar[] }[] = [];
		for (let pi = 0; pi < measure.parts.length; pi++) {
			const part = measure.parts[pi];
			for (let vi = 0; vi < part.voices.length; vi++) {
				const voice = part.voices[vi];
				const label = `P${pi + 1} V${vi + 1} S${voice.staff}`;
				const bars = flattenEvents(voice.events, voice.staff);
				voiceEntries.push({ label, bars });
			}
		}

		const hasMusic = voiceEntries.some(v => v.bars.some(b => b.kind !== 'staff-change'));
		if (voiceEntries.length === 0 || !hasMusic) continue;

		// Duration consistency check
		const measureCapacity = measure.timeSig
			? Math.round(TPQN * 4 * measure.timeSig.numerator / measure.timeSig.denominator)
			: TPQN * 4;
		const warnings: string[] = [];
		for (const { label, bars } of voiceEntries) {
			const voiceDur = bars
				.filter(b => b.kind !== 'staff-change' && b.kind !== 'grace')
				.reduce((sum, b) => sum + b.dur, 0);
			if (voiceDur > measureCapacity) {
				warnings.push(`⚠️ **${label}**: duration ${voiceDur} ticks > capacity ${measureCapacity} ticks (${measure.timeSig ? `${measure.timeSig.numerator}/${measure.timeSig.denominator}` : '4/4'})`);
			}
		}

		const warnStr = warnings.length > 0 ? ' ⚠️' : '';
		mdLines.push(`## Measure ${mi + 1}${timeLbl}${warnStr}\n`);

		if (warnings.length > 0) {
			for (const w of warnings) mdLines.push(w);
			mdLines.push('');
		}

		const msrc = measureSources[mi] ?? '';
		if (msrc) {
			mdLines.push('```lyl');
			mdLines.push(msrc);
			mdLines.push('```\n');
		}

		// Tick JSON: start tick of each in-voice event per voice
		const tickJson: Record<string, number[]> = {};
		for (const { label, bars } of voiceEntries) {
			tickJson[label] = bars
				.filter(b => b.kind !== 'staff-change')
				.map(b => b.start);
		}
		const tickLines = Object.entries(tickJson)
			.map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
			.join(',\n');
		mdLines.push('```json');
		mdLines.push(`{\n${tickLines}\n}`);
		mdLines.push('```\n');

		mdLines.push(measureSvg(voiceEntries));
		mdLines.push('');
	}

	const rendered = mdLines.filter(l => l.startsWith('## Measure')).length;
	fs.writeFileSync(outputPath, mdLines.join('\n'), 'utf-8');
	console.log(`Written: ${outputPath}  (${rendered} measures)`);
}

function resolveOutputPath(inputPath: string, outputArg: string | undefined): string {
	if (!outputArg) return inputPath.replace(/\.lyl$/, '') + '-timeline.md';
	const resolved = path.resolve(outputArg);
	const isDir = (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())
	           || outputArg.endsWith('/') || outputArg.endsWith(path.sep);
	return isDir
		? path.join(resolved, path.basename(inputPath, '.lyl') + '-timeline.md')
		: resolved;
}

// ─── main ─────────────────────────────────────────────────────────────────────

const [,, inputArg, outputArg] = process.argv;
if (!inputArg) {
	console.error('Usage: npx tsx tools/visualizeTimeline.ts <input.lyl|input-dir/> [output.md|output-dir/]');
	process.exit(1);
}

const inputResolved = path.resolve(inputArg);
const inputIsDir = fs.existsSync(inputResolved) && fs.statSync(inputResolved).isDirectory();

if (inputIsDir) {
	// Batch mode: process all .lyl files in the directory
	const outputDir = outputArg ? path.resolve(outputArg) : inputResolved;
	fs.mkdirSync(outputDir, { recursive: true });
	const files = fs.readdirSync(inputResolved)
		.filter(f => f.endsWith('.lyl'))
		.sort();
	console.log(`Batch: ${files.length} files → ${outputDir}`);
	for (const f of files) {
		const fp = path.join(inputResolved, f);
		const op = path.join(outputDir, f.replace(/\.lyl$/, '') + '-timeline.md');
		try {
			processFile(fp, op);
		} catch (err) {
			console.error(`  ERROR ${f}: ${(err as Error).message}`);
		}
	}
} else {
	processFile(inputResolved, resolveOutputPath(inputResolved, outputArg));
}
