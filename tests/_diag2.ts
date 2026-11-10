import { parseCode } from '../source/lilylet/parser';
const tests = [
  `\\staff "1" \\clef "treble" \\\\\n\\staff "2" \\clef "bass" | %1`,
  `\\clef "treble" | %1`,
  `\\clef "treble" c4 |`,
];
for (const t of tests) {
  try {
    const d = parseCode(t);
    console.log("INPUT:", JSON.stringify(t));
    console.log("  measures:", d.measures.length);
  } catch(e:any) {
    console.log("INPUT:", JSON.stringify(t), "-> ERROR:", e.message.slice(0,80));
  }
}
