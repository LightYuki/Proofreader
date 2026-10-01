import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const json = (path) => JSON.parse(read(path));
const pkg = json('package.json');
const lock = json('package-lock.json');
const tauri = json('src-tauri/tauri.conf.json');
const cargo = read('src-tauri/Cargo.toml').split(/^\[/m).find((section) => section.startsWith('package]'));
const cargoField = (field) => cargo?.match(new RegExp(`^${field} = "([^"]+)"$`, 'm'))?.[1];
const cargoLock = read('src-tauri/Cargo.lock').split('[[package]]')
  .find((section) => /^name = "proofread"$/m.test(section));
const cargoLockVersion = cargoLock?.match(/^version = "([^"]+)"$/m)?.[1];

assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Use a stable X.Y.Z version for the current release workflow');
for (const [name, version] of Object.entries({
  'package-lock.json': lock.version,
  'package-lock root package': lock.packages[''].version,
  'Cargo.toml': cargoField('version'),
  'Cargo.lock': cargoLockVersion,
  'tauri.conf.json': tauri.version,
})) assert.equal(version, pkg.version, `${name} version must match package.json`);

for (const [name, license] of Object.entries({
  'package.json': pkg.license,
  'package-lock.json': lock.packages[''].license,
  'Cargo.toml': cargoField('license'),
  'tauri.conf.json': tauri.bundle.license,
})) assert.equal(license, 'GPL-3.0-or-later', `${name} license must match NOTICE`);

assert.match(read('LICENSE'), /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
assert.match(read('NOTICE'), /any later version/);
assert.equal(tauri.bundle.licenseFile, '../LICENSE');

if (process.argv.length > 2) {
  assert.equal(process.argv[2], '--tag', 'Expected --tag vX.Y.Z');
  assert.equal(process.argv.length, 4, 'Expected one release tag');
  assert.equal(process.argv[3], `v${pkg.version}`, 'Release tag must match the application version');
  assert.ok(read('CHANGELOG.md').includes(`## [${pkg.version}]`), 'Add release notes to CHANGELOG.md first');
}

console.log(`Project metadata verified: ${pkg.version}, ${pkg.license} (${fileURLToPath(root)})`);
