
export * from "./types";
export * from "./parser";
export * from "./serializer";

import * as meiEncoder from "./meiEncoder";
import * as musicXmlDecoder from "./musicXmlDecoder";
import * as lilypondEncoder from "./lilypondEncoder";
import * as musicXmlEncoder from "./musicXmlEncoder";

// lilypondDecoder is optional - requires @k-l-lambda/lotus
// Use dynamic import to avoid build-time dependency
const loadLilypondDecoder = async () => {
	try {
		return await import("./lilypondDecoder.js");
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
