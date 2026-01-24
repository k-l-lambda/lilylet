// Convert jison-generated CommonJS grammar to ES module format
// Strategy: Use inline export const grammar = IIFE pattern
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Replace 'var grammar =' with 'export const grammar =' for inline export
esm = esm.replace(/^var grammar = /m, 'export const grammar = ');

// Add additional named exports using aliased internal variables
// The inner IIFE declares 'var parser' and 'function Parser()' which would conflict
esm += `

// Additional ES module exports with aliased names
const __parser__ = grammar;
const __Parser__ = grammar.Parser;
const __parse__ = function() { return grammar.parse.apply(grammar, arguments); };

export { __parser__ as parser, __Parser__ as Parser, __parse__ as parse };
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
