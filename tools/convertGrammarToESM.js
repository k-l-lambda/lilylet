// Convert jison-generated CommonJS grammar to ES module format
// Strategy: Assign IIFE to globalThis to prevent tree-shaking, then export from there
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Replace 'var grammar = (function...' with assignment to a global-ish object
// This prevents the bundler from tree-shaking the assignment
esm = esm.replace(
  /^var grammar = (\(function\(\)\{)/m,
  '/* @__PURE__ */ const _jisonGrammar = $1'
);

// Add exports that reference the grammar through a getter to prevent optimization
esm += `

// ES module exports - use object wrapper to prevent tree-shaking
const grammarExports = {
  get grammar() { return _jisonGrammar; },
  get parser() { return _jisonGrammar; },
  get Parser() { return _jisonGrammar.Parser; },
  get parse() { return function() { return _jisonGrammar.parse.apply(_jisonGrammar, arguments); }; }
};

export const grammar = grammarExports.grammar;
export const parser = grammarExports.parser;
export const Parser = grammarExports.Parser;
export const parse = grammarExports.parse;
export default grammarExports.grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
