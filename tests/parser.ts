
import fs from "fs";

import * as lilylet from "../source/lilylet";



const parse = (lyl_dir: string): void => {
	const files = fs.readdirSync(lyl_dir);

	for (const file of files) {
		const filePath = `${lyl_dir}/${file}`;
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) continue;
		if (!file.endsWith('.lyl')) continue;

		const code = fs.readFileSync(filePath, { encoding: "utf-8" });
		lilylet.parseCode(code);

		console.log(file, "parsing passed.");
	}
};

parse("./tests/assets/unit-cases");
