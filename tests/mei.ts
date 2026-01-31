
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


// Generate index.html gallery
const generateIndexHtml = (files: string[], outputDir: string): void => {
	// Group files by category (prefix before first dash or hyphen pattern)
	const getCategory = (file: string): string => {
		const name = file.replace('.lyl', '');
		const parts = name.split('-');
		// Find category: usually first 1-2 parts
		if (parts.length >= 2) {
			// Check common patterns
			if (parts[0] === 'time' && parts[1] === 'signatures') return 'time-signatures';
			if (parts[0] === 'key' && parts[1] === 'signatures') return 'key-signatures';
			if (parts[0] === 'basic' && parts[1] === 'notes') return 'basic-notes';
			if (parts[0] === 'ties' && parts[1] === 'and') return 'ties-and-slurs';
			if (parts[0] === 'grace' && parts[1] === 'notes') return 'grace-notes';
			if (parts[0] === 'stem' && parts[1] === 'direction') return 'stem-direction';
			if (parts[0] === 'multiple' && parts[1] === 'staves') return 'multiple-staves';
			if (parts[0] === 'multiple' && parts[1] === 'voices') return 'multiple-voices';
			if (parts[0] === 'multiple' && parts[1] === 'measures') return 'multiple-measures';
			if (parts[0] === 'multiple' && parts[1] === 'parts') return 'multiple-parts';
			return parts[0];
		}
		return parts[0];
	};

	const categories = [...new Set(files.map(getCategory))].sort();

	const cards = files.map(file => {
		const name = file.replace('.lyl', '');
		const category = getCategory(file);
		return `        <div class="card" data-category="${category}">
            <div class="card-header">${name} <span class="category">${category}</span></div>
            <div class="card-body"><img src="${name}.svg" alt="${name}"></div>
            <div class="card-footer"><a href="${name}.mei">MEI</a><a href="${name}.svg" target="_blank">SVG</a></div>
        </div>`;
	}).join('\n');

	const filterButtons = categories.map(cat =>
		`<a href="#${cat}" class="filter-btn" data-filter="${cat}">${cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</a>`
	).join('\n                ');

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lilylet MEI Test Results</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        h1 { text-align: center; color: #333; margin-bottom: 10px; }
        .stats { text-align: center; color: #666; margin-bottom: 30px; }
        .filter-bar { display: flex; justify-content: center; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .filter-btn { padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 20px; cursor: pointer; font-size: 14px; transition: all 0.2s; text-decoration: none; color: #333; }
        .filter-btn:hover { background: #e0e0e0; }
        .filter-btn.active { background: #4a90d9; color: white; border-color: #4a90d9; }
        .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
        .card.hidden { display: none; }
        .card-header { padding: 12px 16px; background: #f8f9fa; border-bottom: 1px solid #eee; font-weight: 500; font-size: 14px; }
        .card-header .category { float: right; font-size: 12px; color: #888; font-weight: normal; }
        .card-body { padding: 16px; text-align: center; min-height: 100px; display: flex; align-items: center; justify-content: center; }
        .card-body img { max-width: 100%; height: auto; }
        .card-footer { padding: 12px 16px; background: #f8f9fa; border-top: 1px solid #eee; display: flex; gap: 10px; }
        .card-footer a { color: #4a90d9; text-decoration: none; font-size: 14px; }
        .card-footer a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Lilylet MEI Test Results</h1>
    <div class="stats">${files.length} test cases</div>
    <div class="filter-bar">
        <a href="#" class="filter-btn active" data-filter="all">All</a>
                ${filterButtons}
    </div>
    <div class="gallery">
${cards}
    </div>
    <script>
        function applyFilter(filter) {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            const activeBtn = document.querySelector('.filter-btn[data-filter="' + filter + '"]');
            if (activeBtn) activeBtn.classList.add('active');
            document.querySelectorAll('.card').forEach(card => {
                if (filter === 'all' || card.dataset.category === filter) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            });
        }
        function handleHash() {
            const hash = window.location.hash.slice(1);
            applyFilter(hash || 'all');
        }
        window.addEventListener('hashchange', handleHash);
        handleHash();
    </script>
</body>
</html>`;

	fs.writeFileSync(`${outputDir}/index.html`, html);
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

	// Generate index.html gallery
	generateIndexHtml(files, outputDir);
};


main();
