import { LilyletDoc } from "./types";
declare const resetIdCounter: () => void;
interface MEIEncoderOptions {
    indent?: string;
    xmlDeclaration?: boolean;
}
declare const encode: (doc: LilyletDoc, options?: MEIEncoderOptions) => string;
export { encode, resetIdCounter, MEIEncoderOptions, };
