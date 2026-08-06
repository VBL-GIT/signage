// Writes the public tunnel URLs into the three .env files.
//   node scripts/set-public-url.mjs --api https://api.trycloudflare.com [--web https://web.trycloudflare.com]
// - web/.env      VITE_API_URL          = <api>
// - mobile/.env   EXPO_PUBLIC_API_URL   = <api>
// - backend/.env  APP_WEB_URL           = <web>  (only if --web given)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function upsert(file, key, value) {
  const path = join(root, file);
  let lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join('\n') + '\n');
  console.log(`  ${file}: ${key}=${value}`);
}

const api = arg('api');
const web = arg('web');
if (!api) { console.error('Missing --api <url>'); process.exit(1); }

console.log('Wiring public URLs:');
upsert('web/.env', 'VITE_API_URL', api);
upsert('mobile/.env', 'EXPO_PUBLIC_API_URL', api);
if (web) upsert('backend/.env', 'APP_WEB_URL', web);
console.log('Done.');
