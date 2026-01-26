
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

	const voice = (staff, events) => ({
		staff: staff || 1,
		events,
	});

	const part = (voices, name) => ({
		name: name || undefined,
		voices,
	});

	const measure = (parts, key, timeSig, partial) => ({
		key: key || undefined,
		timeSig: timeSig || undefined,
		parts,
		partial: partial || undefined,
	});

	const tupletEvent = (ratio, events) => ({
		type: 'tuplet',
		ratio,
		events,
	});

	const tremoloEvent = (pitchA, pitchB, count, division) => ({
		type: 'tremolo',
		pitchA,
		pitchB,
		count,
		division,
	});

	// Articulation/mark helpers
	const articulation = (type, placement) => ({ type, placement });
	const ornament = (type) => ({ type });
	const dynamic = (type) => ({ type });
	const hairpin = (type) => ({ type });
	const pedal = (type) => ({ type });
	const tie = (start) => ({ markType: 'tie', start });
	const slur = (start) => ({ markType: 'slur', start });
	const beam = (start) => ({ markType: 'beam', start });

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

	// Reset parser state - call before each parse
	const resetParserState = () => {
		currentStaff = 1;
		currentKey = null;
		currentTimeSig = null;
		currentDuration = { division: 4, dots: 0 };
	};

	// Export reset function
	parser.resetState = resetParserState;
%}


%lex

%option flex unicode case-insensitive


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
\[instrument					return 'HEADER_INSTRUMENT'
\[genre							return 'HEADER_GENRE'
\]								return ']'

\"[^"]*\"						return 'STRING'

"\\clef"						return 'CMD_CLEF'
"\\key"							return 'CMD_KEY'
"\\time"						return 'CMD_TIME'
"\\tempo"						return 'CMD_TEMPO'
"\\staff"						return 'CMD_STAFF'
"\\grace"						return 'CMD_GRACE'
"\\times"						return 'CMD_TIMES'
"\\repeat"						return 'CMD_REPEAT'
"\\ottava"						return 'CMD_OTTAVA'
"\\stemUp"						return 'CMD_STEMUP'
"\\stemDown"					return 'CMD_STEMDOWN'
"\\stemNeutral"					return 'CMD_STEMNEUTRAL'

"\\major"						return 'MODE_MAJOR'
"\\minor"						return 'MODE_MINOR'

"\\sustainOn"					return 'CMD_SUSTAINON'
"\\sustainOff"					return 'CMD_SUSTAINOFF'

"\\<"							return 'CMD_CRESC_BEGIN'
"\\>"							return 'CMD_DIM_BEGIN'
"\\!"							return 'CMD_DYNAMICS_END'

"\\staccato"					return 'ART_STACCATO'
"\\staccatissimo"				return 'ART_STACCATISSIMO'
"\\tenuto"						return 'ART_TENUTO'
"\\marcato"						return 'ART_MARCATO'
"\\accent"						return 'ART_ACCENT'
"\\portato"						return 'ART_PORTATO'

"\\trill"						return 'ORN_TRILL'
"\\turn"						return 'ORN_TURN'
"\\mordent"						return 'ORN_MORDENT'
"\\prall"						return 'ORN_PRALL'
"\\fermata"						return 'ORN_FERMATA'
"\\shortfermata"				return 'ORN_SHORTFERMATA'
"\\arpeggio"					return 'ORN_ARPEGGIO'

"\\ppp"							return 'DYN_PPP'
"\\pp"							return 'DYN_PP'
"\\mp"							return 'DYN_MP'
"\\mf"							return 'DYN_MF'
"\\fff"							return 'DYN_FFF'
"\\ff"							return 'DYN_FF'
"\\sfz"							return 'DYN_SFZ'
"\\rfz"							return 'DYN_RFZ'
"\\sf"							return 'DYN_SF'
"\\p"							return 'DYN_P'
"\\f"							return 'DYN_F'

"\\rest"						return 'CMD_REST'

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
"_"								return '_'
"^"								return '^'
"!"								return '!'
":"								return ':'
"="								return '='

[rR]							return 'REST_CHAR'
[sS]							return 'SPACE_CHAR'

<<EOF>>							return 'EOF'

.								{}


/lex

%start document

%%

document
	: content EOF								{ return { metadata: $1.metadata, measures: $1.measures }; }
	;

content
	: headers measures							-> ({ metadata: $1, measures: $2 })
	| headers newlines measures					-> ({ metadata: $1, measures: $3 })
	| newlines measures							-> ({ metadata: undefined, measures: $2 })
	| measures									-> ({ metadata: undefined, measures: $1 })
	;

newlines
	: NEWLINE
	| newlines NEWLINE
	;

headers
	: header									-> $1
	| headers header							-> ({ ...$1, ...$2 })
	| headers NEWLINE							-> $1
	| headers NEWLINE header					-> ({ ...$1, ...$3 })
	;

header
	: HEADER_TITLE STRING ']'					-> ({ title: $2.slice(1, -1) })
	| HEADER_SUBTITLE STRING ']'				-> ({ subtitle: $2.slice(1, -1) })
	| HEADER_COMPOSER STRING ']'				-> ({ composer: $2.slice(1, -1) })
	| HEADER_ARRANGER STRING ']'				-> ({ arranger: $2.slice(1, -1) })
	| HEADER_LYRICIST STRING ']'				-> ({ lyricist: $2.slice(1, -1) })
	| HEADER_OPUS STRING ']'					-> ({ opus: $2.slice(1, -1) })
	| HEADER_INSTRUMENT STRING ']'				-> ({ instrument: $2.slice(1, -1) })
	| HEADER_GENRE STRING ']'					-> ({ genre: $2.slice(1, -1) })
	;

measures
	: measure_content							{ $$ = [$1]; }
	| measures '|' measure_content				{ $$ = $1.concat([$3]); }
	| measures '|'								{ $$ = $1; }
	;

measure_content
	: parts										-> measure($1, currentKey, currentTimeSig)
	;

parts
	: part_voices								{ $$ = [part($1)]; }
	| parts PART_SEP part_start part_voices		{ $$ = $1.concat([part($4)]); }
	;

part_start
	: /* empty */								%{ currentStaff = 1; %}
	;

part_voices
	: voice_events								{ $$ = [voice(currentStaff, $1)]; }
	| part_voices VOICE_SEP voice_events		{ $$ = $1.concat([voice(currentStaff, $3)]); }
	;

voice_events
	: /* empty */								{ $$ = []; }
	| voice_events event						{ $$ = $1.concat([$2]); }
	;

event
	: note_event
	| rest_event
	| context_event
	| grace_event
	| tuplet_event
	| tremolo_event
	| pitch_reset_event
	;

pitch_reset_event
	: NEWLINE							-> ({ type: 'pitchReset' })
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
	: PITCH octave								-> parsePitch($1, $2)
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
	;

dots
	: /* empty */								{ $$ = 0; }
	| dots '.'									{ $$ = $1 + 1; }
	;

rest_event
	: REST_CHAR duration post_events			%{ currentDuration = $2; $$ = restEvent($2, { fullMeasure: $1 === 'R' }); %}
	| SPACE_CHAR duration post_events			%{ currentDuration = $2; $$ = restEvent($2, { invisible: true }); %}
	| REST_CHAR post_events						-> restEvent(currentDuration, { fullMeasure: $1 === 'R' })
	| SPACE_CHAR post_events					-> restEvent(currentDuration, { invisible: true })
	;

context_event
	: clef_cmd									-> contextChange({ clef: $1 })
	| key_cmd									-> contextChange({ key: $1 })
	| time_cmd									-> contextChange({ time: $1 })
	| tempo_cmd									-> contextChange({ tempo: $1 })
	| staff_cmd									-> contextChange({ staff: $1 })
	| ottava_cmd								-> contextChange({ ottava: $1 })
	| stem_cmd									-> contextChange({ stemDirection: $1 })
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
	: CMD_TIME NUMBER '/' NUMBER				%{ currentTimeSig = fraction(Number($2), Number($4)); $$ = currentTimeSig; %}
	;

tempo_cmd
	: CMD_TEMPO STRING duration '=' NUMBER		-> ({ text: $2.slice(1, -1), beat: $3, bpm: Number($5) })
	| CMD_TEMPO STRING							-> ({ text: $2.slice(1, -1) })
	| CMD_TEMPO duration '=' NUMBER				-> ({ beat: $2, bpm: Number($4) })
	;

staff_cmd
	: CMD_STAFF STRING							%{ currentStaff = Number($2.slice(1, -1)); $$ = currentStaff; %}
	;

ottava_cmd
	: CMD_OTTAVA '#' NUMBER						-> Number($3)
	| CMD_OTTAVA '#' '-' NUMBER					-> -Number($4)
	| CMD_OTTAVA								-> 0
	;

stem_cmd
	: CMD_STEMUP								-> 'up'
	| CMD_STEMDOWN								-> 'down'
	| CMD_STEMNEUTRAL							-> 'auto'
	;

grace_event
	: CMD_GRACE '{' voice_events '}'			-> ({ type: 'note', pitches: $3.filter(e => e.type === 'note').flatMap(e => e.pitches), duration: $3.find(e => e.type === 'note')?.duration || { division: 8, dots: 0 }, grace: true, marks: $3.filter(e => e.type === 'note').flatMap(e => e.marks || []) })
	| CMD_GRACE note_event						-> ({ ...$2, grace: true })
	| CMD_GRACE rest_event						-> ({ ...$2, grace: true })
	;

tuplet_event
	: CMD_TIMES NUMBER '/' NUMBER '{' voice_events '}'		-> tupletEvent(fraction(Number($2), Number($4)), $6.filter(e => e.type === 'note' || e.type === 'rest'))
	;

tremolo_event
	: CMD_REPEAT TREMOLO NUMBER '{' pitch duration pitch duration '}'		-> tremoloEvent([$5], [$7], Number($3), $6.division)
	;

post_events
	: /* empty */								{ $$ = []; }
	| post_events post_event					{ $$ = $1.concat([$2]); }
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
	| '!'										-> articulation('staccatissimo')
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
	| DYN_SF									-> dynamic('sfz')
	;

hairpin_mark
	: CMD_CRESC_BEGIN							-> hairpin('crescendoStart')
	| CMD_DIM_BEGIN								-> hairpin('diminuendoStart')
	| CMD_DYNAMICS_END							-> hairpin('crescendoEnd')
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
