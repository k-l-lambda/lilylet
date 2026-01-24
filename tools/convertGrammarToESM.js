// Convert jison-generated CommonJS grammar to ES module format
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Change var grammar to const grammar for better ES module compatibility
esm = esm.replace(/^var grammar = /m, 'const grammar = ');

// Add ES module exports with unique prefixed names to avoid conflicts with inner IIFE variables
// The inner IIFE has 'var parser', 'function Parser()' so we use _esm_ prefix
esm += `

// ES module exports
const _esm_parser = grammar;
const _esm_Parser = grammar.Parser;
function _esm_parse() { return grammar.parse.apply(grammar, arguments); }

export { _esm_parser as parser, _esm_Parser as Parser, _esm_parse as parse };
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
