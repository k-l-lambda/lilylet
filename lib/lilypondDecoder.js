"use strict";
/**
 * LilyPond to Lilylet Decoder
 *
 * Converts LilyPond notation files to Lilylet document format using the lotus parser.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getParser = exports.parseLilyDocument = exports.decodeFromDocument = exports.decodeFile = exports.decode = void 0;
// Import directly from the compiled lib directory to avoid ESM issues
const lilyParser = __importStar(require("@k-l-lambda/lotus/lib/inc/lilyParser"));
// Lazy-loaded parser instance
let parserPromise = null;
const getParser = async () => {
    if (!parserPromise) {
        // Load jison parser directly
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const Jison = (await Promise.resolve().then(() => __importStar(require('jison')))).default;
        const jisonPath = path.join(path.dirname(require.resolve('@k-l-lambda/lotus/package.json')), 'jison/lilypond.jison');
        const grammar = fs.readFileSync(jisonPath, 'utf-8');
        const parser = new Jison.Parser(grammar);
        parserPromise = Promise.resolve(parser);
    }
    return parserPromise;
};
exports.getParser = getParser;
const types_1 = require("./types");
// Phonet names mapping
const PHONET_NAMES = {
    0: types_1.Phonet.c,
    1: types_1.Phonet.d,
    2: types_1.Phonet.e,
    3: types_1.Phonet.f,
    4: types_1.Phonet.g,
    5: types_1.Phonet.a,
    6: types_1.Phonet.b,
};
// Alter value to accidental
const ALTER_TO_ACCIDENTAL = {
    [-2]: types_1.Accidental.doubleFlat,
    [-1]: types_1.Accidental.flat,
    [0]: types_1.Accidental.natural,
    [1]: types_1.Accidental.sharp,
    [2]: types_1.Accidental.doubleSharp,
};
// LilyPond clef names to Lilylet clef
const LILYPOND_CLEF_MAP = {
    treble: types_1.Clef.treble,
    G: types_1.Clef.treble,
    bass: types_1.Clef.bass,
    F: types_1.Clef.bass,
    alto: types_1.Clef.alto,
    C: types_1.Clef.alto,
};
// Key signature fifths to pitch/accidental mapping
const KEY_FIFTHS_MAP = {
    [-7]: { pitch: types_1.Phonet.c, accidental: types_1.Accidental.flat, mode: 'major' },
    [-6]: { pitch: types_1.Phonet.g, accidental: types_1.Accidental.flat, mode: 'major' },
    [-5]: { pitch: types_1.Phonet.d, accidental: types_1.Accidental.flat, mode: 'major' },
    [-4]: { pitch: types_1.Phonet.a, accidental: types_1.Accidental.flat, mode: 'major' },
    [-3]: { pitch: types_1.Phonet.e, accidental: types_1.Accidental.flat, mode: 'major' },
    [-2]: { pitch: types_1.Phonet.b, accidental: types_1.Accidental.flat, mode: 'major' },
    [-1]: { pitch: types_1.Phonet.f, mode: 'major' },
    [0]: { pitch: types_1.Phonet.c, mode: 'major' },
    [1]: { pitch: types_1.Phonet.g, mode: 'major' },
    [2]: { pitch: types_1.Phonet.d, mode: 'major' },
    [3]: { pitch: types_1.Phonet.a, mode: 'major' },
    [4]: { pitch: types_1.Phonet.e, mode: 'major' },
    [5]: { pitch: types_1.Phonet.b, mode: 'major' },
    [6]: { pitch: types_1.Phonet.f, accidental: types_1.Accidental.sharp, mode: 'major' },
    [7]: { pitch: types_1.Phonet.c, accidental: types_1.Accidental.sharp, mode: 'major' },
};
// Articulation mapping from LilyPond
const ARTICULATION_MAP = {
    staccato: types_1.ArticulationType.staccato,
    staccatissimo: types_1.ArticulationType.staccatissimo,
    tenuto: types_1.ArticulationType.tenuto,
    marcato: types_1.ArticulationType.marcato,
    accent: types_1.ArticulationType.accent,
    portato: types_1.ArticulationType.portato,
};
// Ornament mapping from LilyPond
const ORNAMENT_MAP = {
    trill: types_1.OrnamentType.trill,
    turn: types_1.OrnamentType.turn,
    mordent: types_1.OrnamentType.mordent,
    prall: types_1.OrnamentType.prall,
    fermata: types_1.OrnamentType.fermata,
    shortfermata: types_1.OrnamentType.shortFermata,
    arpeggio: types_1.OrnamentType.arpeggio,
};
// Dynamic regex and mapping
const DYNAMIC_REGEX = /^[fpmrsz]+$/;
const DYNAMIC_MAP = {
    ppp: types_1.DynamicType.ppp,
    pp: types_1.DynamicType.pp,
    p: types_1.DynamicType.p,
    mp: types_1.DynamicType.mp,
    mf: types_1.DynamicType.mf,
    f: types_1.DynamicType.f,
    ff: types_1.DynamicType.ff,
    fff: types_1.DynamicType.fff,
    sfz: types_1.DynamicType.sfz,
    rfz: types_1.DynamicType.rfz,
};
// Convert LilyPond pitch to Lilylet pitch
const convertPitch = (phonetStep, alterValue, octave) => {
    const phonet = PHONET_NAMES[phonetStep % 7];
    const accidental = alterValue !== 0 ? ALTER_TO_ACCIDENTAL[alterValue] : undefined;
    // LilyPond octave: 0 = c', 1 = c'', -1 = c
    // Lilylet octave: 0 = middle C octave (C4)
    // LilyPond octave 1 = Lilylet octave 0
    const lilyletOctave = octave;
    return {
        phonet,
        accidental,
        octave: lilyletOctave,
    };
};
// Convert LilyPond duration to Lilylet duration
const convertDuration = (duration) => {
    return {
        division: Math.pow(2, duration.division),
        dots: duration.dots || 0,
    };
};
// Convert key fifths to KeySignature
const convertKeySignature = (fifths) => {
    const mapping = KEY_FIFTHS_MAP[fifths];
    if (mapping) {
        return {
            pitch: mapping.pitch,
            accidental: mapping.accidental,
            mode: mapping.mode,
        };
    }
    return undefined;
};
// Parse post-events to marks
const parsePostEvents = (postEvents) => {
    const marks = [];
    if (!postEvents)
        return marks;
    for (const event of postEvents) {
        // String events
        if (typeof event === 'string') {
            if (event === '~') {
                marks.push({ markType: 'tie', start: true });
            }
            else if (event === '(') {
                marks.push({ markType: 'slur', start: true });
            }
            else if (event === ')') {
                marks.push({ markType: 'slur', start: false });
            }
            continue;
        }
        // PostEvent objects
        if (event && typeof event === 'object') {
            const arg = event.arg;
            // String articulation/ornament
            if (typeof arg === 'string') {
                const cleanArg = arg.replace(/^-/, '');
                if (ARTICULATION_MAP[cleanArg]) {
                    marks.push({ type: ARTICULATION_MAP[cleanArg] });
                }
                else if (ORNAMENT_MAP[cleanArg]) {
                    marks.push({ type: ORNAMENT_MAP[cleanArg] });
                }
            }
            // Command (dynamics, hairpins, etc.)
            if (arg && typeof arg === 'object' && 'cmd' in arg) {
                const cmd = arg.cmd;
                if (DYNAMIC_REGEX.test(cmd) && DYNAMIC_MAP[cmd]) {
                    marks.push({ type: DYNAMIC_MAP[cmd] });
                }
                else if (cmd === '<') {
                    marks.push({ type: types_1.HairpinType.crescendoStart });
                }
                else if (cmd === '>') {
                    marks.push({ type: types_1.HairpinType.diminuendoStart });
                }
                else if (cmd === '!') {
                    marks.push({ type: types_1.HairpinType.crescendoEnd }); // or diminuendoEnd
                }
                else if (cmd === 'sustainOn') {
                    marks.push({ type: types_1.PedalType.sustainOn });
                }
                else if (cmd === 'sustainOff') {
                    marks.push({ type: types_1.PedalType.sustainOff });
                }
            }
        }
    }
    return marks;
};
// Parse a LilyPond document to measures
const parseLilyDocument = (lilyDocument) => {
    const measureMap = new Map();
    const staffNames = [];
    const interpreter = lilyDocument.interpret();
    interpreter.layoutMusic.musicTracks.forEach((track, vi) => {
        const appendStaff = (staffName) => {
            if (!staffNames.includes(staffName)) {
                staffNames.push(staffName);
            }
        };
        const staffName = track.contextDict?.Staff;
        if (staffName) {
            appendStaff(staffName);
        }
        let staff = staffName ? staffNames.indexOf(staffName) + 1 : 1;
        const context = new lilyParser.TrackContext(undefined, {
            listener: (term, context) => {
                const mi = term._measure;
                if (mi === undefined)
                    return;
                if (!measureMap.has(mi)) {
                    measureMap.set(mi, {
                        key: null,
                        timeSig: null,
                        voices: [],
                        partial: false,
                    });
                }
                // Update staff from context
                if (context.staffName) {
                    appendStaff(context.staffName);
                    staff = staffNames.indexOf(context.staffName) + 1;
                }
                const measure = measureMap.get(mi);
                // Initialize voice for this track
                if (!measure.voices[vi]) {
                    measure.voices[vi] = {
                        staff,
                        events: [],
                    };
                }
                const voice = measure.voices[vi];
                // Update key/time from context on music events
                if (term instanceof lilyParser.MusicEvent ||
                    term instanceof lilyParser.LilyTerms.StemDirection ||
                    term instanceof lilyParser.LilyTerms.OctaveShift) {
                    if (context.key && measure.key === null) {
                        measure.key = context.key.key;
                    }
                    if (context.time && measure.timeSig === null) {
                        measure.timeSig = {
                            numerator: context.time.value.numerator,
                            denominator: context.time.value.denominator,
                        };
                    }
                    if (context.partialDuration) {
                        measure.partial = true;
                    }
                }
                // Handle music events
                if (term instanceof lilyParser.MusicEvent) {
                    // Update staff from voice events
                    voice.staff = staff;
                    // Handle clef context change
                    if (context.clef && !voice.events.some(e => e.type === 'context' && e.clef)) {
                        const clef = LILYPOND_CLEF_MAP[context.clef.clefName];
                        if (clef) {
                            voice.events.push({
                                type: 'context',
                                clef,
                            });
                        }
                    }
                    // Handle ottava
                    if (context.octave?.value && !voice.events.some(e => e.type === 'context' && e.ottava !== undefined)) {
                        voice.events.push({
                            type: 'context',
                            ottava: context.octave.value,
                        });
                    }
                    // Handle stem direction context
                    if (context.stemDirection && !voice.events.some(e => e.type === 'context' && e.stemDirection)) {
                        const stemDir = context.stemDirection === 'Up' ? types_1.StemDirection.up :
                            context.stemDirection === 'Down' ? types_1.StemDirection.down : undefined;
                        if (stemDir) {
                            voice.events.push({
                                type: 'context',
                                stemDirection: stemDir,
                            });
                        }
                    }
                    // Process Chord (note or chord)
                    if (term instanceof lilyParser.LilyTerms.Chord) {
                        const pitches = [];
                        for (const pitch of term.pitchesValue) {
                            if (pitch instanceof lilyParser.LilyTerms.ChordElement) {
                                pitches.push(convertPitch(pitch.phonetStep, pitch.alterValue || 0, pitch.octave));
                            }
                        }
                        if (pitches.length > 0) {
                            const marks = parsePostEvents(term.post_events);
                            // Add beam marks
                            if (term.beamOn) {
                                marks.push({ markType: 'beam', start: true });
                            }
                            else if (term.beamOff) {
                                marks.push({ markType: 'beam', start: false });
                            }
                            // Add tie
                            if (term.isTying) {
                                marks.push({ markType: 'tie', start: true });
                            }
                            const noteEvent = {
                                type: 'note',
                                pitches,
                                duration: convertDuration(term.durationValue),
                                grace: context.inGrace || undefined,
                            };
                            if (marks.length > 0) {
                                noteEvent.marks = marks;
                            }
                            voice.events.push(noteEvent);
                        }
                    }
                    // Process Rest
                    else if (term instanceof lilyParser.LilyTerms.Rest) {
                        const restEvent = {
                            type: 'rest',
                            duration: convertDuration(term.durationValue),
                            invisible: term.isSpacer || undefined,
                        };
                        // Positioned rest
                        if (!term.isSpacer && context.pitch) {
                            restEvent.pitch = convertPitch(context.pitch.phonetStep, 0, context.pitch.octave);
                        }
                        voice.events.push(restEvent);
                    }
                }
                // Handle standalone stem direction
                else if (term instanceof lilyParser.LilyTerms.StemDirection) {
                    const stemDir = term.direction === 'Up' ? types_1.StemDirection.up :
                        term.direction === 'Down' ? types_1.StemDirection.down : undefined;
                    if (stemDir) {
                        voice.events.push({
                            type: 'context',
                            stemDirection: stemDir,
                        });
                    }
                }
                // Handle standalone clef
                else if (term instanceof lilyParser.LilyTerms.Clef) {
                    const clef = LILYPOND_CLEF_MAP[term.clefName];
                    if (clef) {
                        voice.events.push({
                            type: 'context',
                            clef,
                        });
                    }
                }
                // Handle ottava shift
                else if (term instanceof lilyParser.LilyTerms.OctaveShift) {
                    voice.events.push({
                        type: 'context',
                        ottava: term.value,
                    });
                }
                // Handle staff change
                else if (term instanceof lilyParser.LilyTerms.Change) {
                    if (term.args?.[0]?.key === 'Staff') {
                        // Staff change mid-voice
                        voice.staff = staff;
                    }
                }
            },
        });
        context.execute(track.music);
    });
    // Filter out empty voices and convert to array
    const measures = Array.from(measureMap.values());
    for (const measure of measures) {
        measure.voices = measure.voices.filter(Boolean);
    }
    return measures;
};
exports.parseLilyDocument = parseLilyDocument;
// Convert parsed measures to LilyletDoc
const parsedMeasuresToDoc = (parsedMeasures) => {
    const measures = parsedMeasures.map(pm => {
        const measure = {
            parts: [{
                    voices: pm.voices.map(v => ({
                        staff: v.staff,
                        events: v.events,
                    })),
                }],
        };
        if (pm.key !== null) {
            measure.key = convertKeySignature(pm.key);
        }
        if (pm.timeSig) {
            measure.timeSig = pm.timeSig;
        }
        if (pm.partial) {
            measure.partial = true;
        }
        return measure;
    });
    return { measures };
};
/**
 * Decode a LilyPond string to LilyletDoc (async - requires parser loading)
 */
const decode = async (lilypondSource) => {
    const parser = await getParser();
    const rawData = parser.parse(lilypondSource);
    const lilyDocument = new lilyParser.LilyDocument(rawData);
    const parsedMeasures = parseLilyDocument(lilyDocument);
    return parsedMeasuresToDoc(parsedMeasures);
};
exports.decode = decode;
/**
 * Decode a LilyPond file to LilyletDoc
 */
const decodeFile = async (filePath) => {
    const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
    const source = await fs.readFile(filePath, 'utf-8');
    return decode(source);
};
exports.decodeFile = decodeFile;
/**
 * Decode from pre-parsed LilyDocument (synchronous, for when you already have parsed data)
 */
const decodeFromDocument = (lilyDocument) => {
    const parsedMeasures = parseLilyDocument(lilyDocument);
    return parsedMeasuresToDoc(parsedMeasures);
};
exports.decodeFromDocument = decodeFromDocument;
