// Browser bundle entry for LilyScript's score-player AND editor highlighter.
//
// Exposes a minimal global `window.LilyletLib = { parseCode, meiEncoder,
// serializeLilyletDoc, tokenizeLine, matchAt }`:
//   - parseCode/meiEncoder/serializeLilyletDoc — score-player.js (lyl --> MEI --> SVG)
//   - tokenizeLine/matchAt — lyl-highlight.js (grammar-derived editor syntax colouring)
//
// Build with esbuild into an IIFE:
//   node_modules/.bin/esbuild tools/browserBundle.ts \
//     --bundle --format=iife --platform=browser --minify \
//     --outfile=<LilyScript>/web/vendor/lilylet.bundle.js

// Import from the specific modules (NOT the ./index barrel): the barrel
// re-exports lilypondDecoder, which drags in @k-l-lambda/lotus + music-widgets
// (vue/fs/path) — none of which the score-player needs. parseCode/meiEncoder/
// serializeLilyletDoc have no such dependency, so importing them directly keeps
// the browser bundle free of node/vue deps. highlight.ts is pure regex (zero deps).
import { parseCode } from "../source/lilylet/parser";
import { serializeLilyletDoc } from "../source/lilylet/serializer";
import * as meiEncoder from "../source/lilylet/meiEncoder";
import { tokenizeLine, matchAt } from "../source/lilylet/highlight";

declare global {
	interface Window {
		LilyletLib: {
			parseCode: typeof parseCode;
			serializeLilyletDoc: typeof serializeLilyletDoc;
			meiEncoder: typeof meiEncoder;
			tokenizeLine: typeof tokenizeLine;
			matchAt: typeof matchAt;
		};
	}
}

window.LilyletLib = { parseCode, serializeLilyletDoc, meiEncoder, tokenizeLine, matchAt };
