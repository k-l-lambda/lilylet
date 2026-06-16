import fs from "fs";
import path from "path";
import { abcDecoder, parseCode, parseStaffLayout, serializeStaffLayout } from "../source/lilylet/index";
import { serializeLilyletDoc } from "../source/lilylet/serializer";
import type { Event, InstrumentName, LilyletDoc, Metadata, RestEvent, TimeSig, Voice } from "../source/lilylet/types";


interface CliOptions {
	inputDir: string;
	outputDir: string;
	excludeSpaceVoices: boolean;
	stylesInComments: boolean;
	forceFullMeasureRest: boolean;
	anonymousStaves: boolean;
	skipExisting: boolean;
}

interface ConversionError {
	file: string;
	error: string;
}

const usage = () => `Usage:
  npx tsx tools/abc2lilylet.ts <input-dir> <output-dir> [--keep-space-voices]
  npx tsx tools/abc2lilylet.ts --input <input-dir> --output <output-dir> [--keep-space-voices]

Options:
  --input, -i              Input directory containing .abc files
  --output, -o             Output directory for generated .lyl files
  --keep-space-voices      Keep voices that contain only invisible rests/spaces
  --include-space-voices   Alias for --keep-space-voices
  --styles-in-comments     Preserve NotaGen catalog tags (non-standard ABC) as raw
                           leading %period/%composer/%instrumentation comment lines
                           at the top of the .lyl, with a filename fallback. Does NOT
                           emit [genre]/[composer]/[instrument] meta fields.
                           Off by default — only standard ABC info fields (C:, T:, ...) are kept.
  --force-fullmeasure-rest A voice whose only time-consuming event is a single rest
                           filling the whole measure is written as R (e.g. r2. -> R2.),
                           even if the ABC used lowercase z. Off by default — only the
                           ABC's own uppercase Z multi-measure rests become R.
  --anonymous-staves       Strip staff-id names from the [staves] layout (e.g.
                           "<1-3-5-7>" -> "<--->"), so the parser auto-names slots
                           1,2,3,… by position. Instrument keys ([instrument-<key>])
                           are remapped to the matching anonymous ordinal(s). Off by
                           default — original staff ids are kept.
  --skip-existing          Skip files whose output .lyl already exists (resume a run)
  --help, -h               Show this help
`;

const parseArgs = (argv: string[]): CliOptions => {
	let inputDir = "";
	let outputDir = "";
	let excludeSpaceVoices = true;
	let stylesInComments = false;
	let forceFullMeasureRest = false;
	let anonymousStaves = false;
	let skipExisting = false;
	const positional: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			console.log(usage());
			process.exit(0);
		} else if (arg === "--input" || arg === "-i") {
			inputDir = argv[++i] || "";
		} else if (arg.startsWith("--input=")) {
			inputDir = arg.slice("--input=".length);
		} else if (arg === "--output" || arg === "-o") {
			outputDir = argv[++i] || "";
		} else if (arg.startsWith("--output=")) {
			outputDir = arg.slice("--output=".length);
		} else if (arg === "--keep-space-voices" || arg === "--include-space-voices") {
			excludeSpaceVoices = false;
		} else if (arg === "--exclude-space-voices") {
			excludeSpaceVoices = true;
		} else if (arg === "--styles-in-comments") {
			stylesInComments = true;
		} else if (arg === "--force-fullmeasure-rest") {
			forceFullMeasureRest = true;
		} else if (arg === "--anonymous-staves") {
			anonymousStaves = true;
		} else if (arg === "--skip-existing") {
			skipExisting = true;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		} else {
			positional.push(arg);
		}
	}

	if (!inputDir && positional.length > 0) inputDir = positional[0];
	if (!outputDir && positional.length > 1) outputDir = positional[1];

	if (!inputDir || !outputDir) {
		throw new Error("Input and output directories are required.\n\n" + usage());
	}

	return {
		inputDir: path.resolve(inputDir),
		outputDir: path.resolve(outputDir),
		excludeSpaceVoices,
		stylesInComments,
		forceFullMeasureRest,
		anonymousStaves,
		skipExisting,
	};
};

const findAbcFiles = (dir: string): string[] => {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findAbcFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith(".abc")) {
			results.push(fullPath);
		}
	}
	return results.sort();
};

// NotaGen catalog enums (period_composer_instrumentation), used as a filename
// fallback when the ABC content lacks the leading %-comment tags.
const PERIOD_SET = new Set(["Baroque", "Classical", "Romantic"]);
const INSTRUMENTATION_SET = new Set(["Art Song", "Chamber", "Choral", "Keyboard", "Orchestral", "Vocal-Orchestral"]);
const COMPOSER_SET = new Set([
	"Bach, Johann Sebastian", "Bartok, Bela", "Beethoven, Ludwig van", "Berlioz, Hector",
	"Bizet, Georges", "Boulanger, Lili", "Boulton, Harold", "Brahms, Johannes",
	"Burgmuller, Friedrich", "Butterworth, George", "Chaminade, Cecile", "Chausson, Ernest",
	"Chopin, Frederic", "Corelli, Arcangelo", "Cornelius, Peter", "Debussy, Claude",
	"Dvorak, Antonin", "Faisst, Clara", "Faure, Gabriel", "Franz, Robert",
	"Gonzaga, Chiquinha", "Grandval, Clemence de", "Grieg, Edvard", "Handel, George Frideric",
	"Haydn, Joseph", "Hensel, Fanny", "Holmes, Augusta Mary Anne", "Jaell, Marie",
	"Kinkel, Johanna", "Kralik, Mathilde", "Lang, Josephine", "Lehmann, Liza",
	"Liszt, Franz", "Mayer, Emilie", "Medtner, Nikolay", "Mendelssohn, Felix",
	"Mozart, Wolfgang Amadeus", "Munktell, Helena", "Paradis, Maria Theresia von",
	"Parratt, Walter", "Prokofiev, Sergey", "Rachmaninoff, Sergei", "Ravel, Maurice",
	"Reichardt, Louise", "Saint-Georges, Joseph Bologne", "Saint-Saens, Camille",
	"Satie, Erik", "Scarlatti, Domenico", "Schroter, Corona", "Schubert, Franz",
	"Schumann, Clara", "Schumann, Robert", "Scriabin, Aleksandr", "Shostakovich, Dmitry",
	"Sibelius, Jean", "Smetana, Bedrich", "Tchaikovsky, Pyotr", "Viardot, Pauline",
	"Vivaldi, Antonio", "Warlock, Peter", "Wolf, Hugo", "Zumsteeg, Emilie",
]);

// Build the raw NotaGen catalog comment lines (`%<period>` / `%<composer>` /
// `%<instrumentation>`) to preserve verbatim at the top of the .lyl. Values are
// taken from the ABC's own leading single-% comments where present; any field
// missing from the content is filled from the underscore-separated filename
// (the NotaGen `period_composer_instrumentation` naming). Returns the lines in
// canonical period/composer/instrument order; empty if nothing is found.
const catalogCommentLines = (abcContent: string, filePath: string): string[] => {
	let genre: string | undefined;
	let composer: string | undefined;
	let instrument: string | undefined;

	// from the ABC content: leading single-% comments (skip `%%` directives)
	for (const rawLine of abcContent.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line.startsWith("%") || line.startsWith("%%")) continue;
		const value = line.slice(1).trim();
		if (!genre && PERIOD_SET.has(value)) genre = value;
		else if (!instrument && INSTRUMENTATION_SET.has(value)) instrument = value;
		else if (!composer && COMPOSER_SET.has(value)) composer = value;
	}

	// filename fallback (period_composer_instrumentation) for any missing field
	for (const token of path.parse(filePath).name.split("_")) {
		const value = token.trim();
		if (!genre && PERIOD_SET.has(value)) genre = value;
		else if (!instrument && INSTRUMENTATION_SET.has(value)) instrument = value;
		else if (!composer && COMPOSER_SET.has(value)) composer = value;
	}

	const lines: string[] = [];
	if (genre) lines.push(`%${genre}`);
	if (composer) lines.push(`%${composer}`);
	if (instrument) lines.push(`%${instrument}`);
	return lines;
};

const eventHasSoundingContent = (event: Event): boolean => {
	if (event.type === "rest") return !event.invisible;
	if (event.type === "context" || event.type === "pitchReset" || event.type === "barline") return false;
	if (event.type === "tuplet" || event.type === "times") return event.events.some(eventHasSoundingContent);
	return true;
};

const isPureSpaceVoice = (voice: Voice): boolean => {
	return voice.events.length > 0 && !voice.events.some(eventHasSoundingContent);
};

// Duration {division, dots} as a fraction of a whole note (numerator over a
// power-of-two denominator). E.g. quarter = 1/4, dotted half = 3/4.
const durationFraction = (division: number, dots: number): { num: number; den: number } => {
	// undotted = 1/division; each dot adds half of the previous value:
	// total = (1/division) * (2 - 2^-dots) = (2^(dots+1) - 1) / (division * 2^dots)
	const num = (1 << (dots + 1)) - 1;
	const den = division * (1 << dots);
	return { num, den };
};

// A measure-filling single rest: the voice's only TIME-CONSUMING event is one
// rest whose duration equals the measure's time signature. Convert such rests to
// full-measure rests (serialized as `R` instead of e.g. `r2.`). Zero-duration
// annotations (context/barline/pitchReset/markup/dynamic/harmony) do NOT block
// the conversion — only other sounding notes/tuplets do; the markup stays
// attached to the rest and serializes onto the `R`.
const markFullMeasureRests = (doc: LilyletDoc): void => {
	let timeSig: TimeSig | undefined;
	for (const measure of doc.measures) {
		if (measure.timeSig) timeSig = measure.timeSig;
		if (!timeSig || measure.partial) continue;
		const tsNum = timeSig.numerator;
		const tsDen = timeSig.denominator;
		for (const part of measure.parts) {
			for (const voice of part.voices) {
				const rests = voice.events.filter(e => e.type === "rest") as RestEvent[];
				// other TIME-CONSUMING events (notes/tuplets/times/tremolo) block it;
				// markup/dynamic/context/barline carry no duration and are allowed.
				const otherSounding = voice.events.filter(
					e => e.type === "note" || e.type === "tuplet" || e.type === "times" || e.type === "tremolo");
				if (rests.length !== 1 || otherSounding.length > 0) continue;
				const rest = rests[0];
				if (rest.invisible || rest.fullMeasure || rest.pitch) continue;
				const { num, den } = durationFraction(rest.duration.division, rest.duration.dots);
				// rest fills the bar iff num/den === tsNum/tsDen
				if (num * tsDen === tsNum * den) rest.fullMeasure = true;
			}
		}
	}
};

const removePureSpaceVoices = (doc: LilyletDoc): void => {
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			const kept = part.voices.filter(voice => !isPureSpaceVoice(voice));
			if (kept.length > 0) part.voices = kept;
		}
	}
};

// Rewrite the [staves] layout into anonymous form: drop every staff-id name token
// (e.g. "<[v1-v2].va> {pl-pr} <b>" -> "<[-].> {-} <>", "<1-3-5-7>" -> "<--->"), keeping
// all bounds/conjunctions so the parser auto-names the now-empty slots "1","2","3",… by
// position. We reconstruct the string from the PARSED layout via serializeStaffLayout
// (not a regex strip — that would silently drop a BARE top-level staff like the `12` in
// "<9-11> 12 <…>", whose emptied token gets swallowed by whitespace). The
// [instrument-<key>] keys, which reference the original staff ids (a single id, or a
// "head-tail" group range), are remapped to the matching anonymous ordinal(s) so each
// instrument name still lands on the right staff.
const anonymizeStaves = (metadata: Metadata | undefined): void => {
	if (!metadata || !metadata.staves) return;

	// original (deduplicated) staff id -> 1-based anonymous ordinal, in layout order.
	const layout = parseStaffLayout(metadata.staves);
	const ordinal = new Map<string, string>();
	layout.staffIds.forEach((id, index) => ordinal.set(id, String(index + 1)));

	// reconstruct the layout with empty ids (structure-preserving; keeps every slot).
	metadata.staves = serializeStaffLayout(layout, { anonymous: true });

	// remap instrument keys (single id, or "head-tail" range) to anonymous ordinals.
	if (metadata.instruments) {
		const remapped: { [key: string]: InstrumentName } = {};
		for (const [key, instr] of Object.entries(metadata.instruments)) {
			const mappedKey = key.split("-").map(id => ordinal.get(id) ?? id).join("-");
			remapped[mappedKey] = instr;
		}
		metadata.instruments = remapped;
	}
};

const outputPathFor = (inputFile: string, inputDir: string, outputDir: string): string => {
	const relative = path.relative(inputDir, inputFile);
	const parsed = path.parse(relative);
	return path.join(outputDir, parsed.dir, `${parsed.name}.lyl`);
};

const countNotes = (doc: LilyletDoc): number => {
	let count = 0;
	const walk = (events: Event[]) => {
		for (const event of events) {
			if (event.type === "note") count++;
			else if (event.type === "tuplet" || event.type === "times") walk(event.events);
			else if (event.type === "tremolo") count += 2;
		}
	};
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			for (const voice of part.voices) walk(voice.events);
		}
	}
	return count;
};

const main = () => {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (!fs.existsSync(options.inputDir) || !fs.statSync(options.inputDir).isDirectory()) {
			throw new Error(`Input directory does not exist: ${options.inputDir}`);
		}

		const files = findAbcFiles(options.inputDir);
		fs.mkdirSync(options.outputDir, { recursive: true });

		let written = 0;
		let skipped = 0;
		const errors: ConversionError[] = [];

		for (const file of files) {
			const outputFile = outputPathFor(file, options.inputDir, options.outputDir);
			if (options.skipExisting && fs.existsSync(outputFile)) {
				skipped++;
				continue;
			}
			try {
				const content = fs.readFileSync(file, "utf-8");
				const doc = abcDecoder.decode(content);
				if (!doc.measures || doc.measures.length === 0) throw new Error("No measures produced");

				if (options.excludeSpaceVoices) removePureSpaceVoices(doc);
				if (options.forceFullMeasureRest) markFullMeasureRests(doc);
				if (options.anonymousStaves) anonymizeStaves(doc.metadata);

				let lylContent = serializeLilyletDoc(doc);
				if (options.stylesInComments) {
					// preserve the NotaGen catalog tags as raw leading %-comment lines
					// (instead of [genre]/[composer]/[instrument] meta fields)
					const commentLines = catalogCommentLines(content, file);
					if (commentLines.length > 0) lylContent = commentLines.join("\n") + "\n" + lylContent;
				}
				const reparsed = parseCode(lylContent);

				fs.mkdirSync(path.dirname(outputFile), { recursive: true });
				fs.writeFileSync(outputFile, lylContent, "utf-8");

				const relativeInput = path.relative(options.inputDir, file);
				const relativeOutput = path.relative(options.outputDir, outputFile);
				console.log(`✓ ${relativeInput} -> ${relativeOutput} (${reparsed.measures.length} measures, ${countNotes(doc)} notes)`);
				written++;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				errors.push({ file: path.relative(options.inputDir, file), error: message });
				console.log(`✗ ${path.relative(options.inputDir, file)}: ${message.substring(0, 200)}`);
			}
		}

		console.log(`\nTotal: ${files.length}, Written: ${written}, Skipped: ${skipped}, Failed: ${errors.length}`);
		console.log(`Output: ${options.outputDir}`);
		console.log(`Pure-space voices: ${options.excludeSpaceVoices ? "excluded" : "kept"}`);
		console.log(`Force full-measure rest: ${options.forceFullMeasureRest ? "on" : "off"}`);
		console.log(`Anonymous staves: ${options.anonymousStaves ? "on" : "off"}`);

		if (errors.length > 0) {
			console.log("\nFailed files:");
			for (const error of errors) console.log(`  - ${error.file}: ${error.error}`);
			process.exit(1);
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
};


main();
