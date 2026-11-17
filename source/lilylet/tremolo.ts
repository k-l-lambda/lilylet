/**
 * Two-note tremolo arithmetic, shared by every encoder/analyser so they agree.
 *
 * LilyPond semantics (verified against 2.22.1): `\repeat tremolo N { a16 b16 }` lasts
 * N × 2 sixteenths. BOTH notes are written at that total length — N=4 gives two half
 * notes joined by two strokes — and each takes half of it in time. A dotted member
 * (`a16.`) scales the total by 3/2: `\repeat tremolo 2 { a16. b16. }` is two dotted
 * quarters lasting 3/8. MEI <fTrem> and MusicXML follow the same convention: the
 * children carry the written (total) duration.
 */

import type { Duration, TremoloEvent } from "./types";


/** Length of a duration in whole notes. */
export const durationWhole = (d: { division: number; dots?: number }): number => {
	let w = 1 / d.division;
	let dot = w;
	for (let i = 0; i < (d.dots || 0); i++) {
		dot /= 2;
		w += dot;
	}
	return w;
};


/** Total time a two-note tremolo occupies, in whole notes. */
export const tremoloTotalWhole = (t: Pick<TremoloEvent, "count" | "division" | "dots">): number =>
	2 * t.count * durationWhole({ division: t.division, dots: t.dots });


const DIVISIONS = [0.5, 1, 2, 4, 8, 16, 32, 64, 128];

/**
 * The plain or dotted (up to 3 dots) duration whose length is `whole` whole notes, or
 * undefined when none matches (e.g. 5/16).
 */
export const durationFromWhole = (whole: number): Duration | undefined => {
	for (const division of DIVISIONS) {
		for (let dots = 0; dots <= 3; dots++) {
			if (Math.abs(durationWhole({ division, dots }) - whole) < 1e-9) return { division, dots };
		}
	}
	return undefined;
};


/**
 * The written duration of each tremolo member: the tremolo's total length. Falls back
 * to the nearest plain duration not longer than the total when the total has no
 * single-note spelling (a malformed count such as 5 × 16ths).
 */
export const tremoloWrittenDuration = (t: Pick<TremoloEvent, "count" | "division" | "dots">): Duration => {
	const total = tremoloTotalWhole(t);
	const exact = durationFromWhole(total);
	if (exact) return exact;
	const division = DIVISIONS.find(d => 1 / d <= total) ?? 128;
	return { division, dots: 0 };
};


/** Number of tremolo strokes for a member division: 8ths 1, 16ths 2, 32nds 3. */
export const tremoloStrokes = (division: number): number => Math.max(1, Math.round(Math.log2(division)) - 2);
