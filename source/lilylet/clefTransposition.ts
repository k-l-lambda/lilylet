/**
 * The canonical grammar for Lilylet's transposing-clef suffix, and the only place
 * that converts between a suffix and a semitone count.
 *
 * A Lilylet clef may carry a written→sounding transposition as a suffix:
 *
 *   treble_8    an octave down          (-12)
 *   treble^2    a major second up       (+2)
 *   treble_5    a perfect fifth down    (-7)
 *   treble_m3   a MINOR third down      (-3)
 *   treble_m7   a minor seventh down    (-10)
 *
 * `_` lowers, `^` raises, the number is a diatonic interval, and an `m` before the
 * number selects the MINOR form of that interval. Without `m` the interval is the
 * major/perfect one, which is what every suffix written before the `m` form existed
 * means — so plain `_N`/`^N` keeps its original value and old documents are read
 * exactly as before.
 *
 * Why `m` exists: the diatonic interval number alone cannot express a minor
 * interval, so the semitone counts 1, 3, 8 and 10 were unreachable. Those are not
 * exotic — a minor third is the A clarinet and a minor seventh is a common brass
 * transposition, so an ABC `transpose=-3` had no exact suffix and was rounded to
 * `_3` (-4), putting a one-semitone error on the sounding pitch. With `m` the only
 * remaining gap is 6 semitones, the tritone, which is neither major/perfect nor
 * minor (it is an augmented fourth or diminished fifth). No instrument transposes
 * by a tritone and the shape does not occur in any corpus checked, so it is left
 * unrepresentable rather than given a spelling that would have to be arbitrary.
 *
 * NOTE ON LILYPOND: LilyPond's own `\clef "treble_8"` suffix is a NOTATIONAL
 * device — it repositions middle C on the staff and does not change sounding pitch
 * at all (LilyPond expresses instrument transposition with the separate
 * `\transposition <pitch>`, which takes a pitch and so reaches every semitone).
 * Lilylet deliberately diverges: here the suffix DOES carry the sounding shift, and
 * `m` is the extension that makes that carrying lossless. LilyPond rejects `_m3` as
 * an unknown clef type, so a Lilylet clef using `m` is not portable to LilyPond
 * as-is.
 */

// Semitones spanned by the MAJOR/PERFECT form of each diatonic step count
// (0 = unison, 1 = second, … 6 = seventh).
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// Diatonic step counts that have a minor form: seconds, thirds, sixths, sevenths.
// Unison, fourth and fifth are perfect and take no `m`.
const MINOR_CAPABLE_STEPS = new Set([1, 2, 5, 6]);

/** A parsed transposing-clef suffix. */
export interface ClefSuffix {
	/** The clef name with the suffix removed, e.g. "treble". */
	base: string;
	/** Diatonic interval number as written: 8 for an octave, 3 for a third. */
	interval: number;
	/** True when the suffix selected the minor form (`m` present). */
	minor: boolean;
	/** true = `^` (up), false = `_` (down). */
	up: boolean;
}

// `_`/`^`, an optional `m`, then a positive interval number with no leading zero.
const SUFFIX_RE = /^(.*?)([_^])(m?)([1-9][0-9]*)$/;

/** Semitones spanned by a diatonic interval number, or undefined if `m` is invalid for it. */
const intervalSemitones = (interval: number, minor: boolean): number | undefined => {
	const steps = interval - 1;						// diatonic steps above unison
	const within = steps % 7;
	if (minor && !MINOR_CAPABLE_STEPS.has(within)) return undefined;
	const semis = DIATONIC_SEMITONES[within] + 12 * Math.floor(steps / 7);
	return minor ? semis - 1 : semis;
};

/**
 * Parse a clef string into its base name and transposition suffix.
 * Returns undefined when the clef carries no suffix, or when the suffix is
 * malformed (including `m` on a perfect interval such as `_m4`).
 */
export const parseClefSuffix = (clefStr: string): ClefSuffix | undefined => {
	const match = SUFFIX_RE.exec(clefStr || "");
	if (!match) return undefined;
	const interval = parseInt(match[4], 10);
	const minor = match[3] === "m";
	// Reject a suffix we cannot interpret rather than silently mis-reading it.
	if (intervalSemitones(interval, minor) === undefined) return undefined;
	return { base: match[1], interval, minor, up: match[2] === "^" };
};

/** The clef name with any transposition suffix stripped. */
export const clefBaseName = (clefStr: string): string =>
	parseClefSuffix(clefStr)?.base ?? clefStr;

/**
 * The written→sounding semitone shift a clef string declares; 0 when it declares
 * none (no suffix, or a suffix that cannot be interpreted).
 */
export const clefSuffixSemitones = (clefStr: string): number => {
	const parsed = parseClefSuffix(clefStr);
	if (!parsed) return 0;
	const semis = intervalSemitones(parsed.interval, parsed.minor)!;
	return parsed.up ? semis : -semis;
};

/**
 * The written→sounding transposition as MEI's att.transposition pair, in the
 * `{diat, semi}` form: diatonic steps and semitones, both signed. A minor third
 * down is `{diat: -2, semi: -3}` — the two differ, which is exactly the
 * information the diatonic number alone cannot carry.
 */
export const clefSuffixTransposition = (clefStr: string): { diat: number; semi: number } | undefined => {
	const parsed = parseClefSuffix(clefStr);
	if (!parsed) return undefined;
	const semis = intervalSemitones(parsed.interval, parsed.minor)!;
	const sign = parsed.up ? 1 : -1;
	return { diat: sign * (parsed.interval - 1), semi: sign * semis };
};

/**
 * The suffix that expresses `semitones` EXACTLY, or undefined when no suffix can.
 * Never approximates: a caller that gets undefined must handle the gap rather than
 * emit a shift it cannot honour. The only unrepresentable interval within an octave
 * is 6 semitones (the tritone) — see the module comment.
 *
 * Returns the suffix alone (e.g. "_m3"), to be appended to a clef base name.
 */
export const semitonesToClefSuffix = (semitones: number): string | undefined => {
	if (!Number.isInteger(semitones) || semitones === 0) return undefined;
	const magnitude = Math.abs(semitones);
	const sign = semitones < 0 ? "_" : "^";
	// Search interval numbers covering the requested magnitude; octaves shift by 7
	// diatonic steps, so an octave-and-a-bit needs interval numbers beyond 8.
	const maxInterval = Math.floor(magnitude / 12) * 7 + 8;
	for (let interval = 1; interval <= maxInterval; interval++) {
		for (const minor of [false, true]) {
			if (intervalSemitones(interval, minor) === magnitude)
				return `${sign}${minor ? "m" : ""}${interval}`;
		}
	}
	return undefined;
};

/**
 * Apply a semitone transposition to a clef name, returning the suffixed clef.
 * Returns undefined when the shift has no exact suffix, so the caller can decide
 * between dropping the transposition and reporting it — silently rounding is what
 * produced wrong sounding pitches before this module existed.
 */
export const withClefTransposition = (base: string, semitones: number): string | undefined => {
	if (semitones === 0) return base;
	const suffix = semitonesToClefSuffix(semitones);
	return suffix === undefined ? undefined : base + suffix;
};
