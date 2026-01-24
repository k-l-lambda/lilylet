// Convert jison-generated CommonJS grammar to ES module format
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Add ES module exports with explicit assignments for rollup compatibility
esm += `

// ES module exports
const parser = grammar;
const Parser = grammar.Parser;
function parse() { return grammar.parse.apply(grammar, arguments); }

export { parser, Parser, parse };
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
