// === Enums ===
export var Phonet;
(function (Phonet) {
    Phonet["c"] = "c";
    Phonet["d"] = "d";
    Phonet["e"] = "e";
    Phonet["f"] = "f";
    Phonet["g"] = "g";
    Phonet["a"] = "a";
    Phonet["b"] = "b";
})(Phonet || (Phonet = {}));
export var Accidental;
(function (Accidental) {
    Accidental["natural"] = "natural";
    Accidental["sharp"] = "sharp";
    Accidental["flat"] = "flat";
    Accidental["doubleSharp"] = "doubleSharp";
    Accidental["doubleFlat"] = "doubleFlat";
})(Accidental || (Accidental = {}));
export var Clef;
(function (Clef) {
    Clef["treble"] = "treble";
    Clef["bass"] = "bass";
    Clef["alto"] = "alto";
})(Clef || (Clef = {}));
export var StemDirection;
(function (StemDirection) {
    StemDirection["up"] = "up";
    StemDirection["down"] = "down";
    StemDirection["auto"] = "auto";
})(StemDirection || (StemDirection = {}));
export var ArticulationType;
(function (ArticulationType) {
    ArticulationType["staccato"] = "staccato";
    ArticulationType["staccatissimo"] = "staccatissimo";
    ArticulationType["tenuto"] = "tenuto";
    ArticulationType["marcato"] = "marcato";
    ArticulationType["accent"] = "accent";
    ArticulationType["portato"] = "portato";
})(ArticulationType || (ArticulationType = {}));
export var OrnamentType;
(function (OrnamentType) {
    OrnamentType["trill"] = "trill";
    OrnamentType["turn"] = "turn";
    OrnamentType["mordent"] = "mordent";
    OrnamentType["prall"] = "prall";
    OrnamentType["fermata"] = "fermata";
    OrnamentType["shortFermata"] = "shortFermata";
    OrnamentType["arpeggio"] = "arpeggio";
})(OrnamentType || (OrnamentType = {}));
export var DynamicType;
(function (DynamicType) {
    DynamicType["ppp"] = "ppp";
    DynamicType["pp"] = "pp";
    DynamicType["p"] = "p";
    DynamicType["mp"] = "mp";
    DynamicType["mf"] = "mf";
    DynamicType["f"] = "f";
    DynamicType["ff"] = "ff";
    DynamicType["fff"] = "fff";
    DynamicType["sfz"] = "sfz";
    DynamicType["rfz"] = "rfz";
})(DynamicType || (DynamicType = {}));
export var HairpinType;
(function (HairpinType) {
    HairpinType["crescendoStart"] = "crescendoStart";
    HairpinType["crescendoEnd"] = "crescendoEnd";
    HairpinType["diminuendoStart"] = "diminuendoStart";
    HairpinType["diminuendoEnd"] = "diminuendoEnd";
})(HairpinType || (HairpinType = {}));
export var PedalType;
(function (PedalType) {
    PedalType["sustainOn"] = "sustainOn";
    PedalType["sustainOff"] = "sustainOff";
    PedalType["sostenutoOn"] = "sostenutoOn";
    PedalType["sostenutoOff"] = "sostenutoOff";
    PedalType["unaCordaOn"] = "unaCordaOn";
    PedalType["unaCordaOff"] = "unaCordaOff";
})(PedalType || (PedalType = {}));
// === Placement Direction ===
export var Placement;
(function (Placement) {
    Placement["above"] = "above";
    Placement["below"] = "below";
})(Placement || (Placement = {}));
