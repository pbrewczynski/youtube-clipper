import { readFileSync, writeFileSync } from 'fs';

const path = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(path, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;
writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`v${pkg.version} — amen, wersja podbita`);