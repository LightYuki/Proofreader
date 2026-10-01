import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const args = new Set(process.argv.slice(2));
for (const arg of args) assert.ok(['--check', '--sources'].includes(arg), `Unknown option: ${arg}`);
const read = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const metadata = JSON.parse(execFileSync('cargo', [
  'metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked',
  '--filter-platform', 'x86_64-pc-windows-msvc', '--format-version', '1',
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const reachable = new Set();
function visit(id) {
  if (reachable.has(id)) return;
  reachable.add(id);
  for (const dep of nodes.get(id)?.deps ?? []) visit(dep.pkg);
}
visit(metadata.resolve.root);
const overrides = JSON.parse(read('third-party/license-overrides.json'));
const components = metadata.packages.filter((pkg) => pkg.source && reachable.has(pkg.id)).map((pkg) => ({
  ecosystem: 'cargo', name: pkg.name, version: pkg.version, license: pkg.license,
  repository: pkg.repository, authors: pkg.authors,
  source: `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`,
  directory: path.dirname(pkg.manifest_path),
}));
const lock = JSON.parse(read('package-lock.json'));
for (const [directory, pkg] of Object.entries(lock.packages)) {
  if (!directory || pkg.dev) continue;
  const installed = JSON.parse(read(path.join(directory, 'package.json')));
  assert.equal(installed.version, pkg.version, `${directory}: run npm ci first`);
  components.push({ ecosystem: 'npm', name: installed.name, version: pkg.version,
    license: pkg.license, source: pkg.resolved, directory: path.resolve(directory) });
}
components.sort((a, b) => {
  const left = `${a.ecosystem}/${a.name}@${a.version}`;
  const right = `${b.ecosystem}/${b.name}@${b.version}`;
  return left < right ? -1 : left > right ? 1 : 0;
});

function licenseFiles(directory, prefix = '') {
  return readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory() && !['.git', 'node_modules', 'target'].includes(entry.name)) return licenseFiles(directory, relative);
    if (!entry.isFile() || !/^(licen[cs]e|copying|copyright|notice|unlicense)([.\-_]|$)/i.test(entry.name)) return [];
    return [{ name: relative, text: read(path.join(directory, relative)) }];
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

const knownLicenses = new Set(['0BSD', 'MIT', 'MIT-0', 'Apache-2.0', 'Unlicense', 'BSD-3-Clause',
  'MPL-2.0', 'CC0-1.0', 'Zlib', 'ISC', 'Unicode-3.0', 'BSL-1.0', 'CDLA-Permissive-2.0']);
const inventory = [];
const notices = ['THIRD-PARTY SOFTWARE NOTICES', '',
  'Generated from package-lock.json and Cargo.lock for Windows x86_64-pc-windows-msvc.',
  'Includes Rust build dependencies and npm runtime dependencies; inclusion does not imply runtime linkage.',
  'All third-party components retain their original licenses and copyright notices.',
  'MPL-covered files are unmodified and included in the dependency source archive.',
  'Source archive and build instructions: https://github.com/LightYuki/Proofreader/releases', ''];
const sourceRoot = path.resolve('release/dependency-sources');
if (args.has('--sources')) {
  assert.ok(!existsSync(sourceRoot), 'release/dependency-sources exists; use a fresh output directory');
  mkdirSync(sourceRoot, { recursive: true });
}
for (const component of components) {
  assert.ok(component.license, `Missing license: ${component.name}`);
  for (const license of component.license.split(/\s+OR\s+|\s+AND\s+|[()/]/).map((v) => v.trim()).filter(Boolean)) {
    assert.ok(knownLicenses.has(license), `Review new license before releasing: ${component.name}: ${license}`);
  }
  const key = `${component.name}@${component.version}`;
  let files = licenseFiles(component.directory);
  const override = component.ecosystem === 'cargo' ? overrides[key] : undefined;
  if (override) {
    const vcs = JSON.parse(read(path.join(component.directory, '.cargo_vcs_info.json')));
    assert.equal(vcs.git.sha1, override.revision, `${key}: upstream license revision changed`);
    files = files.concat(override.files.map((file) => ({ name: file.file, source: file.source, text: read(file.file) })));
  }
  assert.ok(files.length, `No license text for ${key}; recover it from its exact upstream revision`);
  notices.push('='.repeat(78), `${component.ecosystem}: ${key}`, `License: ${component.license}`,
    `Source: ${component.source}`, ...(component.repository ? [`Repository: ${component.repository}`] : []),
    ...(component.authors?.length ? [`Authors: ${component.authors.join('; ')}`] : []), '');
  for (const file of files) notices.push(`--- ${file.name}${file.source ? ` (${file.source})` : ''} ---`, file.text.trimEnd(), '');
  const { directory, ...publicComponent } = component;
  inventory.push({ ...publicComponent, noticeFiles: files.map(({ name, source }) => ({ name, ...(source ? { source } : {}) })) });
  if (args.has('--sources')) {
    const destination = path.join(sourceRoot, component.ecosystem, `${component.name.replaceAll('/', '__')}@${component.version}`);
    cpSync(directory, destination, { recursive: true, filter: (source) => !['.git', 'node_modules', 'target'].includes(path.basename(source)) });
    for (const [index, file] of (override?.files ?? []).entries()) cpSync(file.file, path.join(destination, `UPSTREAM-LICENSE-${index + 1}.txt`));
  }
}
const outputs = {
  'THIRD_PARTY_NOTICES.txt': notices.join('\n'),
  'third-party/inventory.json': JSON.stringify(inventory, null, 2) + '\n',
};
for (const [file, contents] of Object.entries(outputs)) {
  if (args.has('--check')) assert.ok(read(file) === contents, `${file} is stale; run npm run licenses`);
  else writeFileSync(file, contents);
}
if (args.has('--sources')) {
  for (const file of ['THIRD_PARTY_NOTICES.txt', 'third-party/inventory.json', 'package-lock.json', 'src-tauri/Cargo.lock']) {
    cpSync(file, path.join(sourceRoot, path.basename(file)));
  }
  writeFileSync(path.join(sourceRoot, 'README.txt'), [
    'Dependency source snapshot for Proofread Windows x64.',
    'cargo/: original registry source packages (including build dependencies).',
    'npm/: original installed npm runtime packages, at the locked versions.',
    'Missing license texts were restored from upstream; no dependency code was modified.',
    'Each component retains its original license. Consult THIRD_PARTY_NOTICES.txt and inventory.json.',
    'This is a source distribution, not a complete offline build cache.',
    'Build the matching project source archive using README.md; toolchains and npm build tools require installation.', '',
  ].join('\n'));
}
console.log(`Verified ${components.length} dependency licenses${args.has('--sources') ? ' and exported their source packages' : ''}.`);
