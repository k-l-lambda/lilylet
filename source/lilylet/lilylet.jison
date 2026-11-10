
%{
	// Helper functions
	const fraction = (numerator, denominator) => ({ numerator, denominator });

	const pitch = (phonet, accidental, octave) => ({
		phonet,
		accidental: accidental || undefined,
		octave: octave || 0,
	});

	const duration = (division, dots) => ({
		division,
		dots: dots || 0,
	});

	const noteEvent = (pitches, dur, marks, options = {}) => {
		if (currentHeadShape !== undefined && options.headShape === undefined) {
			options = { ...options, headShape: currentHeadShape };
			// \xNote affects only the note that follows it; \improvisationOn persists.
			if (xNotePending) { currentHeadShape = undefined; xNotePending = false; }
		}
		// Check if this is a pitched rest (e.g., g'\rest)
		const pitchedRestMark = marks && marks.find(m => m && m.pitchedRest);
		if (pitchedRestMark) {
			const pitch = Array.isArray(pitches) ? pitches[0] : pitches;
			return {
				type: 'rest',
				duration: dur,
				pitch: pitch,
			};
		}
		return {
			type: 'note',
			pitches: Array.isArray(pitches) ? pitches : [pitches],
			duration: dur,
			marks: marks && marks.length ? marks : undefined,
			...options,
		};
	};

	// Build a lyric lane (one \addlyrics block) from raw lyric items. `--` is a
	// connector that hyphenates the preceding syllable (it does not consume a
	// note slot); `_` is a skipped slot; `__` extends the preceding syllable.
	const addlyricsLane = (items) => {
		const syllables = [];
		for (const it of items) {
			if (it.text !== undefined) syllables.push({ text: it.text });
			else if (it.hyphen) { if (syllables.length) syllables[syllables.length - 1].hyphen = true; }
			else if (it.skip) syllables.push({ skip: true });
			else if (it.extend) { if (syllables.length) syllables[syllables.length - 1].extend = true; else syllables.push({ extend: true }); }
		}
		return { syllables };
	};

	const restEvent = (dur, options = {}) => ({
		type: 'rest',
		duration: dur,
		...options,
	});

	const contextChange = (changes) => ({
		type: 'context',
		...changes,
	});

	const keySignature = (phonet, accidental, mode) => ({
		pitch: phonet,
		accidental: accidental || undefined,
		mode,
	});

	// Build a \figures lane from parsed groups: resolve sticky durations (quarter to
	// begin with), and keep it parallel to LyricLane.
	const figuresLane = (placement, items) => {
		let dur = { division: 4, dots: 0 };
		const groups = items.map((it) => {
			if (it.duration) dur = it.duration;
			return it.lines ? { duration: dur, lines: it.lines } : { duration: dur };
		});
		return { placement, groups };
	};

	// Drop figure groups that start at or beyond the voice's end, with a warning.
	const clipFigures = (lane, events) => {
		const voiceTicks = voiceEventTicks(events);
		if (!(voiceTicks > 0)) return lane;
		let at = 0;
		const kept = [];
		for (const g of lane.groups) {
			if (at < voiceTicks) kept.push(g);
			at += durationTicks(g.duration);
		}
		if (at > voiceTicks) {
			const msg = `\\figures: ${at} ticks of figures but the voice has ${voiceTicks} ticks; ${lane.groups.length - kept.length} group(s) dropped`;
			console.warn('[lilylet] ' + msg);
			parseWarnings.push({ type: 'figures-overflow', message: msg, declared: at, actual: voiceTicks });
		}
		return { ...lane, groups: kept };
	};

	const voice = (staff, events, lyrics, figures) => {
		// Use the first \staff "N" context event that appears before any musical event
		// (notes/rests/tuplets) as the authoritative voice.staff.
		// Skip pitchReset events (from NEWLINE tokens at voice-line boundaries).
		// This ensures \staff "1" \times ... \staff "2" ... gives voice.staff=1,
		// not 2 (the final currentStaff value), while \staff "2" c1 gives voice.staff=2.
		let leadingStaff = null;
		for (const e of events) {
			if (!e) continue;
			if (e.type === 'pitchReset') continue;
			if (e.type === 'context') {
				if (e.staff != null) { leadingStaff = e.staff; break; }
				continue; // skip non-staff context events (key, clef, time, etc.)
			}
			break; // first musical/structural event — stop
		}
		// \addlyrics lanes are scoped to THIS voice; verse numbers are 1-based by
		// order of \addlyrics blocks within the voice.
		const lanes = lyrics && lyrics.length ? lyrics.map((lane, i) => ({ verse: i + 1, ...lane })) : undefined;
		const figureLanes = figures && figures.length ? figures.map((lane) => clipFigures(lane, events)) : undefined;
		return {
			staff: leadingStaff != null ? leadingStaff : 1,
			events,
			lyrics: lanes,
			...(figureLanes ? { figures: figureLanes } : {}),
		};
	};

	const part = (voices, name) => ({
		name: name || undefined,
		voices,
	});

	const MUSICAL = new Set(['note', 'rest', 'tuplet', 'times', 'tremolo']);
	const hasMusicalContent = (parts) =>
		parts.some(p => p.voices.some(v => v.events.some(e => e && MUSICAL.has(e.type))));

	const measure = (parts, key, timeSig, partial) => {
		if (!hasMusicalContent(parts)) return null;
		return {
			key: key || undefined,
			timeSig: timeSig || undefined,
			parts,
			partial: partial || undefined,
		};
	};

	const tupletEvent = (ratio, events) => ({
		type: 'tuplet',
		ratio,
		events,
	});

	const timesEvent = (ratio, events) => ({
		type: 'times',
		ratio,
		events,
	});

	const tremoloEvent = (pitchA, pitchB, count, division, marksA, marksB) => ({
		type: 'tremolo',
		pitchA,
		pitchB,
		count,
		division,
		...(marksA && marksA.length ? { marksA } : {}),
		...(marksB && marksB.length ? { marksB } : {}),
	});

	// Articulation/mark helpers - all marks have markType for discrimination
	const articulation = (type, placement) => ({ markType: 'articulation', type, placement });
	const ornament = (type) => ({ markType: 'ornament', type });
	const dynamic = (type) => ({ markType: 'dynamic', type });
	const hairpin = (type) => ({ markType: 'hairpin', type });
	const pedal = (type) => ({ markType: 'pedal', type });
	const tie = (start) => ({ markType: 'tie', start });
	const slur = (start) => ({ markType: 'slur', start });
	const beam = (start) => ({ markType: 'beam', start });
	const fingering = (finger, placement) => ({ markType: 'fingering', finger, placement });
	const navigation = (type) => ({ markType: 'navigation', type });

	const barlineEvent = (style) => ({ type: 'barline', style });
	const harmonyEvent = (text) => ({ type: 'harmony', text });
	const markupEvent = (content, placement) => ({ type: 'markup', content, placement: placement || undefined });
	const dynamicEvent = (type) => ({ type: 'dynamic', dynamicType: type });
	const markupMark = (content) => ({ markType: 'markup', content });
	const glissando = () => ({ markType: 'glissando' });

	// Strip the surrounding quotes from a STRING token and unescape the control
	// sequences the serializer emits (escapeString): \n \r \t \" \\ . A single
	// left-to-right pass over each \x pair avoids the sequential-replace bug where
	// an escaped backslash (\\) followed by n would be misread as a newline.
	const UNESCAPE = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
	const unq = (s) => s.slice(1, -1).replace(/\\(.)/g, (m, c) => (c in UNESCAPE ? UNESCAPE[c] : m));

	// Build an { instruments: { <key>: { name, shortName? } } } fragment from a
	// `[instrument-<key>` header token. <key> is a staff-layout group key — a single
	// staff id ("1", "v1", "b") or a range ("1-2", "pl-pr") — taken verbatim after the
	// "[instrument-" prefix so it lines up with staffLayout's groupKey().
	const instrumentStaff = (token, name, shortName) => {
		const key = token.slice('[instrument-'.length);
		const entry = shortName !== undefined ? { name, shortName } : { name };
		return { instruments: { [key]: entry } };
	};

	// Merge two header fragments. Plain fields are overwritten by the later one, but the
	// `instruments` map is deep-merged so multiple [instrument-<key>] lines accumulate.
	const mergeHeaders = (a, b) => {
		const merged = { ...a, ...b };
		if (a.instruments || b.instruments)
			merged.instruments = { ...a.instruments, ...b.instruments };
		return merged;
	};

	// Parse PITCH token (e.g., "c", "cs", "bf", "css", "bff") into phonet and accidental
	const parsePitch = (text, octave) => {
		const phonet = text[0].toLowerCase();
		const accStr = text.slice(1).toLowerCase();
		let accidental = undefined;
		if (accStr === 's') accidental = 'sharp';
		else if (accStr === 'f') accidental = 'flat';
		else if (accStr === 'ss') accidental = 'doubleSharp';
		else if (accStr === 'ff') accidental = 'doubleFlat';
		return pitch(phonet, accidental, octave || 0);
	};

	// Parse PITCH token for key signature (no octave)
	const parsePitchName = (text) => {
		const phonet = text[0].toLowerCase();
		const accStr = text.slice(1).toLowerCase();
		let accidental = undefined;
		if (accStr === 's') accidental = 'sharp';
		else if (accStr === 'f') accidental = 'flat';
		else if (accStr === 'ss') accidental = 'doubleSharp';
		else if (accStr === 'ff') accidental = 'doubleFlat';
		return { phonet, accidental };
	};

	// Global state for parsing
	let currentStaff = 1;
	let currentKey = null;
	let currentTimeSig = null;
	let currentDuration = { division: 4, dots: 0 }; // default quarter note
	let numericTimeSignature = false; // When true, 4/4 and 2/2 use numeric display instead of C/C|
	let currentOttava = 0; // Current ottava level, resets on newline
	// Notehead shape set by \xNote / \improvisationOn, cleared by \improvisationOff.
	// \xNote applies to the immediately following note only (LilyPond semantics).
	let currentHeadShape = undefined;
	let xNotePending = false;
	// The hairpin last opened (\\< or \\>), so `\!` can close the right one.
	let lastHairpin = undefined;

	// \partial warnings accumulated during parse; reset before each parse
	let parseWarnings = [];

	// Reset parser state - call before each parse
	const resetParserState = () => {
		currentStaff = 1;
		currentKey = null;
		currentTimeSig = null;
		currentDuration = { division: 4, dots: 0 };
		numericTimeSignature = false;
		currentOttava = 0;
		parseWarnings = [];
	};

	// Export reset function and warning accessors
	parser.resetState = resetParserState;
	parser.getWarnings = () => parseWarnings;

	// Duration ticks helper for \partial validation (TPQN=480)
	const durationTicks = (dur) => {
		let t = 1920 / dur.division; // 1920 = whole note ticks
		let dot = t / 2;
		for (let i = 0; i < (dur.dots || 0); i++) { t += dot; dot /= 2; }
		return Math.round(t);
	};

	// Sum ticks for an event list (notes/rests only, skip graces)
	const voiceEventTicks = (events) => {
		let total = 0;
		for (const e of events) {
			if (!e) continue;
			if (e.type === 'note' || e.type === 'rest') {
				if (e.grace) continue;
				total += durationTicks(e.duration);
			} else if (e.type === 'tuplet' || e.type === 'times') {
				const factor = e.ratio.numerator / e.ratio.denominator;
				for (const inner of e.events || []) {
					if (inner && (inner.type === 'note' || inner.type === 'rest') && !inner.grace) {
						total += Math.round(durationTicks(inner.duration) * factor);
					}
				}
			}
		}
		return total;
	};
%}


%lex

%option flex unicode case-insensitive

%x lyric
%x figures

%%

[ \t]+							{}
(\r?\n)+						return 'NEWLINE'
\%.*							{}

\[title							return 'HEADER_TITLE'
\[subtitle						return 'HEADER_SUBTITLE'
\[composer						return 'HEADER_COMPOSER'
\[arranger						return 'HEADER_ARRANGER'
\[lyricist						return 'HEADER_LYRICIST'
\[opus							return 'HEADER_OPUS'
\[instrument\-[A-Za-z0-9_]+(?:\-[A-Za-z0-9_]+)*	return 'HEADER_INSTRUMENT_STAFF'
\[instrument					return 'HEADER_INSTRUMENT'
\[genre							return 'HEADER_GENRE'
\[staves						return 'HEADER_STAVES'
\[measures						return 'HEADER_MEASURES'
\[auto\-beam					return 'HEADER_AUTOBEAM'
\]								return ']'

\"([^\"\\]|\\.)*\"				return 'STRING'

"\\clef"						return 'CMD_CLEF'
"\\key"							return 'CMD_KEY'
"\\time"						return 'CMD_TIME'
"\\partial"						return 'CMD_PARTIAL'
"\\numericTimeSignature"		return 'CMD_NUMERIC_TIME_SIG'
\\undo[ \t]+\\omit[ \t]+(?:Score|Staff)\.TimeSignature\b	return 'CMD_UNDO_OMIT_TIME_SIG'
\\undo[ \t]+\\omit[ \t]+(?:Score|Staff)\.BarLine\b		return 'CMD_UNDO_OMIT_BAR_LINE'
\\omit[ \t]+(?:Score|Staff)\.TimeSignature\b		return 'CMD_OMIT_TIME_SIG'
\\omit[ \t]+(?:Score|Staff)\.BarLine\b			return 'CMD_OMIT_BAR_LINE'
"\\defaultTimeSignature"		return 'CMD_DEFAULT_TIME_SIG'
"\\tempo"						return 'CMD_TEMPO'
"\\staff"						return 'CMD_STAFF'
"\\grace"						return 'CMD_GRACE'
"\\times"						return 'CMD_TIMES'
"\\tuplet"						return 'CMD_TUPLET'
"\\repeat"						return 'CMD_REPEAT'
"\\ottava"						return 'CMD_OTTAVA'
"\\stemUp"						return 'CMD_STEMUP'
"\\stemDown"					return 'CMD_STEMDOWN'
"\\stemNeutral"					return 'CMD_STEMNEUTRAL'

"\\major"						return 'MODE_MAJOR'
"\\minor"						return 'MODE_MINOR'

\\sustainOn(?![a-zA-Z])					return 'CMD_SUSTAINON'
\\sustainOff(?![a-zA-Z])					return 'CMD_SUSTAINOFF'

\\bar(?![a-zA-Z])							return 'CMD_BAR'
\\coda(?![a-zA-Z])						return 'CMD_CODA'
\\segno(?![a-zA-Z])						return 'CMD_SEGNO'
\\chords(?![a-zA-Z])						return 'CMD_CHORDS'
\\markup(?![a-zA-Z])						return 'CMD_MARKUP'
"\\addlyrics"					{ this.pushState('lyric'); return 'CMD_ADDLYRICS'; }
"^\\figures"					{ this.pushState('figures'); return 'CMD_FIGURES_ABOVE'; }
"_\\figures"					{ this.pushState('figures'); return 'CMD_FIGURES_BELOW'; }
"\\figures"					{ this.pushState('figures'); return 'CMD_FIGURES'; }

"\\<"							return 'CMD_CRESC_BEGIN'
"\\>"							return 'CMD_DIM_BEGIN'
"\\!"							return 'CMD_DYNAMICS_END'

\\staccato(?![a-zA-Z])					return 'ART_STACCATO'
\\staccatissimo(?![a-zA-Z])				return 'ART_STACCATISSIMO'
\\tenuto(?![a-zA-Z])						return 'ART_TENUTO'
\\marcato(?![a-zA-Z])						return 'ART_MARCATO'
\\accent(?![a-zA-Z])						return 'ART_ACCENT'
\\portato(?![a-zA-Z])						return 'ART_PORTATO'

\\trill(?![a-zA-Z])						return 'ORN_TRILL'
\\turn(?![a-zA-Z])						return 'ORN_TURN'
\\mordent(?![a-zA-Z])						return 'ORN_MORDENT'
\\prall(?![a-zA-Z])						return 'ORN_PRALL'
\\fermata(?![a-zA-Z])						return 'ORN_FERMATA'
\\shortfermata(?![a-zA-Z])				return 'ORN_SHORTFERMATA'
\\arpeggio(?![a-zA-Z])					return 'ORN_ARPEGGIO'
\\breathe(?![a-zA-Z])						return 'ORN_BREATHE'
\\caesura(?![a-zA-Z])						return 'ORN_CAESURA'
"\\xNote"						return 'CMD_XNOTE'
"\\improvisationOn"				return 'CMD_IMPROV_ON'
"\\improvisationOff"				return 'CMD_IMPROV_OFF'
\\glissando(?![a-zA-Z])					return 'CMD_GLISSANDO'
\\breve(?![a-zA-Z])						return 'CMD_BREVE'

\\(?:fffff|ppppp|fpp|ffff|pppp|sffz|sfpp|sfzp|mfp|sff|sfp|spp|fz|pf|rf|sf|sp|n)(?![a-zA-Z])	return 'DYN_OTHER'
\\ppp(?![a-zA-Z])							return 'DYN_PPP'
\\pp(?![a-zA-Z])							return 'DYN_PP'
\\mp(?![a-zA-Z])							return 'DYN_MP'
\\mf(?![a-zA-Z])							return 'DYN_MF'
\\fff(?![a-zA-Z])							return 'DYN_FFF'
\\ff(?![a-zA-Z])							return 'DYN_FF'
\\sfz(?![a-zA-Z])							return 'DYN_SFZ'
\\rfz(?![a-zA-Z])							return 'DYN_RFZ'
\\sf(?![a-zA-Z])							return 'DYN_SF'
\\fp(?![a-zA-Z])							return 'DYN_FP'
\\p(?![a-zA-Z])							return 'DYN_P'
\\f(?![a-zA-Z])							return 'DYN_F'

"\\rest"						return 'CMD_REST'
"*"								return '*'

"\\\\\\"						return 'PART_SEP'
"\\\\"							return 'VOICE_SEP'

"tremolo"						return 'TREMOLO'

[a-g](ss|ff|s|f)?				return 'PITCH'

"'"								return 'OCT_UP'
","								return 'OCT_DOWN'

[0-9]+							return 'NUMBER'

"/"								return '/'
"#"								return '#'
"{"								return '{'
"}"								return '}'
"<"								return '<'
">"								return '>'
"|"								return '|'
"["								return '['
"]"								return ']'
"("								return '('
")"								return ')'
"~"								return '~'
"."								return '.'
"-"								return '-'
[_]								return '_'
"^"								return '^'
"!"								return '!'
":"								return ':'
"="								return '='

[rR]							return 'REST_CHAR'
[sS]							return 'SPACE_CHAR'

<<EOF>>							return 'EOF'

.								{}


<lyric>"{"						return '{'
<lyric>"}"						{ this.popState(); return '}'; }
<lyric>[ \t]+					{}
<lyric>(\r?\n)+					{}
<lyric>"--"						return 'LYRIC_HYPHEN'
<lyric>"__"						return 'LYRIC_EXTENDER'
<lyric>"_"						return 'LYRIC_SKIP'
<lyric>\"([^\"\\]|\\.)*\"		return 'LYRIC_WORD'
<lyric>[^ \t\r\n{}\"\\]+		return 'LYRIC_WORD'

<figures>"{"					return '{'
<figures>"}"					{ this.popState(); return '}'; }
<figures>[ \t]+					{}
<figures>(\r?\n)+				{}
<figures>\%.*					{}
<figures>"<"					return 'FIG_OPEN'
<figures>">"					return 'FIG_CLOSE'
<figures>[0-9]+					return 'FIG_NUMBER'
<figures>"_"					return 'FIG_BLANK'
<figures>"+"					return 'FIG_SHARP'
<figures>"-"					return 'FIG_FLAT'
<figures>"!"					return 'FIG_NATURAL'
<figures>"."					return 'FIG_DOT'
<figures>[sS]					return 'FIG_SKIP'


/lex

%start document

%%

document
	: content EOF								{ return { metadata: $1.metadata, measures: $1.measures }; }
	;

content
	: headers measures							-> ({ metadata: $1, measures: $2 })
	| headers newlines measures					-> ({ metadata: $1, measures: $3 })
	| newlines headers measures					-> ({ metadata: $2, measures: $3 })
	| newlines headers newlines measures		-> ({ metadata: $2, measures: $4 })
	| newlines measures							-> ({ metadata: undefined, measures: $2 })
	| measures									-> ({ metadata: undefined, measures: $1 })
	;

newlines
	: NEWLINE
	| newlines NEWLINE
	;

headers
	: header									-> $1
	| headers header							-> mergeHeaders($1, $2)
	| headers NEWLINE							-> $1
	| headers NEWLINE header					-> mergeHeaders($1, $3)
	;

header
	: HEADER_TITLE STRING ']'					-> ({ title: unq($2) })
	| HEADER_SUBTITLE STRING ']'				-> ({ subtitle: unq($2) })
	| HEADER_COMPOSER STRING ']'				-> ({ composer: unq($2) })
	| HEADER_ARRANGER STRING ']'				-> ({ arranger: unq($2) })
	| HEADER_LYRICIST STRING ']'				-> ({ lyricist: unq($2) })
	| HEADER_OPUS STRING ']'					-> ({ opus: unq($2) })
	| HEADER_INSTRUMENT STRING ']'				-> ({ instrument: unq($2) })
	| HEADER_INSTRUMENT_STAFF STRING ']'		-> instrumentStaff($1, unq($2))
	| HEADER_INSTRUMENT_STAFF STRING STRING ']'	-> instrumentStaff($1, unq($2), unq($3))
	| HEADER_GENRE STRING ']'					-> ({ genre: unq($2) })
	| HEADER_STAVES STRING ']'					-> ({ staves: $2.slice(1, -1) })
	| HEADER_MEASURES STRING ']'				-> ({ measureLayout: $2.slice(1, -1) })
	| HEADER_AUTOBEAM STRING ']'				-> ({ autoBeam: $2.slice(1, -1) })
	;

measures
	: measure_content							{ $$ = $1 ? [$1] : []; }
	| measures '|' measure_content				{ $$ = $3 ? $1.concat([$3]) : $1; }
	| measures '|'								{ $$ = $1; }
	;

measure_content
	: parts									%{
		// Check \partial declarations: warn if declared duration ≠ actual voice ticks
		let partialDur = null;
		outer: for (const p of $1) {
			for (const v of p.voices) {
				for (const e of v.events) {
					if (e && e.type === 'context' && e.partial) {
						partialDur = e.partial;
						break outer;
					}
				}
			}
		}
		if (partialDur) {
			const declared = durationTicks(partialDur);
			for (const p of $1) {
				for (const v of p.voices) {
					const actual = voiceEventTicks(v.events);
					if (actual > 0 && actual !== declared) {
						const durStr = partialDur.division + '.'.repeat(partialDur.dots || 0);
						const msg = `\\partial ${durStr}: declared ${declared} ticks but voice has ${actual} ticks`;
						console.warn('[lilylet] ' + msg);
						parseWarnings.push({ type: 'partial-mismatch', message: msg, declared, actual });
					}
				}
			}
		}
		$$ = measure($1, currentKey, currentTimeSig, partialDur ? true : undefined);
	%}
	;

// \addlyrics and \figures blocks after a voice's events, in any order.
annotations_opt
	: /* empty */								{ $$ = { lyrics: [], figures: [] }; }
	| annotations								{ $$ = $1; }
	;

annotations
	: addlyrics_block							{ $$ = { lyrics: [$1], figures: [] }; }
	| figures_block								{ $$ = { lyrics: [], figures: [$1] }; }
	| annotations addlyrics_block				{ $$ = { lyrics: $1.lyrics.concat([$2]), figures: $1.figures }; }
	| annotations figures_block					{ $$ = { lyrics: $1.lyrics, figures: $1.figures.concat([$2]) }; }
	| annotations NEWLINE						{ $$ = $1; }
	;

parts
	: part_voices								{ $$ = [part($1)]; }
	| parts PART_SEP part_start part_voices		{ $$ = $1.concat([part($4)]); }
	;

part_start
	: /* empty */								%{ currentStaff = 1; currentOttava = 0; %}
	;

part_voices
	: voice_block								{ $$ = [voice(currentStaff, $1.events, $1.lyrics, $1.figures)]; }
	| part_voices VOICE_SEP voice_block			{ $$ = $1.concat([voice(currentStaff, $3.events, $3.lyrics, $3.figures)]); }
	;

voice_block
	: voice_events annotations_opt				{ $$ = { events: $1, lyrics: $2.lyrics, figures: $2.figures }; }
	;

voice_events
	: /* empty */								{ $$ = []; }
	| voice_events event						{ $$ = $2 === null ? $1 : $1.concat(Array.isArray($2) ? $2 : [$2]); }
	;

event
	: note_event
	| head_shape_cmd
	| rest_event
	| context_event
	| grace_event
	| tuplet_event
	| tremolo_event
	| pitch_reset_event
	| barline_event
	| harmony_event
	| markup_event
	| dynamic_event
	;

barline_event
	: CMD_BAR STRING							-> barlineEvent($2.slice(1, -1))
	;

harmony_event
	: CMD_CHORDS STRING							-> harmonyEvent($2.slice(1, -1))
	;

markup_event
	: CMD_MARKUP STRING							-> markupEvent(unq($2))
	| '^' CMD_MARKUP STRING						-> markupEvent(unq($3), 'above')
	| '_' CMD_MARKUP STRING						-> markupEvent(unq($3), 'below')
	;

dynamic_event
	: dynamic_mark								-> dynamicEvent($1.type)
	;

pitch_reset_event
	: NEWLINE								-> { type: 'pitchReset' }
	;

note_event
	: chord duration post_events				%{ currentDuration = $2; $$ = noteEvent($1, $2, $3); %}
	| pitch duration post_events				%{ currentDuration = $2; $$ = noteEvent($1, $2, $3); %}
	| chord post_events							-> noteEvent($1, currentDuration, $2)
	| pitch post_events							-> noteEvent($1, currentDuration, $2)
	;

chord
	: '<' pitches '>'							-> $2
	;

pitches
	: pitch										{ $$ = [$1]; }
	| pitches pitch								{ $$ = $1.concat([$2]); }
	;

pitch
	: PITCH octave '!'							-> { ...parsePitch($1, $2), courtesy: true }
	| PITCH '!'								-> { ...parsePitch($1, 0), courtesy: true }
	| PITCH octave								-> parsePitch($1, $2)
	| PITCH										-> parsePitch($1, 0)
	;

octave
	: OCT_UP									-> 1
	| OCT_DOWN									-> -1
	| octave OCT_UP								-> $1 + 1
	| octave OCT_DOWN							-> $1 - 1
	;

duration
	: NUMBER dots								-> duration(Number($1), $2)
	// \breve is a breve (double whole note): 8 quarters, i.e. division 0.5.
	// It lexes as its own token, otherwise `\breve` reads as the pitches b r e v e.
	| CMD_BREVE dots							-> duration(0.5, $2)
	;

dots
	: /* empty */								{ $$ = 0; }
	| dots '.'									{ $$ = $1 + 1; }
	;

head_shape_cmd
	: CMD_XNOTE									%{ currentHeadShape = 'x'; xNotePending = true; $$ = null; %}
	| CMD_IMPROV_ON								%{ currentHeadShape = 'slash'; $$ = null; %}
	| CMD_IMPROV_OFF							%{ currentHeadShape = undefined; $$ = null; %}
	;

rest_event
	: REST_CHAR duration post_events			%{ currentDuration = $2; $$ = restEvent($2, { fullMeasure: $1 === 'R', marks: $3.length ? $3 : undefined }); %}
	| REST_CHAR duration '*' NUMBER post_events	%{ currentDuration = $2; $$ = restEvent($2, { fullMeasure: $1 === 'R', multiMeasure: Number($4), marks: $5.length ? $5 : undefined }); %}
	| SPACE_CHAR duration post_events			%{ currentDuration = $2; $$ = restEvent($2, { invisible: true, marks: $3.length ? $3 : undefined }); %}
	| REST_CHAR post_events						-> restEvent(currentDuration, { fullMeasure: true, marks: $2.length ? $2 : undefined })
	| SPACE_CHAR post_events					-> restEvent(currentDuration, { invisible: true, marks: $2.length ? $2 : undefined })
	;

context_event
	: clef_cmd									-> contextChange({ clef: $1 })
	| key_cmd									-> contextChange({ key: $1 })
	| time_cmd									-> contextChange({ time: $1 })
	| partial_cmd								-> contextChange({ partial: $1 })
	| tempo_cmd									-> contextChange({ tempo: $1 })
	| staff_cmd									-> contextChange({ staff: $1 })
	| ottava_cmd								-> contextChange({ ottava: $1 })
	| stem_cmd									-> contextChange({ stemDirection: $1 })
	| numeric_time_sig_cmd						-> null
	| default_time_sig_cmd						-> null
	| omit_cmd									-> contextChange({ omit: $1 })
	;

// \omit Score.TimeSignature / Score.BarLine hides that grob from this point on;
// \undo \omit … shows it again. `Staff.` is accepted as an alias of `Score.`:
// lilylet treats both as score-wide (serialized back as `Score.`).
omit_cmd
	: CMD_OMIT_TIME_SIG							-> ({ timeSignature: true })
	| CMD_UNDO_OMIT_TIME_SIG					-> ({ timeSignature: false })
	| CMD_OMIT_BAR_LINE							-> ({ barLine: true })
	| CMD_UNDO_OMIT_BAR_LINE					-> ({ barLine: false })
	;

clef_cmd
	: CMD_CLEF STRING							-> $2.slice(1, -1)
	;

key_cmd
	: CMD_KEY pitch_name mode					%{ currentKey = keySignature($2.phonet, $2.accidental, $3); $$ = currentKey; %}
	;

pitch_name
	: PITCH										-> parsePitchName($1)
	;

mode
	: MODE_MAJOR								-> 'major'
	| MODE_MINOR								-> 'minor'
	;

time_cmd
	: CMD_TIME NUMBER '/' NUMBER				%{
		const num = Number($2);
		const den = Number($4);
		const timeSig = fraction(num, den);
		// Add symbol for 4/4 (common) and 2/2 (cut) unless numericTimeSignature is set
		if (!numericTimeSignature) {
			if (num === 4 && den === 4) {
				timeSig.symbol = 'common';
			} else if (num === 2 && den === 2) {
				timeSig.symbol = 'cut';
			}
		}
		currentTimeSig = timeSig;
		$$ = currentTimeSig;
	%}
	;

numeric_time_sig_cmd
	: CMD_NUMERIC_TIME_SIG						%{ numericTimeSignature = true; $$ = null; %}
	;

default_time_sig_cmd
	: CMD_DEFAULT_TIME_SIG						%{ numericTimeSignature = false; $$ = null; %}
	;

partial_cmd
	: CMD_PARTIAL duration						-> $2
	;

tempo_cmd
	: CMD_TEMPO STRING duration '=' NUMBER		-> ({ text: unq($2), beat: $3, bpm: Number($5) })
	| CMD_TEMPO STRING							-> ({ text: unq($2) })
	| CMD_TEMPO duration '=' NUMBER				-> ({ beat: $2, bpm: Number($4) })
	;

staff_cmd
	: CMD_STAFF STRING							%{ currentStaff = Number($2.slice(1, -1)); $$ = currentStaff; %}
	;

ottava_cmd
	: CMD_OTTAVA '#' NUMBER						%{ currentOttava = Number($3); $$ = currentOttava; %}
	| CMD_OTTAVA '#' '-' NUMBER					%{ currentOttava = -Number($4); $$ = currentOttava; %}
	| CMD_OTTAVA								%{ currentOttava = 0; $$ = 0; %}
	;

stem_cmd
	: CMD_STEMUP								-> 'up'
	| CMD_STEMDOWN								-> 'down'
	| CMD_STEMNEUTRAL							-> 'auto'
	;

grace_event
	: CMD_GRACE '{' voice_events '}'			-> ($3.map(e => (e.type === 'note' || e.type === 'rest') ? { ...e, grace: true } : e))
	| CMD_GRACE note_event						-> ({ ...$2, grace: true })
	| CMD_GRACE rest_event						-> ({ ...$2, grace: true })
	;

tuplet_event
	: CMD_TIMES NUMBER '/' NUMBER '{' voice_events '}'		-> timesEvent(fraction(Number($2), Number($4)), $6.filter(e => e.type === 'note' || e.type === 'rest' || e.type === 'context'))
	| CMD_TUPLET NUMBER '/' NUMBER '{' voice_events '}'		-> tupletEvent(fraction(Number($4), Number($2)), $6.filter(e => e.type === 'note' || e.type === 'rest' || e.type === 'context' || e.type === 'tuplet'))
	;

tremolo_pitches
	: pitch										{ $$ = [$1]; }
	| chord										-> $1
	;

tremolo_event
	: CMD_REPEAT TREMOLO NUMBER '{' tremolo_pitches duration post_events tremolo_pitches duration post_events '}'		%{ currentDuration = $6; $$ = tremoloEvent($5, $8, Number($3), $6.division, $7, $10); %}
	| CMD_REPEAT TREMOLO NUMBER '{' tremolo_pitches duration post_events tremolo_pitches '}'				%{ currentDuration = $6; $$ = tremoloEvent($5, $8, Number($3), $6.division, $7, []); %}
	| CMD_REPEAT TREMOLO NUMBER '{' tremolo_pitches tremolo_pitches '}'							-> tremoloEvent($5, $6, Number($3), currentDuration.division)
	;

post_events
	: /* empty */								{ $$ = []; }
	| post_events post_event					{ $$ = $2 === null ? $1 : $1.concat([$2]); }
	;

post_event
	: articulation_mark
	| ornament_mark
	| dynamic_mark
	| hairpin_mark
	| pedal_mark
	| tie_mark
	| slur_mark
	| beam_mark
	| tremolo_mark
	| direction_mark
	| rest_mark
	| fingering_mark
	| fingering_number
	| navigation_mark
	| markup_mark
	| glissando_mark
	;

rest_mark
	: CMD_REST									-> ({ pitchedRest: true })
	;

articulation_mark
	: ART_STACCATO								-> articulation('staccato')
	| ART_STACCATISSIMO							-> articulation('staccatissimo')
	| ART_TENUTO								-> articulation('tenuto')
	| ART_MARCATO								-> articulation('marcato')
	| ART_ACCENT								-> articulation('accent')
	| ART_PORTATO								-> articulation('portato')
	| '-' '.'									-> articulation('staccato')
	| '-' '_'									-> articulation('portato')
	| '-' '^'									-> articulation('marcato')
	| '-' '>'									-> articulation('accent')
	| '-' '!'									-> articulation('staccatissimo')
	| '-' '-'									-> articulation('tenuto')
	| '>'										-> articulation('accent')
	| '.'										-> articulation('staccato')
	| '-'										-> articulation('tenuto')
	| '^'										-> articulation('marcato')
	| '_'										-> articulation('portato')
	;

ornament_mark
	: ORN_TRILL									-> ornament('trill')
	| ORN_TURN									-> ornament('turn')
	| ORN_MORDENT								-> ornament('mordent')
	| ORN_PRALL									-> ornament('prall')
	| ORN_FERMATA								-> ornament('fermata')
	| ORN_SHORTFERMATA							-> ornament('shortFermata')
	| ORN_ARPEGGIO								-> ornament('arpeggio')
	| ORN_BREATHE								-> ornament('breath')
	| ORN_CAESURA								-> ornament('caesura')
	;

dynamic_mark
	: DYN_PPP									-> dynamic('ppp')
	| DYN_PP									-> dynamic('pp')
	| DYN_P										-> dynamic('p')
	| DYN_MP									-> dynamic('mp')
	| DYN_MF									-> dynamic('mf')
	| DYN_F										-> dynamic('f')
	| DYN_FF									-> dynamic('ff')
	| DYN_FFF									-> dynamic('fff')
	| DYN_SFZ									-> dynamic('sfz')
	| DYN_RFZ									-> dynamic('rfz')
	| DYN_SF									-> dynamic('sf')
	| DYN_OTHER									-> dynamic($1.slice(1).toLowerCase())
	| DYN_FP									-> dynamic('fp')
	;

hairpin_mark
	: CMD_CRESC_BEGIN							%{ lastHairpin = 'crescendo'; $$ = hairpin('crescendoStart'); %}
	| CMD_DIM_BEGIN								%{ lastHairpin = 'diminuendo'; $$ = hairpin('diminuendoStart'); %}
	// `\!` ends whichever hairpin is open. LilyPond's token names no form, so the
	// type follows the hairpin last opened (\\< or \\>) — without this every `\!`
	// came out as a crescendo end and a diminuendo's stop was mismatched.
	| CMD_DYNAMICS_END							%{ $$ = hairpin(lastHairpin === 'diminuendo' ? 'diminuendoEnd' : 'crescendoEnd'); lastHairpin = undefined; %}
	;

pedal_mark
	: CMD_SUSTAINON								-> pedal('sustainOn')
	| CMD_SUSTAINOFF							-> pedal('sustainOff')
	;

tie_mark
	: '~'										-> tie(true)
	;

slur_mark
	: '('										-> slur(true)
	| ')'										-> slur(false)
	;

beam_mark
	: '['										-> beam(true)
	| ']'										-> beam(false)
	;

tremolo_mark
	: ':' NUMBER								-> ({ tremolo: Number($2) })
	;

direction_mark
	: '^' post_event							-> ({ ...$2, placement: 'above' })
	| '_' post_event							-> ({ ...$2, placement: 'below' })
	;

fingering_mark
	: '-' NUMBER								%{ const n = Number($2); if (n >= 0 && n <= 9) $$ = fingering(n); else $$ = null; %}
	;

fingering_number
	: NUMBER									%{ const n = Number($1); if (n >= 0 && n <= 9) $$ = fingering(n); else $$ = null; %}
	;

navigation_mark
	: CMD_CODA									-> navigation('coda')
	| CMD_SEGNO									-> navigation('segno')
	;

markup_mark
	: CMD_MARKUP STRING							-> markupMark(unq($2))
	;

glissando_mark
	: CMD_GLISSANDO								-> glissando()
	;

addlyrics_block
	: CMD_ADDLYRICS '{' lyric_sequence '}'		-> addlyricsLane($3)
	;

// \figures { <6 4>4 <4 3> s2 }: a LilyPond figuremode subset with its own durations.
figures_block
	: CMD_FIGURES '{' figure_sequence '}'			-> figuresLane('below', $3)
	| CMD_FIGURES_BELOW '{' figure_sequence '}'	-> figuresLane('below', $3)
	| CMD_FIGURES_ABOVE '{' figure_sequence '}'	-> figuresLane('above', $3)
	;

figure_sequence
	: /* empty */								{ $$ = []; }
	| figure_sequence figure_item				{ $$ = $1.concat([$2]); }
	;

figure_item
	: FIG_OPEN figure_lines FIG_CLOSE figure_duration_opt	-> ({ lines: $2, duration: $4 })
	| FIG_SKIP figure_duration_opt				-> ({ duration: $2 })
	;

figure_duration_opt
	: /* empty */								{ $$ = undefined; }
	| FIG_NUMBER figure_dots					-> ({ division: Number($1), dots: $2 })
	;

figure_dots
	: /* empty */								{ $$ = 0; }
	| figure_dots FIG_DOT						{ $$ = $1 + 1; }
	;

figure_lines
	: figure_line								{ $$ = [$1]; }
	| figure_lines figure_line					{ $$ = $1.concat([$2]); }
	;

figure_line
	: FIG_NUMBER figure_accidental_opt			-> ($2 ? { number: Number($1), accidental: $2 } : { number: Number($1) })
	| FIG_BLANK figure_accidental_opt			-> ($2 ? { accidental: $2 } : {})
	| figure_accidental							-> ({ accidental: $1 })
	;

figure_accidental_opt
	: /* empty */								{ $$ = undefined; }
	| figure_accidental							{ $$ = $1; }
	;

figure_accidental
	: FIG_SHARP									{ $$ = 'sharp'; }
	| FIG_FLAT									{ $$ = 'flat'; }
	| FIG_NATURAL								{ $$ = 'natural'; }
	;

lyric_sequence
	: /* empty */								{ $$ = []; }
	| lyric_sequence lyric_item					{ $$ = $1.concat([$2]); }
	;

lyric_item
	: LYRIC_WORD								-> ({ text: $1.charAt(0) === '"' ? unq($1) : $1 })
	| LYRIC_HYPHEN								-> ({ hyphen: true })
	| LYRIC_SKIP								-> ({ skip: true })
	| LYRIC_EXTENDER							-> ({ extend: true })
	;
