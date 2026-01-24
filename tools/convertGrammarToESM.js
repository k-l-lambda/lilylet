// Convert jison-generated CommonJS grammar to ES module format
const fs = require('fs');

const cjs = fs.readFileSync('source/lilylet/grammar.jison.js', 'utf8');

// Remove the CommonJS exports section at the end
let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

// Add ES module exports with unique names to avoid conflicts
esm += `

// ES module exports
const _parser = grammar;
const _Parser = grammar.Parser;
function _parse() { return grammar.parse.apply(grammar, arguments); }

export { _parser as parser, _Parser as Parser, _parse as parse };
export default grammar;
`;

fs.writeFileSync('lib/grammar.jison.js', esm);
console.log('Converted grammar.jison.js to ES module format');
