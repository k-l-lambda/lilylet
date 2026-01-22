
import fs from "fs";

import { Parser } from "./jisonWrapper";



const parsers = new Map<fs.PathLike, Parser>();



export async function load (jison: fs.PathLike): Promise<Parser> {
	if (!parsers.get(jison)) {
		const grammar = (await fs.promises.readFile(jison)).toString();

		//console.log("grammar:", grammar);

		parsers.set(jison, new Parser(grammar)) ;
	}

	return parsers.get(jison)!;
};
