import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version: string = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('package.json must contain a stable release version');

const tag = `v${version}`;
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag) {
  throw new Error(`Release tag ${process.env.GITHUB_REF_NAME} does not match ${tag}`);
}

const changelog = readFileSync(resolve(root, 'docs/CHANGELOG.md'), 'utf8');
const latest = changelog.match(/^## (v\d+\.\d+\.\d+)\b[^\r\n]*\r?\n([\s\S]*?)(?=^## v|$(?![\s\S]))/m);
if (!latest || latest[1] !== tag) throw new Error(`Latest changelog entry must be ${tag}`);
const notes = latest[0].trim();

const tauriPath = resolve(root, 'src-tauri/tauri.conf.json');
const cargoPath = resolve(root, 'src-tauri/Cargo.toml');
const native = existsSync(tauriPath) && existsSync(cargoPath);
if (existsSync(tauriPath) !== existsSync(cargoPath)) throw new Error('Incomplete native project: both tauri.conf.json and Cargo.toml are required');
if (native) {
  const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
  const cargo = readFileSync(cargoPath, 'utf8').split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoVersion = cargo?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (tauri.version !== version || cargoVersion !== version) throw new Error(`Native versions must also be ${version}`);
}

writeFileSync(resolve(root, '.release-notes.md'), `${notes}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nnative=${native}\n`);
}
console.log(JSON.stringify({ version, tag, native, notes: '.release-notes.md' }));
