
import fs from "fs";

import * as jisonParser from "./jisonParserNode";



const build = async (jison: string, target?: string): Promise<void> => {
	const parser = await jisonParser.load(jison);
	const code = parser.generate();

	if (target)
		fs.writeFileSync(target, code);
	else
		console.log("code:", code);
};


const main = async () => {
	await build("./source/lilylet/lilylet.jison", "./source/lilylet/grammar.jison.js");
	await build("./source/abc/abc.jison", "./source/abc/grammar.jison.js");

	console.log("Done.");
};



main();
