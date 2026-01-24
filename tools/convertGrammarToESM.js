// Convert jison-generated CommonJS grammar to ES module format
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Replace `var grammar = (function(){` with an export declaration to prevent tree-shaking
// This ensures the IIFE result is captured and exported
esm = esm.replace(/^var grammar = \(function\(\)\{/m, 'export const grammar = (function(){');

// Add additional named exports that reference the grammar object
esm += `

// Additional ES module exports
export const parser = grammar;
export const Parser = grammar.Parser;
export function parse() { return grammar.parse.apply(grammar, arguments); }
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
