
export * from "./types";
export * from "./parser";
export * from "./serializer";

import * as meiEncoder from "./meiEncoder";
import * as musicXmlDecoder from "./musicXmlDecoder";
import * as lilypondEncoder from "./lilypondEncoder";
import * as musicXmlEncoder from "./musicXmlEncoder";

// lilypondDecoder is optional - requires @k-l-lambda/lotus
// Use dynamic import to avoid build-time dependency
// @ts-ignore - lilypondDecoder.ts is excluded from build, pre-built .js is used
const loadLilypondDecoder = async (): Promise<any> => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return await import(/* webpackIgnore: true */ "./lilypondDecoder.js");
	} catch {
		return undefined;
	}
};

export {
	meiEncoder,
	musicXmlDecoder,
	lilypondEncoder,
	musicXmlEncoder,
	loadLilypondDecoder,
};
