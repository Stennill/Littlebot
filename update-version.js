// Helper script to update version in both version.json and package.json, then add a changelog entry.
// Usage: node update-version.js <version> <name> <change1> [change2] ...
// Example: node update-version.js 1.3.1 "Sidebar tweaks" "Fixed input focus" "Updated styles"

const fs = require('fs');
const path = require('path');

const versionPath = path.join(__dirname, 'version.json');
const packagePath = path.join(__dirname, 'package.json');
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('Usage: node update-version.js <version> <name> <change1> [change2] ...');
  console.log('Example: node update-version.js 1.3.1 "Sidebar tweaks" "Fixed input focus" "Updated styles"');
  process.exit(1);
}

const [newVersion, updateName, ...changes] = args;

// Read current version file
const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

// Create new changelog entry
const now = new Date();
const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const newEntry = {
  version: newVersion,
  date: dateStr,
  name: updateName,
  changes: changes
};

// Update version.json
versionData.version = newVersion;
versionData.buildDate = dateStr;
versionData.changelog.unshift(newEntry);
fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2), 'utf8');

// Sync version to package.json (used by electron-builder for installer/exe filenames)
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2), 'utf8');

console.log(`✓ Updated to version ${newVersion} "${updateName}"`);
console.log(`✓ version.json and package.json both set to ${newVersion}`);
console.log(`✓ Added ${changes.length} change(s) to changelog`);
console.log(`  Next: npm run dist:win → installer/exe will be named with ${newVersion}`);
