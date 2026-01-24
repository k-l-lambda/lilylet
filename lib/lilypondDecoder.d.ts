/**
 * LilyPond to Lilylet Decoder
 *
 * Converts LilyPond notation files to Lilylet document format using the lotus parser.
 */
import * as lilyParser from "@k-l-lambda/lotus/lib/inc/lilyParser";
declare const getParser: () => Promise<any>;
import { LilyletDoc, Event, Fraction } from "./types";
interface ParsedMeasure {
    key: number | null;
    timeSig: Fraction | null;
    voices: ParsedVoice[];
    partial: boolean;
}
interface ParsedVoice {
    staff: number;
    events: Event[];
}
declare const parseLilyDocument: (lilyDocument: lilyParser.LilyDocument) => ParsedMeasure[];
/**
 * Decode a LilyPond string to LilyletDoc (async - requires parser loading)
 */
declare const decode: (lilypondSource: string) => Promise<LilyletDoc>;
/**
 * Decode a LilyPond file to LilyletDoc
 */
declare const decodeFile: (filePath: string) => Promise<LilyletDoc>;
/**
 * Decode from pre-parsed LilyDocument (synchronous, for when you already have parsed data)
 */
declare const decodeFromDocument: (lilyDocument: lilyParser.LilyDocument) => LilyletDoc;
export { decode, decodeFile, decodeFromDocument, parseLilyDocument, getParser, };
