// Convert jison-generated CommonJS grammar to ES module format
// Strategy:
// 1. Use getters to prevent tree-shaking
// 2. Use aliased export names to avoid conflicts with IIFE internals
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Rename the grammar variable to avoid any potential conflicts
esm = esm.replace(
  /^var grammar = (\(function\(\)\{)/m,
  'const _jisonGrammar = $1'
);

// Add exports using getters and aliased names
// The getters prevent tree-shaking, the aliased internal names prevent conflicts
esm += `

// ES module exports
// Use getters to prevent tree-shaking of the IIFE result
const _grammarExport = { get value() { return _jisonGrammar; } };
const _parserExport = { get value() { return _jisonGrammar; } };
const _ParserExport = { get value() { return _jisonGrammar.Parser; } };
const _parseExport = { get value() { return function() { return _jisonGrammar.parse.apply(_jisonGrammar, arguments); }; } };

// Export with aliased internal variable names
const __grammar = _grammarExport.value;
const __parser = _parserExport.value;
const __Parser = _ParserExport.value;
const __parse = _parseExport.value;

export { __grammar as grammar, __parser as parser, __Parser as Parser, __parse as parse };
export default __grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
