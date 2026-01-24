// Convert jison-generated CommonJS grammar to ES module format
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Replace `var grammar = (function(){` with an export declaration to prevent tree-shaking
// This ensures the IIFE result is captured and exported
esm = esm.replace(/^var grammar = \(function\(\)\{/m, 'export const grammar = (function(){');

// Add additional named exports with unique names to avoid conflicts with inner IIFE variables
// The inner IIFE declares 'var parser' and 'function Parser()' which conflict with module-level exports
esm += `

// ES module exports - use aliases to avoid conflicts with inner IIFE variables
const _$parser = grammar;
const _$Parser = grammar.Parser;
function _$parse() { return grammar.parse.apply(grammar, arguments); }

export { _$parser as parser, _$Parser as Parser, _$parse as parse };
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
