// Browser bundle entry for LilyScript's score-player.
//
// Exposes a minimal global `window.LilyletLib = { parseCode, meiEncoder,
// serializeLilyletDoc }` — the exact surface LilyScript/web/score-player.js
// consumes (lyl text --parseCode + meiEncoder--> MEI XML --Verovio--> SVG).
//
// Build with esbuild into an IIFE:
//   node_modules/.bin/esbuild tools/browserBundle.ts \
//     --bundle --format=iife --platform=browser --minify \
//     --outfile=<LilyScript>/web/vendor/lilylet.bundle.js

// Import from the specific modules (NOT the ./index barrel): the barrel
// re-exports lilypondDecoder, which drags in @k-l-lambda/lotus + music-widgets
// (vue/fs/path) — none of which the score-player needs. parseCode/meiEncoder/
// serializeLilyletDoc have no such dependency, so importing them directly keeps
// the browser bundle free of node/vue deps.
import { parseCode } from "../source/lilylet/parser";
import { serializeLilyletDoc } from "../source/lilylet/serializer";
import * as meiEncoder from "../source/lilylet/meiEncoder";

declare global {
	interface Window {
		LilyletLib: {
			parseCode: typeof parseCode;
			serializeLilyletDoc: typeof serializeLilyletDoc;
			meiEncoder: typeof meiEncoder;
		};
	}
}

window.LilyletLib = { parseCode, serializeLilyletDoc, meiEncoder };
