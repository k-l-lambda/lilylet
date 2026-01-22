
import { LilyletDoc } from "./types";



const parseCode = async (code: string): Promise<LilyletDoc> => {
	const grammar = await import("./grammar.jison.js");
	const raw = grammar.parse(code);

	return raw;
};



export {
	parseCode,
};
