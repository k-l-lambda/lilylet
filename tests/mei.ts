
import fs from "fs";
// @ts-ignore
import createVerovioModule from "verovio/wasm";
// @ts-ignore
import { VerovioToolkit } from "verovio/esm";

import * as lilylet from "../source/lilylet";


interface IVerovioToolkit {
	loadData(data: string): boolean;
	renderToSVG(page?: number, options?: object): string;
	setOptions(options: object): void;
	getLog(): string;
}

interface TestResult {
	file: string;
	success: boolean;
	error?: string;
	mei?: string;
	svg?: string;
}


const initVerovio = async (): Promise<IVerovioToolkit> => {
	const VerovioModule = await createVerovioModule();
	return new VerovioToolkit(VerovioModule) as IVerovioToolkit;
};


const testFile = async (vrvToolkit: IVerovioToolkit, filePath: string): Promise<TestResult> => {
	const file = filePath.split("/").pop()!;

	try {
		// Step 1: Parse .lyl file
		const code = fs.readFileSync(filePath, { encoding: "utf-8" });
		const doc = lilylet.parseCode(code);

		// Step 2: Encode to MEI
		const mei = lilylet.meiEncoder.encode(doc);

		// Step 3: Calculate pageHeight based on measure count and staff count
		const measureCount = doc.measures?.length || 1;
		// Calculate total staff count
		let staffCount = 1;
		if (doc.measures.length > 0) {
			const firstMeasure = doc.measures[0];
			staffCount = firstMeasure.parts.reduce((total, part) => {
				const maxStaff = part.voices.reduce((max, voice) => Math.max(max, voice.staff || 1), 1);
				return total + maxStaff;
			}, 0) || 1;
		}
		const basePageHeight = 2000;
		const measuresPerPage = 20;
		const pageHeight = Math.max(basePageHeight, Math.ceil(measureCount / measuresPerPage) * basePageHeight) * 2 * staffCount;

		// Step 4: Set Verovio options for single-page rendering
		vrvToolkit.setOptions({
			scale: 40,
			adjustPageHeight: true,
			pageHeight,
			pageWidth: 2100,
		});

		// Step 5: Validate MEI with verovio
		const success = vrvToolkit.loadData(mei);
		if (!success) {
			return {
				file,
				success: false,
				error: "Verovio failed to load MEI data",
				mei,
			};
		}

		// Step 6: Try to render SVG (further validation)
		const svg = vrvToolkit.renderToSVG(1);
		if (!svg || svg.length === 0) {
			return {
				file,
				success: false,
				error: "Verovio failed to render SVG",
				mei,
			};
		}

		return {
			file,
			success: true,
			mei,
			svg,
		};
	} catch (err) {
		return {
			file,
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
};


const main = async (): Promise<void> => {
	const lylDir = "./tests/assets/unit-cases";
	const outputDir = "./tests/output/unit-cases";

	// Create output directory if not exists
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	// Initialize verovio
	console.log("Initializing Verovio...");
	const vrvToolkit = await initVerovio();
	console.log("Verovio initialized.\n");

	// Get all .lyl files
	const files = fs.readdirSync(lylDir).filter(f => f.endsWith(".lyl"));

	let passed = 0;
	let failed = 0;
	const failures: TestResult[] = [];

	for (const file of files) {
		const result = await testFile(vrvToolkit, `${lylDir}/${file}`);

		if (result.success) {
			console.log(`✓ ${file}`);
			passed++;

			// Optionally save MEI and SVG output
			if (result.mei) {
				fs.writeFileSync(`${outputDir}/${file.replace(".lyl", ".mei")}`, result.mei);
			}
			if (result.svg) {
				fs.writeFileSync(`${outputDir}/${file.replace(".lyl", ".svg")}`, result.svg);
			}
		} else {
			console.log(`✗ ${file}: ${result.error}`);
			failed++;
			failures.push(result);

			// Save failed MEI for debugging
			if (result.mei) {
				fs.writeFileSync(`${outputDir}/${file.replace(".lyl", ".mei.failed")}`, result.mei);
			}
		}
	}

	console.log(`\n========================================`);
	console.log(`Total: ${files.length}, Passed: ${passed}, Failed: ${failed}`);

	if (failures.length > 0) {
		console.log(`\nFailed tests:`);
		for (const f of failures) {
			console.log(`  - ${f.file}: ${f.error}`);
		}
		process.exit(1);
	}
};


main();
