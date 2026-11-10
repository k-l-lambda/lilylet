import * as fs from 'fs';
import { parseCode } from '../source/lilylet/parser';
import { serializeLilyletDoc } from '../source/lilylet/serializer';

const file = process.argv[2];
const original = JSON.parse(fs.readFileSync(file, 'utf-8'));
const lyl = serializeLilyletDoc(original);
const rt = parseCode(lyl);

console.log("=== serialized .lyl (first 600 chars) ===");
console.log(lyl.slice(0, 600));
console.log("\n=== measures: orig", original.measures.length, "rt", rt.measures.length);
// dump per-measure/part/voice event types
const dump = (doc:any, tag:string) => {
  doc.measures.forEach((m:any,mi:number)=>m.parts.forEach((p:any,pi:number)=>p.voices.forEach((v:any,vi:number)=>{
    console.log(`${tag} M${mi+1}P${pi+1}V${vi+1} staff=${v.staff}: [${v.events.map((e:any)=>e.type).join(",")}]`);
  })));
};
dump(original,"O");
console.log("---");
dump(rt,"R");
