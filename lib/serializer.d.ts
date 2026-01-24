/**
 * Lilylet Document Serializer
 *
 * Converts LilyletDoc to Lilylet (.lyl) string format.
 * Uses relative pitch mode matching the parser's behavior.
 */
import { LilyletDoc } from "./types";
/**
 * Serialize a LilyletDoc to Lilylet (.lyl) string format
 */
export declare const serializeLilyletDoc: (doc: LilyletDoc) => string;
