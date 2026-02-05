
export * from "./types";
export * from "./parser";
export * from "./serializer";

import * as meiEncoder from "./meiEncoder";
import * as musicXmlDecoder from "./musicXmlDecoder";
import * as lilypondEncoder from "./lilypondEncoder";
import * as musicXmlEncoder from "./musicXmlEncoder";

// lilypondDecoder is optional - requires @k-l-lambda/lotus
let lilypondDecoder: typeof import("./lilypondDecoder") | undefined;
try {
	lilypondDecoder = await import("./lilypondDecoder");
} catch {
	// lotus not available, lilypondDecoder will be undefined
}

export {
	meiEncoder,
	musicXmlDecoder,
	lilypondEncoder,
	musicXmlEncoder,
	lilypondDecoder,
};
