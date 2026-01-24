// Convert jison-generated CommonJS grammar to ES module format
// Strategy: Use Object.defineProperty to force IIFE result storage
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// The jison IIFE ends with "return new Parser;\n})();"
// We need to:
// 1. Replace "var parser = (function(){" at the start (jison generates 'parser' not 'grammar')
// 2. Replace "return new Parser;\n})();" at the end

// Replace the start of IIFE
esm = esm.replace(
  /^var parser = \(function\(\)\{/m,
  'Object.defineProperty(globalThis, "__lilyletGrammar__", { value: (function(){'
);

// Replace the end of IIFE - look for the final "return new Parser;\n})();"
// which marks the end of the main grammar IIFE
esm = esm.replace(
  /return new Parser;\n\}\)\(\);$/m,
  'return new Parser;\n})(), writable: false, configurable: false });'
);

// Add exports that read from globalThis
esm += `

// ES module exports
const __grammar = globalThis.__lilyletGrammar__;
const __parser = globalThis.__lilyletGrammar__;
const __Parser = globalThis.__lilyletGrammar__.Parser;
const __parse = function() { return globalThis.__lilyletGrammar__.parse.apply(globalThis.__lilyletGrammar__, arguments); };

export { __grammar as grammar, __parser as parser, __Parser as Parser, __parse as parse };
export default __grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
