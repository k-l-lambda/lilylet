/**
 * Add .js extensions to ES module imports in lib/ directory
 * and generate top-level re-export shims for package.json exports
 */

const fs = require('fs');
const path = require('path');

const libDir = path.join(__dirname, '../lib');

// Recursively get all .js files in lib/
const getJsFiles = (dir) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getJsFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
};

const files = getJsFiles(libDir);

for (const filePath of files) {
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

// Generate top-level re-export shims for backward compatibility
// Maps lib/lilylet/*.js → lib/*.js as re-exports
const lilyletDir = path.join(libDir, 'lilylet');
if (fs.existsSync(lilyletDir)) {
  for (const entry of fs.readdirSync(lilyletDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const shimPath = path.join(libDir, entry.name);
    const shimContent = `export * from "./lilylet/${entry.name}";\n`;
    fs.writeFileSync(shimPath, shimContent);

    // Also generate .d.ts shim if the .d.ts exists in lilylet/
    const dtsName = entry.name.replace('.js', '.d.ts');
    const dtsSource = path.join(lilyletDir, dtsName);
    if (fs.existsSync(dtsSource)) {
      const dtsShimPath = path.join(libDir, dtsName);
      const dtsShimContent = `export * from "./lilylet/${dtsName.replace('.d.ts', '.js')}";\n`;
      fs.writeFileSync(dtsShimPath, dtsShimContent);
    }
  }
}

console.log('Fixed ES module extensions in lib/');
