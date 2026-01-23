
import { LilyletDoc } from "./types";



const parseCode = async (code: string): Promise<LilyletDoc> => {
	const grammar = await import("./grammar.jison.js");

	// Reset parser state before each parse to avoid contamination
	if (grammar.parser && grammar.parser.resetState) {
		grammar.parser.resetState();
	}

	const raw = grammar.parse(code);

	return raw;
};



export {
	parseCode,
};
