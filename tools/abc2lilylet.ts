import fs from "fs";
import path from "path";
import { abcDecoder, parseCode } from "../source/lilylet/index";
import { serializeLilyletDoc } from "../source/lilylet/serializer";
import type { Event, LilyletDoc, Voice } from "../source/lilylet/types";


interface CliOptions {
	inputDir: string;
	outputDir: string;
	excludeSpaceVoices: boolean;
	transcribeMeta: boolean;
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
  --meta                   Extract NotaGen catalog metadata (non-standard ABC):
                           leading %period/%composer/%instrumentation comments,
                           with a filename fallback, into [genre]/[composer]/[instrument].
                           Off by default — only standard ABC info fields (C:, T:, ...) are kept.
  --skip-existing          Skip files whose output .lyl already exists (resume a run)
  --help, -h               Show this help
`;

const parseArgs = (argv: string[]): CliOptions => {
	let inputDir = "";
	let outputDir = "";
	let excludeSpaceVoices = true;
	let transcribeMeta = false;
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
		} else if (arg === "--meta") {
			transcribeMeta = true;
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
		transcribeMeta,
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

const fillCatalogMetaFromFilename = (doc: LilyletDoc, filePath: string): void => {
	const base = path.parse(filePath).name;
	const tokens = base.split("_");
	for (const token of tokens) {
		const value = token.trim();
		if (PERIOD_SET.has(value)) doc.metadata = { ...doc.metadata, genre: doc.metadata?.genre ?? value };
		else if (INSTRUMENTATION_SET.has(value)) doc.metadata = { ...doc.metadata, instrument: doc.metadata?.instrument ?? value };
		else if (COMPOSER_SET.has(value)) doc.metadata = { ...doc.metadata, composer: doc.metadata?.composer ?? value };
	}
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

const removePureSpaceVoices = (doc: LilyletDoc): void => {
	for (const measure of doc.measures) {
		for (const part of measure.parts) {
			const kept = part.voices.filter(voice => !isPureSpaceVoice(voice));
			if (kept.length > 0) part.voices = kept;
		}
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
				const doc = abcDecoder.decode(content, { catalogComments: options.transcribeMeta });
				if (!doc.measures || doc.measures.length === 0) throw new Error("No measures produced");

				if (options.excludeSpaceVoices) removePureSpaceVoices(doc);
				if (options.transcribeMeta) fillCatalogMetaFromFilename(doc, file);

				const lylContent = serializeLilyletDoc(doc);
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
