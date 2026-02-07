// Convert jison-generated CommonJS grammar to ES module format
// Strategy: Use Object.defineProperty to force IIFE result storage
const fs = require('fs');

function convertGrammar(inputPath, outputPaths, globalName) {
  if (!fs.existsSync(inputPath)) {
    console.log(`${inputPath} not found, skipping`);
    return;
  }

  const cjs = fs.readFileSync(inputPath, 'utf8');

  // Check if already converted to ESM
  if (cjs.includes('export default __grammar')) {
    console.log(`${inputPath} already converted to ES module format`);
    return;
  }

  // Remove the CommonJS exports section at the end
  let esm = cjs.replace(/\nif \(typeof require !== 'undefined' && typeof exports !== 'undefined'\)[\s\S]*$/, '');

  // Replace the start of IIFE (jison generates 'var parser')
  esm = esm.replace(
    /^var parser = \(function\(\)\{/m,
    `Object.defineProperty(globalThis, "${globalName}", { value: (function(){`
  );

  // Replace the end of IIFE
  esm = esm.replace(
    /return new Parser;\n\}\)\(\);$/m,
    'return new Parser;\n})(), writable: false, configurable: false });'
  );

  // Add exports that read from globalThis
  esm += `

// ES module exports
const __grammar = globalThis["${globalName}"];
const __parser = globalThis["${globalName}"];
const __Parser = globalThis["${globalName}"].Parser;
const __parse = function() { return globalThis["${globalName}"].parse.apply(globalThis["${globalName}"], arguments); };

export { __grammar as grammar, __parser as parser, __Parser as Parser, __parse as parse };
export default __grammar;
`;

  for (const outputPath of outputPaths) {
    // Ensure directory exists
    const dir = require('path').dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, esm);
  }
  console.log(`Converted ${inputPath} to ES module format`);
}

// Convert lilylet grammar
convertGrammar(
  'source/lilylet/grammar.jison.js',
  ['lib/grammar.jison.js', 'source/lilylet/grammar.jison.js'],
  '__lilyletGrammar__'
);

// Convert ABC grammar
convertGrammar(
  'source/abc/grammar.jison.js',
  ['source/abc/grammar.jison.js'],
  '__abcGrammar__'
);
