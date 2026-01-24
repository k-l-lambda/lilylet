// Convert jison-generated CommonJS grammar to ES module format
// Strategy:
// 1. Use const grammar to capture IIFE result
// 2. Export grammar directly to prevent tree-shaking
// 3. Use aliased names for parser/Parser to avoid conflicts with inner IIFE variables
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Replace 'var grammar' with 'const grammar'
esm = esm.replace(/^var grammar = /m, 'const grammar = ');

// Add named exports using aliased internal variables to avoid conflicts
// The inner IIFE declares 'var parser' and 'function Parser()' which would conflict
esm += `

// ES module exports
// Export grammar directly to prevent tree-shaking
export { grammar };

// Use unique internal names to avoid conflicts with IIFE internals
const __parser__ = grammar;
const __Parser__ = grammar.Parser;
const __parse__ = function() { return grammar.parse.apply(grammar, arguments); };

export { __parser__ as parser, __Parser__ as Parser, __parse__ as parse };
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
