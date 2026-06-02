import fs from "fs";
import path from "path";


type TokenKind = "byte" | "protected" | "merge";

interface CliOptions {
	corpusDir: string;
	serializerPath: string;
	outputDir: string;
	vocabSize: number;
	minFrequency: number;
	maxFiles: number;
	dryRun: boolean;
}

interface TokenInfo {
	id: number;
	type: TokenKind;
	text: string;
	protected: boolean;
	value?: number;
	left?: number;
	right?: number;
}

interface MergeInfo {
	rank: number;
	left: number;
	right: number;
	id: number;
	frequency: number;
}

interface TrainOptions {
	vocabSize: number;
	minFrequency: number;
	protectedTokens: string[];
}

interface TokenFrequency {
	id: number;
	token: string;
	type: TokenKind;
	frequency: number;
}

interface TrainResult {
	vocab: TokenInfo[];
	merges: MergeInfo[];
	protectedTokens: string[];
	initialTokens: number;
	finalTokens: number;
	tokenFrequencies: TokenFrequency[];
}

interface TokenizerModel {
	vocab: TokenInfo[];
	merges: MergeInfo[];
	protectedTokens: string[];
}

const BYTE_TOKEN_COUNT = 256;
const DEFAULT_CORPUS_DIR = "tests/output/notagenx-from-abc";
const DEFAULT_SERIALIZER_PATH = "source/lilylet/serializer.ts";
const DEFAULT_OUTPUT_DIR = "tests/output/bpe-tokenizer";
const DEFAULT_VOCAB_SIZE = 240;
const DEFAULT_MIN_FREQUENCY = 2;
const EXTRA_PROTECTED_TOKENS = ["\n", " ", "(", ")", "<", ">", "'", ",", "/", "%"];

const usage = () => `Usage:
  npx tsx tools/trainBpeTokenizer.ts [options]

Options:
  --corpus, -c <dir>          Corpus directory containing .lyl files
                              Default: ${DEFAULT_CORPUS_DIR}
  --serializer <file>         Serializer source used to extract protected tokens
                              Default: ${DEFAULT_SERIALIZER_PATH}
  --output, -o <dir>          Output directory
                              Default: ${DEFAULT_OUTPUT_DIR}
  --vocab-size <n>            Target vocabulary size including byte and protected tokens
                              Default: ${DEFAULT_VOCAB_SIZE}
  --min-frequency <n>         Minimum adjacent-pair frequency to merge
                              Default: ${DEFAULT_MIN_FREQUENCY}
  --max-files <n>             Limit corpus files, 0 means all
                              Default: 0
  --dry-run                   Train and print summary without writing output
  --help, -h                  Show this help
`;

const parsePositiveInteger = (value: string, name: string, allowZero = false): number => {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
		throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer: ${value}`);
	}
	return parsed;
};

const parseArgs = (argv: string[]): CliOptions => {
	let corpusDir = DEFAULT_CORPUS_DIR;
	let serializerPath = DEFAULT_SERIALIZER_PATH;
	let outputDir = DEFAULT_OUTPUT_DIR;
	let vocabSize = DEFAULT_VOCAB_SIZE;
	let minFrequency = DEFAULT_MIN_FREQUENCY;
	let maxFiles = 0;
	let dryRun = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			console.log(usage());
			process.exit(0);
		} else if (arg === "--corpus" || arg === "-c") {
			corpusDir = argv[++i] || "";
		} else if (arg.startsWith("--corpus=")) {
			corpusDir = arg.slice("--corpus=".length);
		} else if (arg === "--serializer") {
			serializerPath = argv[++i] || "";
		} else if (arg.startsWith("--serializer=")) {
			serializerPath = arg.slice("--serializer=".length);
		} else if (arg === "--output" || arg === "-o") {
			outputDir = argv[++i] || "";
		} else if (arg.startsWith("--output=")) {
			outputDir = arg.slice("--output=".length);
		} else if (arg === "--vocab-size") {
			vocabSize = parsePositiveInteger(argv[++i] || "", "--vocab-size");
		} else if (arg.startsWith("--vocab-size=")) {
			vocabSize = parsePositiveInteger(arg.slice("--vocab-size=".length), "--vocab-size");
		} else if (arg === "--min-frequency") {
			minFrequency = parsePositiveInteger(argv[++i] || "", "--min-frequency");
		} else if (arg.startsWith("--min-frequency=")) {
			minFrequency = parsePositiveInteger(arg.slice("--min-frequency=".length), "--min-frequency");
		} else if (arg === "--max-files") {
			maxFiles = parsePositiveInteger(argv[++i] || "", "--max-files", true);
		} else if (arg.startsWith("--max-files=")) {
			maxFiles = parsePositiveInteger(arg.slice("--max-files=".length), "--max-files", true);
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else {
			throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
		}
	}

	if (!corpusDir) throw new Error("Corpus directory is required");
	if (!serializerPath) throw new Error("Serializer path is required");
	if (!outputDir) throw new Error("Output directory is required");

	return {
		corpusDir: path.resolve(corpusDir),
		serializerPath: path.resolve(serializerPath),
		outputDir: path.resolve(outputDir),
		vocabSize,
		minFrequency,
		maxFiles,
		dryRun,
	};
};

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

export const extractStringLiterals = (source: string): string[] => {
	const literals: string[] = [];
	let i = 0;

	while (i < source.length) {
		const char = source[i];

		if (char === "/" && source[i + 1] === "/") {
			const newline = source.indexOf("\n", i + 2);
			i = newline === -1 ? source.length : newline + 1;
			continue;
		}

		if (char === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			i = end === -1 ? source.length : end + 2;
			continue;
		}

		if (char !== "'" && char !== '"') {
			i++;
			continue;
		}

		const quote = char;
		let value = "";
		i++;

		while (i < source.length) {
			const current = source[i];
			if (current === "\\") {
				const next = source[i + 1];
				if (next === undefined) {
					value += current;
					i++;
					continue;
				}
				switch (next) {
					case "n": value += "\n"; break;
					case "r": value += "\r"; break;
					case "t": value += "\t"; break;
					case "b": value += "\b"; break;
					case "f": value += "\f"; break;
					case "v": value += "\v"; break;
					case "0": value += "\0"; break;
					default: value += next; break;
				}
				i += 2;
				continue;
			}
			if (current === quote) {
				i++;
				break;
			}
			value += current;
			i++;
		}

		literals.push(value);
	}

	return literals;
};

const addCandidate = (candidates: Set<string>, token: string) => {
	if (byteLength(token) > 1 || EXTRA_PROTECTED_TOKENS.includes(token)) {
		candidates.add(token);
	}
};

const addMapCandidate = (candidates: Set<string>, token: string) => {
	if (token.length > 0) candidates.add(token);
};

export const extractProtectedTokensFromSource = (source: string): string[] => {
	const literals = extractStringLiterals(source);
	const candidates = new Set<string>();
	const beforeSerializerMapsEnd = source.slice(0, source.indexOf("// Serialize a pitch to Lilylet notation"));
	const mapValueMatches = beforeSerializerMapsEnd.matchAll(/\b[A-Z_]+_MAP\s*:[\s\S]*?=\s*\{([\s\S]*?)\};/g);
	for (const mapMatch of mapValueMatches) {
		for (const valueMatch of mapMatch[1].matchAll(/:\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
			const decoded = extractStringLiterals(`const __x = ${valueMatch[1]}${valueMatch[2]}${valueMatch[1]};`)[0];
			addMapCandidate(candidates, decoded);
		}
	}

	for (const literal of literals) {
		if (!literal) continue;

		if (/^\\(?:[A-Za-z][A-Za-z]*|[<>!])$/.test(literal)) {
			addCandidate(candidates, literal);
		}

		if (/^[A-Za-z][A-Za-z-]*$/.test(literal)) {
			addCandidate(candidates, literal);
		}

		if (/^[sf]{2,}$/.test(literal) || literal === "_.") {
			addCandidate(candidates, literal);
		}

		for (const match of literal.matchAll(/\\(?:[A-Za-z][A-Za-z]*|[<>!])/g)) {
			addCandidate(candidates, match[0]);
		}

		for (const match of literal.matchAll(/\[([A-Za-z][A-Za-z-]*)\s+"/g)) {
			addCandidate(candidates, match[1]);
		}
	}

	const manualSerializerDerived = [
		"major", "minor", "title", "subtitle", "composer", "arranger", "lyricist", "auto-beam",
		...EXTRA_PROTECTED_TOKENS,
	];
	for (const token of manualSerializerDerived) {
		if (source.includes(token)) addCandidate(candidates, token);
	}

	return Array.from(candidates).sort((a, b) => b.length - a.length || a.localeCompare(b));
};

export const extractProtectedTokensFromSerializer = (serializerPath: string): string[] => {
	const source = fs.readFileSync(serializerPath, "utf8");
	return extractProtectedTokensFromSource(source);
};

const findLylFiles = (dir: string): string[] => {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findLylFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith(".lyl")) {
			results.push(fullPath);
		}
	}
	return results.sort();
};

const makeByteToken = (id: number): TokenInfo => ({
	id,
	type: "byte",
	text: Buffer.from([id]).toString("latin1"),
	protected: false,
	value: id,
});

const makeTokenMaps = (vocab: TokenInfo[]) => {
	const byId = new Map<number, TokenInfo>();
	for (const token of vocab) byId.set(token.id, token);
	return byId;
};

const bytesForCodePoint = (codePoint: string): number[] => Array.from(Buffer.from(codePoint, "utf8"));

export const preTokenize = (text: string, protectedTokens: string[], protectedTokenIds: Map<string, number>): number[] => {
	const tokens: number[] = [];
	const sortedProtectedTokens = [...protectedTokens].sort((a, b) => b.length - a.length || a.localeCompare(b));
	let i = 0;

	while (i < text.length) {
		let matched = "";
		for (const token of sortedProtectedTokens) {
			if (text.startsWith(token, i)) {
				matched = token;
				break;
			}
		}

		if (matched) {
			tokens.push(protectedTokenIds.get(matched)!);
			i += matched.length;
			continue;
		}

		const codePoint = text.codePointAt(i)!;
		const char = String.fromCodePoint(codePoint);
		tokens.push(...bytesForCodePoint(char));
		i += char.length;
	}

	return tokens;
};

const pairKey = (left: number, right: number) => `${left},${right}`;

const countPairs = (sequences: number[][], protectedIds: Set<number>): Map<string, number> => {
	const counts = new Map<string, number>();
	for (const sequence of sequences) {
		for (let i = 0; i < sequence.length - 1; i++) {
			const left = sequence[i];
			const right = sequence[i + 1];
			if (protectedIds.has(left) || protectedIds.has(right)) continue;
			const key = pairKey(left, right);
			counts.set(key, (counts.get(key) || 0) + 1);
		}
	}
	return counts;
};

const chooseBestPair = (counts: Map<string, number>, minFrequency: number, vocabById: Map<number, TokenInfo>): { left: number; right: number; frequency: number } | null => {
	let best: { left: number; right: number; frequency: number; text: string } | null = null;

	for (const [key, frequency] of counts) {
		if (frequency < minFrequency) continue;
		const [left, right] = key.split(",").map(Number);
		const text = (vocabById.get(left)?.text || "") + (vocabById.get(right)?.text || "");
		if (!best || frequency > best.frequency ||
			(frequency === best.frequency && (text.length > best.text.length ||
				(text.length === best.text.length && (text < best.text ||
					(text === best.text && (left < best.left || (left === best.left && right < best.right)))))))) {
			best = { left, right, frequency, text };
		}
	}

	return best ? { left: best.left, right: best.right, frequency: best.frequency } : null;
};

const countTokenFrequencies = (sequences: number[][], vocabById: Map<number, TokenInfo>): TokenFrequency[] => {
	const counts = new Map<number, number>();
	for (const sequence of sequences) {
		for (const id of sequence) counts.set(id, (counts.get(id) || 0) + 1);
	}
	return Array.from(counts.entries()).map(([id, frequency]) => {
		const token = vocabById.get(id);
		if (!token) throw new Error(`Missing token for frequency id: ${id}`);
		return { id, token: token.text, type: token.type, frequency };
	}).sort((a, b) => b.frequency - a.frequency || a.id - b.id);
};

const replacePair = (sequence: number[], left: number, right: number, replacement: number): number[] => {
	const result: number[] = [];
	let i = 0;
	while (i < sequence.length) {
		if (i < sequence.length - 1 && sequence[i] === left && sequence[i + 1] === right) {
			result.push(replacement);
			i += 2;
		} else {
			result.push(sequence[i]);
			i++;
		}
	}
	return result;
};

export const trainBpe = (texts: string[], options: TrainOptions): TrainResult => {
	const protectedTokens = [...new Set(options.protectedTokens)].sort((a, b) => b.length - a.length || a.localeCompare(b));
	const protectedTokenIds = new Map<string, number>();
	for (const [index, token] of protectedTokens.entries()) {
		protectedTokenIds.set(token, BYTE_TOKEN_COUNT + index);
	}

	let sequences = texts.map(text => preTokenize(text, protectedTokens, protectedTokenIds));
	const observedBytes = new Set<number>();
	for (const sequence of sequences) {
		for (const id of sequence) {
			if (id >= 0 && id < BYTE_TOKEN_COUNT) observedBytes.add(id);
		}
	}

	const vocab: TokenInfo[] = [];
	for (const byte of Array.from(observedBytes).sort((a, b) => a - b)) vocab.push(makeByteToken(byte));
	for (const token of protectedTokens) {
		vocab.push({ id: protectedTokenIds.get(token)!, type: "protected", text: token, protected: true });
	}

	const minimumVocabSize = vocab.length;
	if (options.vocabSize < minimumVocabSize) {
		throw new Error(`vocab-size ${options.vocabSize} is too small: need at least ${observedBytes.size} observed byte tokens + ${protectedTokens.length} protected tokens = ${minimumVocabSize}`);
	}

	const protectedIds = new Set(protectedTokenIds.values());
	const initialTokens = sequences.reduce((sum, sequence) => sum + sequence.length, 0);
	const merges: MergeInfo[] = [];
	const vocabById = makeTokenMaps(vocab);
	let nextId = Math.max(...vocab.map(token => token.id)) + 1;

	while (vocab.length < options.vocabSize) {
		const counts = countPairs(sequences, protectedIds);
		const best = chooseBestPair(counts, options.minFrequency, vocabById);
		if (!best) break;

		const id = nextId++;
		const leftToken = vocabById.get(best.left);
		const rightToken = vocabById.get(best.right);
		if (!leftToken || !rightToken) throw new Error(`Missing token for merge ${best.left},${best.right}`);

		const token: TokenInfo = {
			id,
			type: "merge",
			text: leftToken.text + rightToken.text,
			protected: false,
			left: best.left,
			right: best.right,
		};
		vocab.push(token);
		vocabById.set(id, token);
		merges.push({ rank: merges.length, left: best.left, right: best.right, id, frequency: best.frequency });

		sequences = sequences.map(sequence => replacePair(sequence, best.left, best.right, id));
	}

	const finalTokens = sequences.reduce((sum, sequence) => sum + sequence.length, 0);
	const tokenFrequencies = countTokenFrequencies(sequences, vocabById);
	return { vocab, merges, protectedTokens, initialTokens, finalTokens, tokenFrequencies };
};

export const encodeWithModel = (text: string, model: TokenizerModel): number[] => {
	const protectedTokenIds = new Map<string, number>();
	for (const token of model.vocab) {
		if (token.type === "protected") protectedTokenIds.set(token.text, token.id);
	}
	let sequence = preTokenize(text, model.protectedTokens, protectedTokenIds);
	for (const merge of model.merges) {
		sequence = replacePair(sequence, merge.left, merge.right, merge.id);
	}
	return sequence;
};

export const decodeWithModel = (ids: number[], model: TokenizerModel): string => {
	const vocabById = makeTokenMaps(model.vocab);
	const chunks: Buffer[] = [];
	let text = "";

	const flushBytes = () => {
		if (chunks.length === 0) return;
		text += Buffer.concat(chunks).toString("utf8");
		chunks.length = 0;
	};

	for (const id of ids) {
		const token = vocabById.get(id);
		if (!token) throw new Error(`Unknown token id: ${id}`);
		if (token.type === "protected") {
			flushBytes();
			text += token.text;
		} else {
			chunks.push(Buffer.from(token.text, "latin1"));
		}
	}
	flushBytes();
	return text;
};

const serializeToken = (token: TokenInfo) => {
	if (token.type === "byte") {
		return { id: token.id, type: token.type, value: token.value, token: `<0x${token.id.toString(16).padStart(2, "0")}>` };
	}
	if (token.type === "protected") {
		return { id: token.id, type: token.type, token: token.text };
	}
	return { id: token.id, type: token.type, token: token.text, left: token.left, right: token.right };
};

const formatTsvToken = (token: string) => token
	.replace(/\\/g, "\\\\")
	.replace(/\t/g, "\\t")
	.replace(/\n/g, "\\n")
	.replace(/\r/g, "\\r");

const serializeFrequencyToken = (token: TokenFrequency) => ({
	id: token.id,
	type: token.type,
	token: token.type === "byte" ? `<0x${token.id.toString(16).padStart(2, "0")}>` : token.token,
	text: token.token,
	frequency: token.frequency,
});

const serializeFrequencyTsv = (frequencies: TokenFrequency[]) =>
	frequencies.map(token => `${formatTsvToken(token.token)}\t${token.frequency}\t${token.type === "protected" ? "protected" : ""}`).join("\n") + "\n";

const rel = (targetPath: string) => path.relative(process.cwd(), targetPath) || ".";

const main = () => {
	const options = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(options.corpusDir) || !fs.statSync(options.corpusDir).isDirectory()) {
		throw new Error(`Corpus directory does not exist: ${options.corpusDir}`);
	}
	if (!fs.existsSync(options.serializerPath) || !fs.statSync(options.serializerPath).isFile()) {
		throw new Error(`Serializer file does not exist: ${options.serializerPath}`);
	}

	let files = findLylFiles(options.corpusDir);
	if (options.maxFiles > 0) files = files.slice(0, options.maxFiles);
	if (files.length === 0) throw new Error(`No .lyl files found under ${options.corpusDir}`);

	const texts = files.map(file => fs.readFileSync(file, "utf8"));
	const inputBytes = texts.reduce((sum, text) => sum + byteLength(text), 0);
	const protectedTokens = extractProtectedTokensFromSerializer(options.serializerPath);
	const result = trainBpe(texts, {
		vocabSize: options.vocabSize,
		minFrequency: options.minFrequency,
		protectedTokens,
	});

	const model: TokenizerModel = {
		vocab: result.vocab,
		merges: result.merges,
		protectedTokens: result.protectedTokens,
	};

	for (let i = 0; i < texts.length; i++) {
		const encoded = encodeWithModel(texts[i], model);
		const decoded = decodeWithModel(encoded, model);
		if (decoded !== texts[i]) throw new Error(`Round-trip verification failed for ${files[i]}`);
	}

	const stats = {
		files: files.length,
		inputBytes,
		initialTokens: result.initialTokens,
		finalTokens: result.finalTokens,
		compressionRatio: result.initialTokens === 0 ? 0 : result.finalTokens / result.initialTokens,
	};

	const artifact = {
		version: 1,
		type: "byte-level-bpe",
		source: {
			corpusDir: rel(options.corpusDir),
			serializer: rel(options.serializerPath),
		},
		config: {
			vocabSize: options.vocabSize,
			minFrequency: options.minFrequency,
			protectedTokensDoNotMerge: true,
		},
		protectedTokens: result.protectedTokens,
		vocab: result.vocab.map(serializeToken),
		merges: result.merges,
		tokenFrequencies: result.tokenFrequencies.map(serializeFrequencyToken),
		stats,
	};

	console.log(`Corpus files: ${stats.files}`);
	console.log(`Input bytes: ${stats.inputBytes}`);
	console.log(`Protected tokens: ${result.protectedTokens.length}`);
	console.log(`Vocab size: ${result.vocab.length}`);
	console.log(`Merges: ${result.merges.length}`);
	console.log(`Initial tokens: ${stats.initialTokens}`);
	console.log(`Final tokens: ${stats.finalTokens}`);
	console.log(`Compression ratio: ${stats.compressionRatio.toFixed(4)}`);

	if (options.dryRun) {
		console.log("Dry run: tokenizer.json and token-frequencies.tsv were not written.");
		return;
	}

	fs.mkdirSync(options.outputDir, { recursive: true });
	const outputPath = path.join(options.outputDir, "tokenizer.json");
	const frequenciesPath = path.join(options.outputDir, "token-frequencies.tsv");
	fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
	fs.writeFileSync(frequenciesPath, serializeFrequencyTsv(result.tokenFrequencies), "utf8");
	console.log(`Wrote ${rel(outputPath)}`);
	console.log(`Wrote ${rel(frequenciesPath)}`);
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
