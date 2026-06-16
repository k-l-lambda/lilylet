// General MIDI program lookup: instrument name → GM program number (0–127).
//
// Verovio's MIDI export honors ONLY the numeric `@midi.instrnum` on an MEI
// <instrDef> (the GM-name attribute `@midi.instrname` is parsed but never used
// for MIDI). lilylet already carries human instrument names (from ABC voice
// names, MusicXML part names, etc.) in metadata.instruments; this table maps
// those names to GM programs so the MEI encoder can emit <instrDef midi.instrnum>
// and multi-instrument scores get distinct timbres instead of all-piano.
//
// The name set is seeded from the notagen dataset (Piano, Violins, Viola,
// Violoncellos, Oboe, Horn, Flute, Clarinet, Bassoon, Violin, Trombone,
// Timpani, Voice, Bass, Trumpet, Harp, Contrabasses, Vocal, Organ, …) plus
// common GM aliases, then matched through a normalizer that handles plurals
// ("Violins" → violin) and trailing part numbers ("Violin I", "Horn 2").

// Normalized name → GM program (0-based). Keys are lowercase, singular,
// whitespace-collapsed. Plural/number variants are resolved by the normalizer.
const GM_PROGRAMS: { [name: string]: number } = {
	// Piano (0–7)
	"piano": 0,
	"acoustic grand piano": 0,
	"grand piano": 0,
	"bright acoustic piano": 1,
	"electric piano": 4,
	"harpsichord": 6,
	"clavichord": 7,
	"clavi": 7,
	// Chromatic percussion (8–15)
	"celesta": 8,
	"glockenspiel": 9,
	"music box": 10,
	"vibraphone": 11,
	"marimba": 12,
	"xylophone": 13,
	"tubular bells": 14,
	"dulcimer": 15,
	// Organ (16–23)
	"organ": 19,
	"hammond organ": 16,
	"percussive organ": 17,
	"rock organ": 18,
	"church organ": 19,
	"pipe organ": 19,
	"reed organ": 20,
	"accordion": 21,
	"harmonica": 22,
	// Guitar (24–31)
	"guitar": 24,
	"acoustic guitar": 24,
	"nylon guitar": 24,
	"steel guitar": 25,
	"electric guitar": 27,
	"guitarre": 24,			// fr./de. guitar
	"gitarre": 24,			// de.
	"chitarra": 24,			// it.
	// Bass (32–39) — orchestral "Bass" means double bass (Contrabass, 43); the
	// electric/acoustic bass-guitar programs live here but are not the default.
	"acoustic bass": 32,
	"electric bass": 33,
	"fretless bass": 35,
	"basso": 43,			// it. bass → double bass
	"basse": 43,			// fr.
	"bassi": 43,			// it. pl.
	"bas": 43,			// de./nl. abbrev
	// Strings (40–47)
	"violin": 40,
	"viola": 41,
	"cello": 42,
	"violoncello": 42,
	"contrabass": 43,
	"double bass": 43,
	"bass": 43,
	"tremolo strings": 44,
	"pizzicato strings": 45,
	"harp": 46,
	"orchestral harp": 46,
	"timpani": 47,
	// Ensemble (48–55)
	"strings": 48,
	"string ensemble": 48,
	"string orchestra": 48,
	"synth strings": 50,
	"voice": 52,
	"vocal": 52,
	"voices": 52,
	"choir": 52,
	"choir aahs": 52,
	"soprano": 52,
	"alto": 52,
	"tenor": 52,
	"bass voice": 52,
	"orchestra hit": 55,
	// Brass (56–63)
	"trumpet": 56,
	"trombone": 57,
	"tuba": 58,
	"muted trumpet": 59,
	"horn": 60,
	"french horn": 60,
	"brass": 61,
	"brass section": 61,
	// Reed (64–71)
	"soprano sax": 64,
	"alto sax": 65,
	"tenor sax": 66,
	"baritone sax": 67,
	"saxophone": 66,
	"sax": 66,
	"oboe": 68,
	"english horn": 69,
	"cor anglais": 69,
	"bassoon": 70,
	"clarinet": 71,
	// Pipe (72–79)
	"piccolo": 72,
	"flute": 73,
	"recorder": 74,
	"pan flute": 75,

	// --- Foreign-language names, abbreviations and common spelling variants,
	// harvested from the notagen corpus. Mapped to the nearest GM program.
	// Keyboard
	"pianoforte": 0,
	"fortepiano": 0,
	"klavier": 0,
	"keyboard": 0,
	"cembalo": 6,			// it. harpsichord
	"clavicembalo": 6,
	"harpichord": 6,		// misspelling
	"organo": 19,			// it. organ
	"orgel": 19,			// de. organ
	// Strings (it./de./fr./variants)
	"violino": 40,
	"violini": 40,
	"violine": 40,			// de.
	"violinen": 40,
	"violon": 40,			// fr.
	"violons": 40,
	"violn": 40,			// abbrev/OCR variant
	"violno": 40,			// OCR variant
	"viole": 41,			// it. violas (also fr. "viole")
	"bratsche": 41,			// de. viola
	"celli": 42,
	"violoncelli": 42,
	"violoncelle": 42,		// fr.
	"violoncelles": 42,
	"violonchelo": 42,		// es.
	"soloncello": 42,		// OCR variant of violoncello
	"gambe": 42,			// fr. viola da gamba
	"gamba": 42,			// viola da gamba ≈ cello
	"viola da gamba": 42,
	"contrabasso": 43,		// it.
	"contrabassi": 43,
	"contrabbasso": 43,		// it.
	"contra-basso": 43,
	"contrabajo": 43,		// es.
	"kontrabass": 43,		// de.
	"kontrabasse": 43,		// de. pl.
	"kontrabasso": 43,
	"contrebasse": 43,		// fr.
	"violone": 43,			// large bass viol ≈ contrabass
	"arpa": 46,			// it./es. harp
	"harfe": 46,			// de. harp
	"pauken": 47,			// de. timpani
	// Voice (it./de./fr.)
	"canto": 52,			// it.
	"coro": 52,			// it. choir
	"chorus": 52,
	"chorale": 52,
	"sopran": 52,			// de.
	"contralto": 52,		// it. alto
	"tenore": 52,			// it.
	"tenori": 52,
	"gesang": 52,			// de. voice
	"singstimme": 52,		// de. voice
	"voce": 52,			// it.
	"voix": 52,			// fr.
	"chanto": 52,			// OCR variant of canto
	"women": 52,			// women's voices
	"contra-fagotto": 70,	// hyphenated contrabassoon ≈ bassoon
	// Brass
	"tromboni": 57,			// it. trombones
	"posaune": 57,			// de. trombone
	"posaunen": 57,
	"trombe": 56,			// it. trumpets
	"tromba": 56,			// it. trumpet
	"trompete": 56,			// de. trumpet
	"trompeten": 56,
	"trompette": 56,		// fr. trumpet
	"cornetto": 56,			// historical cornett ≈ trumpet
	"cornettino": 56,
	"corno": 60,			// it. horn
	"corni": 60,			// it. horns
	// Reed (it./de./fr.)
	"oboi": 68,			// it. oboes
	"oboen": 68,			// de.
	"hautbois": 68,			// fr. oboe
	"corno inglese": 69,		// it. english horn
	"inglese": 69,			// "corno inglese" trailing word fallback also covers it
	"ingles": 69,			// es. variant
	"fagotto": 70,			// it. bassoon
	"fagotti": 70,
	"fagott": 70,			// de.
	"fagotte": 70,			// de. pl.
	"fagot": 70,			// es.
	"basson": 70,			// fr. bassoon
	"bassons": 70,
	"contrafagotto": 70,		// it. contrabassoon ≈ bassoon timbre
	"contrabassoon": 70,
	"klarinette": 71,		// de. clarinet
	"clarinetto": 71,		// it.
	"clarinetti": 71,
	"clarinette": 71,		// fr.
	// Pipe (it./de.)
	"flauto": 73,			// it. flute
	"flauti": 73,			// it. flutes
	"flote": 73,			// de. Flöte (diacritics stripped by the normalizer)
	"floten": 73,			// de. Flöten
	"traverso": 73,			// baroque transverse flute
	"flauto traverso": 73,
};

// Normalize an instrument name for lookup: lowercase, turn literal "\n" escapes
// and real newlines into spaces, strip diacritics (Flöte→flote, Hautböis→...),
// drop a trailing part designator (roman numeral or arabic number — "Violin I",
// "Horn 2", "Oboe II"), collapse whitespace.
const normalizeInstrumentName = (raw: string): string => {
	let s = raw.toLowerCase().trim();
	s = s.replace(/\\n/g, " ");		// literal backslash-n escape → space
	s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");	// strip diacritics
	s = s.replace(/\s+/g, " ").trim();
	s = s.replace(/\s+(?:[ivx]+|\d+)\.?$/i, "").trim();
	return s;
};

// Choral single-letter voice-part abbreviations → "Voice" (GM 52). Matched ONLY
// against the whole name, never per-word: a bare "S"/"A"/"T"/"B" staff label in a
// chorale means Soprano/Alto/Tenor/Bass, but the same letters appear as key
// designators in "Clarinet in B", "Horn in F", "Trumpet in C" — so these must not
// enter GM_PROGRAMS where the word-scan would misread them.
const SATB_VOICE: { [letter: string]: number } = {
	"s": 52,
	"a": 52,
	"t": 52,
	"b": 52,
};

// Look up a single normalized name: exact match, else de-pluralized
// ("violins"→violin, "violoncellos"→violoncello, "contrabasses"→contrabass),
// else with a trailing attached part-number stripped ("violin1"→violin,
// "violino2"→violino).
const lookupNormalized = (norm: string): number | undefined => {
	if (norm in GM_PROGRAMS)
		return GM_PROGRAMS[norm];
	// Try "-es" before "-s".
	if (norm.endsWith("es")) {
		const sing = norm.slice(0, -2);
		if (sing in GM_PROGRAMS)
			return GM_PROGRAMS[sing];
	}
	if (norm.endsWith("s")) {
		const sing = norm.slice(0, -1);
		if (sing in GM_PROGRAMS)
			return GM_PROGRAMS[sing];
	}
	// Attached trailing digits ("violin1", "violino2"): strip and retry.
	const deNum = norm.replace(/\d+$/, "");
	if (deNum !== norm && deNum in GM_PROGRAMS)
		return GM_PROGRAMS[deNum];
	return undefined;
};

// Resolve an instrument name to a GM program number (0–127), or undefined if no
// confident match (caller then omits <instrDef>, leaving Verovio's default).
//
// Match priority: the full normalized string first (including the SATB
// single-letter voice abbreviations), then individual words from the last toward
// the first. Multi-word names ("Singstimme Voice", "First Violins", "Solo Flute")
// usually put the instrument at the end, so the trailing word is tried before
// earlier qualifier words. Each word attempt runs through the de-plural path
// (lookupNormalized); SATB letters are intentionally NOT part of the word scan.
export const gmProgramOf = (name: string | undefined | null): number | undefined => {
	if (!name)
		return undefined;

	const norm = normalizeInstrumentName(name);
	const direct = lookupNormalized(norm);
	if (direct !== undefined)
		return direct;

	// Whole-name-only: a lone S/A/T/B is a chorale voice part.
	if (norm in SATB_VOICE)
		return SATB_VOICE[norm];

	const words = norm.split(" ");
	if (words.length > 1) {
		for (let i = words.length - 1; i >= 0; i--) {
			const hit = lookupNormalized(words[i]);
			if (hit !== undefined)
				return hit;
		}
	}

	return undefined;
};
