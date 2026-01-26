
import fs from "fs";

import * as lilylet from "../source/lilylet";



const parse = (lyl_dir: string): void => {
	const files = fs.readdirSync(lyl_dir);

	for (const file of files) {
		const code = fs.readFileSync(`${lyl_dir}/${file}`, { encoding: "utf-8" });
		lilylet.parseCode(code);

		console.log(file, "parsing passed.");
	}
};

parse("./tests/assets");
