/**
 * Add .js extensions to ES module imports in lib/ directory
 */

const fs = require('fs');
const path = require('path');

const libDir = path.join(__dirname, '../lib');

// Get all .js files
const files = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));

for (const file of files) {
  const filePath = path.join(libDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Fix relative imports without extensions
  // Match: from "./something" or from './something'
  // Add .js extension
  content = content.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (match, importPath) => {
      if (importPath.endsWith('.js')) {
        return match;
      }
      return `from "${importPath}.js"`;
    }
  );

  fs.writeFileSync(filePath, content);
}

console.log('Fixed ES module extensions in lib/');
