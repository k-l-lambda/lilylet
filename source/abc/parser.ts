
import { ABC } from "./abc";
// @ts-ignore - jison generated file
import grammar from "./grammar.jison.js";


export const parse = (code: string): ABC.Document => {
	return grammar.parse(code);
};


export default parse;
