// Convert jison-generated CommonJS grammar to ES module format
// Strategy: Store IIFE result on globalThis to prevent tree-shaking
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Replace the IIFE assignment to store on globalThis
// This prevents tree-shaking because it's an observable side effect
esm = esm.replace(
  /^var grammar = (\(function\(\)\{)/m,
  'globalThis.__lilyletJisonGrammar__ = $1'
);

// Add exports that read from globalThis
esm += `

// ES module exports - read from globalThis to get the IIFE result
const __grammar = globalThis.__lilyletJisonGrammar__;
const __parser = globalThis.__lilyletJisonGrammar__;
const __Parser = globalThis.__lilyletJisonGrammar__.Parser;
const __parse = function() { return globalThis.__lilyletJisonGrammar__.parse.apply(globalThis.__lilyletJisonGrammar__, arguments); };

export { __grammar as grammar, __parser as parser, __Parser as Parser, __parse as parse };
export default __grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
