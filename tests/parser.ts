
import fs from "fs";

import * as lilylet from "../source/lilylet";



const parse = async (lyl_dir: string): Promise<void> => {
	const files = fs.readdirSync(lyl_dir);

	for (const file of files) {
		const code = fs.readFileSync(`${lyl_dir}/${file}`, { encoding: "utf-8" });
		await lilylet.parseCode(code);

		console.log(name, "parsing passed.");
	}
};

parse("./tests/assets");
