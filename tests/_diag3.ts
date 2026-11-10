import { parseCode } from '../source/lilylet/parser';
// no trailing bar
const a = parseCode(`\\clef "treble"`);
console.log("no-bar measures:", a.measures.length, JSON.stringify(a.measures).slice(0,200));
// with note no bar
const b = parseCode(`\\clef "treble" c4`);
console.log("note-no-bar measures:", b.measures.length);
