// Helper script to update version.json with new changes
// Usage: node update-version.js <version> <name> <change1> <change2> ...

const fs = require('fs');
const path = require('path');

const versionPath = path.join(__dirname, 'version.json');
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log('Usage: node update-version.js <version> <name> <change1> [change2] ...');
  console.log('Example: node update-version.js 1.3.0 "Dark Mode" "Added dark theme toggle" "Updated color palette"');
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

// Update version info
versionData.version = newVersion;
versionData.buildDate = dateStr;
versionData.changelog.unshift(newEntry);

// Write back
fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2), 'utf8');

console.log(`✓ Updated to version ${newVersion} "${updateName}"`);
console.log(`✓ Added ${changes.length} change(s) to changelog`);
console.log(`✓ New entry added to version.json`);
