
%{
	const header = (name, value) => {
		switch (name) {
		case "K":
			if (typeof value === "string") {
				return {
					name,
					value: key(value),
				};
			}
		}

		return {
			name,
			value,
		};
	};


	const event = (chord, duration) => {
		return {
			chord,
			duration,
		};
	};


	const pitch = (acc, phonet, quotes) => {
		return {
			acc,
			phonet,
			quotes,
		};
	};


	const patch = (terms, bar) => {
		const control = {};
		terms.forEach(term => {
			if (term.control)
				control[term.control.name] = term.control.value;
		});

		return {
			control,
			terms,
			bar,
		};
	};


	const voice = (name, clef, properties) => ({
		name,
		clef,
		properties,
	});


	const assign = (name, value) => {
		return {
			[name]: value,
		};
	};


	const frac = (numerator, denominator) => {
		return {
			numerator,
			denominator,
		};
	};


	const articulation = (content, scope) => ({
		articulation: content,
		scope,
	});


	const tune = (header, body) => {
		const {patches} = body;
		const measures = [];
		let measure = null;
		let lastVoice = 1;
		patches.forEach(patch => {
			const voice = patch.control.V || 1;
			if (voice <= lastVoice) {
				if (measure)
					measures.push(measure);
				measure = {voices: []};
			}
			measure.voices.push(patch);
		});

		measures.push(measure);

		measures.forEach((measure, index) => measure.index = index + 1);

		return {
			header,
			body: {
				measures,
			},
		};
	};


	const grace = (events, acciaccatura) => ({
		grace: true,
		acciaccatura,
		events,
	});


	const chord = (pitches, tie) => ({
		pitches,
		tie,
	});


	const staffShift = (shift) => ({
		staffShift: shift,
	});


	const comment = (text) => ({
		comment: text,
	});


	const staffGroup = (items, bound) => ({
		items,
		bound,
	});


	const tempo = (note, bpm) => ({
		note,
		bpm,
	});


	const key = (root, mode) => ({
		root,
		mode,
	});


	const clef = clef => ({clef});


	const octaveShift = shift => ({octaveShift: shift});
%}


%lex

%option flex unicode

%x string
%x comment
%x spec_comment
%x title_string
%x key_signature
%x exclamation_exp


H									\b[A-Z](?=\:[^|])
A									\b[A-G](?=[\W\d\sA-Ga-g_zHJLMOPRSTuv]*\b)
Am									\b[A-G](?=[m][a][j]|[m][i][n]\b)
a									\b[a-g](?=[\W\d\sA-Ga-g_zHJLMOPRSTuv]*\b)
z									\b[z]
Z									\b[Z]
x									\b[x](?=[\W\d\s])
N									[0-9]
P									\b[HJLMOPRSTuv](?=[A-Ga-g][A-Ga-g0-9]*\b)
PP									\b[HJLMOPRSTuv](?=[xz!\[^_=\s"])

SPECIAL								[:!^_,'/<>={}()\[\]|.\-+~]


%%

\"									{ this.pushState('string'); return 'STR_START'; }
<string>\"							{ this.popState(); return 'STR_END'; }
<string>\\\"						return 'STR_CONTENT'
<string>[^"]+						return 'STR_CONTENT'

^[T][:][\s]*						{ this.pushState('title_string'); return 'T:'; }
^[C][:][\s]*						{ this.pushState('title_string'); return 'C:'; }
<title_string>\n					{ this.popState(); }
<title_string>[^\n]+				return 'STR_CONTENT'

^[K][:][\s]*						{ this.pushState('key_signature'); return 'K:'; }
<key_signature>"treble"				return 'TREBLE';
<key_signature>"bass"				return 'BASS';
<key_signature>"tenor"				return 'TENOR';
<key_signature>[A-G]				return 'A';
<key_signature>[b]					return 'FLAT';
<key_signature>[#]					return 'SHARP';
<key_signature>[m][a-z]*			return 'NAME';
<key_signature>[a-z]+				return 'NAME';
<key_signature>[ \t]+				{}
<key_signature>[+\-]				return yytext;
<key_signature>[0-9]				return 'N';
<key_signature>\n					{ this.popState(); }
<key_signature>\]					{ this.popState(); return ']'; }

^[%]								{ this.pushState('comment'); }
<comment>[%]						{ this.pushState('spec_comment'); }
<comment>[^\n]+						{ return 'COMMENT'; }
<spec_comment>\n					{ this.popState(); this.popState(); }
<comment>\n							{ this.popState(); }
<spec_comment>\s					{}
<spec_comment>"score"				return 'SCORE'
<spec_comment>[\w]+					return 'NN'
<spec_comment>[(){}\[\]|]			return yytext

[!]									{ this.pushState('exclamation_exp'); return '!'; }
<exclamation_exp>[!]				{ this.popState(); return '!'; }
<exclamation_exp>{SPECIAL}			return yytext
<exclamation_exp>"D.C."				return yytext
<exclamation_exp>"D.S."				return yytext
<exclamation_exp>"alcoda"			return yytext
<exclamation_exp>"alfine"			return yytext
<exclamation_exp>[8][v][ab]			return yytext
<exclamation_exp>[1][5][m][ab]		return yytext
<exclamation_exp>\b[ms]?[pf]+[z]?\b	return 'DYNAMIC'
<exclamation_exp>{a}				return 'a'
<exclamation_exp>{N}				return 'N'
<exclamation_exp>[a-zA-Z][\w-]*		return 'NAME'

\s+									{}

{SPECIAL}							return yytext

{H}									return 'H'
{A}									return 'A'
{Am}								return 'A'
{a}									return 'a'
{z}									return 'z'
{Z}									return 'Z'
{P}									return yytext
{PP}								return yytext
{x}									return 'x'
{N}									return 'N'
\b[ms]?[pf]+[z]?\b					return 'DYNAMIC'

"staff"								return 'STAFF'
"maj"								return 'MAJ'
"min"								return 'MIN'
[a-zA-Z][\w-]*						return 'NAME'

<<EOF>>								return 'EOF'


/lex

%start start_symbol

%%

start_symbol
	: tunes EOF							{ return $1; }
	;

tunes
	: tune								-> [$1]
	| tunes tune						-> [...$1, $2]
	;

tune
	: header body						-> tune($1, $2)
	;

header
	: head_lines
	;

head_lines
	: head_line							-> [$1]
	| comment							-> [$1]
	| head_lines head_line				-> [...$1, $2]
	| head_lines comment				-> [...$1, $2]
	| head_lines staff_layout_statement	-> [...$1, $2]
	| head_lines ']'					-> $1
	| head_lines '}'					-> $1
	| head_lines ')'					-> $1
	;

comment
	: COMMENT							-> comment($1)
	;

staff_layout_statement
	: 'SCORE' staff_layout				-> $2
	;

staff_layout
	: staff_layout_items				-> ({staffLayout: $1})
	;

staff_layout_items
	: staff_layout_item						-> [$1]
	| staff_layout_items staff_layout_item	-> [...$1, $2]
	| staff_layout_items '|'				-> $1
	;

staff_layout_item
	: NN								-> staffGroup([$1])
	| '(' staff_layout_items ')'		-> staffGroup($2, 'arc')
	| '[' staff_layout_items ']'		-> staffGroup($2, 'square')
	| '{' staff_layout_items '}'		-> staffGroup($2, 'curly')
	| '[' staff_layout_items '}'		-> staffGroup($2, 'square')
	| '{' staff_layout_items ']'		-> staffGroup($2, 'curly')
	;

head_line
	: 'T:' string_content				-> header('T', $2)
	| 'C:' string_content				-> header('C', $2)
	| 'K:' key_signature				-> header('K', $2)
	| H ':' header_value				-> header($1, $3)
	;

header_value
	: string
	| number
	| frac
	| numeric_tempo
	| upper_phonet
	| voice_exp
	| staff_shift
	| NAME
	| key_signature
	| clef
	;

staff_shift
	: 'STAFF' plus_minus_number			-> staffShift($2)
	| NAME plus_minus_number			-> staffShift($2)
	;

key_signature
	: A									-> key($1, null)
	| A sharp_or_flat					-> key($1 + $2, null)
	| A key_mode						-> key($1, $2)
	| A sharp_or_flat key_mode			-> key($1 + $2, $3)
	;

clef
	: TREBLE							-> clef($1)
	| BASS								-> clef($1)
	| TENOR								-> clef($1)
	;

sharp_or_flat
	: SHARP								-> '#'
	| FLAT								-> 'b'
	;

key_mode
	: MAJ								-> 'major'
	| MIN								-> 'minor'
	| NAME								-> $1.startsWith("ma") ? "major" : "minor"
	;

plus_minus_number
	: '+' number						-> Number($2)
	| '-' number						-> -Number($2)
	;

string
	: STR_START string_content STR_END	-> $2
	;

string_content
	: %empty							-> ""
	| string_content STR_CONTENT		-> $1 ? $1 + $2 : $2
	;

body
	: patches							-> ({patches: $1})
	;

frac
	: number '/' number					-> frac($1, $3)
	;

number
	: N									-> Number($1)
	| number N							-> $1 * 10 + Number($2)
	;

numeric_tempo
	: frac '=' number					-> tempo($1, $3)
	;

voice_exp
	: number							-> voice($1)
	| number NAME						-> voice($1, $2)
	| number NAME assigns				-> voice($1, $2, $3)
	| NAME								-> voice(1, $1)
	| NAME assigns						-> voice(1, $1, $2)
	;

assigns
	: assign							-> $1
	| assigns assign					-> ({...$1, ...$2})
	;

assign
	: NAME '=' assign_value				-> assign($1, $3)
	;

assign_value
	: string
	| number
	| plus_minus_number
	| NAME
	;

upper_phonet
	: A
	;

lower_phonet
	: a
	;

patches
	: patch								-> [$1]
	| bar patch							-> [$2]
	| patches patch						-> [...$1, $2]
	| patches comment					-> $1
	| tailless_patch					-> [$1]
	| patches tailless_patch			-> [...$1, $2]
	| patches ']'						-> $1
	| patches '}'						-> $1
	;

patch
	: music bar							-> patch($1, $2)
	;

tailless_patch
	: music								-> patch($1, null)
	;

bar
	: '|'								-> '|'
	| '|' ':'							-> '|:'
	| ':' '|'							-> ':|'
	| ':' ':'							-> ':|:'
	| ':' '|' ':'						-> ':|:'
	| ':' '|' '|' ':'					-> ':|:'
	| '|' '|'							-> '||'
	| '|' ']'							-> '|]'
	| ':' '|' ']'						-> ':|]'
	| '|' N								-> '|' + $2
	| ':' '|' N							-> ':|' + $2
	;

music
	: %empty
	| music expressive_mark				-> $1 ? [...$1, $2] : [$2]
	| music text						-> $1 ? [...$1, $2] : [$2]
	| music event						-> $1 ? [...$1, $2] : [$2]
	| music grace_events				-> $1 ? [...$1, $2] : [$2]
	| music control						-> $1 ? [...$1, $2] : [$2]
	| music broken_rhythm				{ Object.assign($1.at(-1), $2); $$ = $1; }
	| music triplet						-> $1 ? [...$1, $2] : [$2]
	| music N							-> $1
	| music NAME						-> $1
	| music '^' NAME					-> $1
	| music '^'							-> $1
	;

control
	: '[' H ':' header_value ']'		-> ({control: header($2, $4)})
	| '[' 'K:' header_value ']'			-> ({control: header("K", $3)})
	| '[' NAME ':' header_value ']'		-> ({control: header($2, $4)})
	;

expressive_mark
	: articulation
	| '('								-> ({express: $1})
	| ')'								-> ({express: $1})
	| '.'								-> ({express: $1})
	| '-'								-> ({express: $1})
	| 'O'								-> ({express: "coda"})
	| 'S'								-> ({express: "segno"})
	;

articulation
	: '!' articulation_content '!' 		-> $2
	| '!' directive_text '!' 			-> $2
	| 'P'								-> articulation("prall")
	| 'T'								-> articulation("trill")
	| 'H'								-> articulation("fermata")
	| 'J'								-> articulation("slide")
	| 'L'								-> articulation("accent")
	| 'M'								-> articulation("mordent")
	| 'R'								-> articulation("roll")
	| 'u'								-> articulation("upbow")
	| 'v'								-> articulation("downbow")
	| '~'								-> articulation("mordent")
	;

articulation_content
	: scope_articulation				-> articulation($1)
	| scope_articulation parenthese		-> articulation($1, $2)
	| DYNAMIC							-> articulation($1)
	| a									-> articulation($1)
	| "^"								-> articulation($1)
	| fingering_numbers					-> ({fingering: Number($1)})
	| tremolo							-> ({tremolo: $1})
	| tremolo '-'						-> ({tremolo: $1})	// unknown meaning of '-'?
	;

fingering_numbers
	: N									-> String($1)
	| fingering_numbers N				-> $1 + $2
	;

tremolo
	: '/'								-> 1
	| tremolo '/'						-> $1 + 1
	;

directive_text
	: dc								-> ({directive: $1})
	| dc al								-> ({directive: `${$1} ${$2}`})
	| octave_shift "("					-> octaveShift($1)
	| octave_shift ")"					-> octaveShift(0)
	;

octave_shift
	: "8va"								-> -1
	| "8vb"								-> 1
	| "15ma"							-> -2
	| "15mb"							-> 2
	;

dc
	: "D.C."
	| "D.S."
	;

al
	: "alcoda"							-> "al coda"
	| "alfine"							-> "al fine"
	;

scope_articulation
	: '<'
	| '>'
	| NAME
	;

parenthese
	: '('
	| ')'
	;

text
	: string							-> ({text: $1})
	;

pitch_or_chord
	: pitch								-> chord([$1])
	| chord
	| accidentals chord					-> $2
	;

chord
	: '[' pitches ']'					-> chord($2)
	| '[' ')' ']'						-> chord([])
	| '[' ')'							-> chord([])
	;

pitches
	: pitch								-> [$1]
	| pitches pitch						-> [...$1, $2]
	| '.' pitch							-> [$2]
	| pitches '.' pitch					-> [...$1, $3]
	| '[' pitch							-> [$2]
	| pitches '[' pitch					-> [...$1, $3]
	| pitches '.' '[' pitch				-> [...$1, $4]
	| '.' '[' pitch						-> [$3]
	| pitches ')'						-> $1
	;

quotes
	: sub_quotes
	| sup_quotes
	;

sub_quotes
	: ','								-> -1
	| sub_quotes ','					-> $1 - 1
	;

sup_quotes
	: "'"								-> 1
	| sup_quotes "'"					-> $1 + 1
	;

accidentals
	: '^'								-> 1
	| '_'								-> -1
	| '='								-> 0
	| '^' '^'							-> 2
	| '_' '_'							-> -2
	| '=' '='							-> 0
	;

pitch
	: acc_pitch
	| acc_pitch '-'						{ $1.tie = true; $$ = $1; }
	| rest_phonet						-> pitch(null, $1, 0)
	;

acc_pitch
	: phonet							-> pitch(null, $1, 0)
	| phonet quotes						-> pitch(null, $1, $2)
	| accidentals phonet				-> pitch($1, $2, 0)
	| accidentals phonet quotes			-> pitch($1, $2, $3)
	;

phonet
	: upper_phonet
	| lower_phonet
	;

rest_phonet
	: z
	| Z
	| x
	;

event
	: pitch_or_chord					-> ({event: event($1)})
	| pitch_or_chord duration			-> ({event: event($1, $2)})
	;

events
	: event								-> [$1]
	| events event						-> [...$1, $2]
	;

grace_events
	: '{' grace_music '}'					-> grace($2)
	| '{' '/' grace_music '}'				-> grace($3, true)
	;

grace_music
	: event								-> [$1]
	| expressive_mark event				-> [$1, $2]
	| grace_music event					-> [...$1, $2]
	| grace_music expressive_mark		-> [...$1, $2]
	| grace_music control				-> [...$1, $2]
	| control event						-> [$1, $2]
	;

duration
	: number '/' number					-> frac(Number($1), Number($3))
	| '/' number						-> frac(1, Number($2))
	| number							-> frac(Number($1))
	| '/'								-> frac(1, 2)
	;

broken_rhythm
	: broken_right						-> ({broken: $1})
	| broken_left						-> ({broken: $1})
	;

broken_right
	: '>'								-> 1
	| broken_right '>'					-> $1 + 1
	;

broken_left
	: '<'								-> -1
	| broken_left '<'					-> $1 - 1
	;

triplet
	: '(' number ':' number ':' number	-> ({triplet: $2, multiplier: $4, n: $6})
	| '(' number ':' number				-> ({triplet: $2, multiplier: $4})
	| '(' number						-> ({triplet: $2})
	;
