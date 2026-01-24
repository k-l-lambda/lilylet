// Convert jison-generated CommonJS grammar to ES module format
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Change var grammar to const grammar for better ES module compatibility
esm = esm.replace(/^var grammar = /m, 'const grammar = ');

// Add ES module exports
esm += `

// ES module exports
export const parser = grammar;
export const Parser = grammar.Parser;
export function parse() { return grammar.parse.apply(grammar, arguments); }
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
