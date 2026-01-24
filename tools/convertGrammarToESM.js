// Convert jison-generated CommonJS grammar to ES module format
// Strategy: Replace 'var grammar = (function...' with 'export default (function...'
// This directly exports the IIFE result without an intermediate variable
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Replace 'var grammar = (function(){' with direct export default
// The IIFE result becomes the default export directly
esm = esm.replace(/^var grammar = (\(function\(\)\{)/m, 'const grammar = $1');

// Add named exports that re-export from the grammar object
esm += `

// Named ES module exports
export { grammar };
export const parser = grammar;
export const Parser = grammar.Parser;
export const parse = function() { return grammar.parse.apply(grammar, arguments); };
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
