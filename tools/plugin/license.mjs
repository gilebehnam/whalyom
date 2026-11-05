// Whalyom license key: an offline, signature-checked stub. It never phones home and never blocks
// anything that works in the Free edition: an absent, invalid or expired key simply means "free".
// Paid features read the edition and degrade gracefully; nothing deletes or locks user data.
//
// Key format:  WHALYOM-1.<payload base64url>.<Ed25519 signature base64url>
//   payload JSON: { edition: "pro"|"agency", licensee, seats, issued: "YYYY-MM-DD", expires?: "YYYY-MM-DD", id }
// Where the key is read from: env WHALYOM_LICENSE_KEY (the plugin's userConfig license_key maps to it),
// else the file <home>/.whalyom-license.
// The vendor's PUBLIC key is embedded below at release time (PUBLIC_KEY_PEM) or given in
// WHALYOM_LICENSE_PUBKEY for testing. The PRIVATE key never ships: keep it offline.
//
// CLI (vendor side):
//   node tools/plugin/license.mjs --keygen <dir>            writes license-private.pem / license-public.pem into <dir>
//   node tools/plugin/license.mjs --issue --private <pem> --edition pro --licensee "Acme Ltd" [--seats 3] [--expires 2027-12-31]
//   node tools/plugin/license.mjs --verify [<key>]          prints the edition JSON for a key (or the configured one)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Replace with the real vendor public key before selling (see docs/COMMERCIAL.md). null = dev build.
export const PUBLIC_KEY_PEM = null;

export const EDITIONS = {
  free: { label: 'Free', products: 1, connectors: 'all free connectors, local site, manual steps', white_label: false },
  pro: { label: 'Pro', products: 5, connectors: 'all connectors', white_label: false },
  agency: { label: 'Agency', products: 'unlimited (fair use)', connectors: 'all connectors', white_label: true },
};

const PREFIX = 'WHALYOM-1';
const b64 = (s) => Buffer.from(s).toString('base64url');

export function issueLicense(privateKeyPem, payload) {
  if (!EDITIONS[payload.edition] || payload.edition === 'free') throw new Error('edition must be pro or agency');
  const body = { id: crypto.randomUUID(), issued: new Date().toISOString().slice(0, 10), seats: 1, ...payload };
  const data = b64(JSON.stringify(body));
  const sig = crypto.sign(null, Buffer.from(`${PREFIX}.${data}`), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  return `${PREFIX}.${data}.${sig}`;
}

export function verifyLicense(key, { publicKeyPem = PUBLIC_KEY_PEM, now = new Date() } = {}) {
  const free = (reason, extra = {}) => ({ edition: 'free', verified: false, reason, features: EDITIONS.free, ...extra });
  if (!key) return free('no license key: Free edition');
  const parts = String(key).trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return free('license key is not in the WHALYOM-1 format');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return free('license payload is unreadable'); }
  if (!publicKeyPem) return free('this build has no vendor public key, so the key cannot be verified (dev build)', { claimed: payload.edition });
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey(publicKeyPem), Buffer.from(parts[2], 'base64url')); } catch { ok = false; }
  if (!ok) return free('license signature does not verify', { claimed: payload.edition });
  if (!EDITIONS[payload.edition]) return free(`unknown edition ${payload.edition}`);
  if (payload.expires && new Date(`${payload.expires}T23:59:59Z`) < now) return free(`license expired on ${payload.expires}; Free features keep working`, { claimed: payload.edition, licensee: payload.licensee });
  return { edition: payload.edition, verified: true, licensee: payload.licensee ?? null, seats: payload.seats ?? 1, expires: payload.expires ?? null, id: payload.id ?? null, features: EDITIONS[payload.edition] };
}

export function checkLicense({ env = process.env, home = process.cwd(), publicKeyPem } = {}) {
  let key = env.WHALYOM_LICENSE_KEY;
  const file = path.join(home, '.whalyom-license');
  if (!key && fs.existsSync(file)) key = fs.readFileSync(file, 'utf8').trim();
  const pem = publicKeyPem ?? env.WHALYOM_LICENSE_PUBKEY?.replace(/\\n/g, '\n') ?? PUBLIC_KEY_PEM;
  return verifyLicense(key, { publicKeyPem: pem });
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
  if (args.includes('--keygen')) {
    const dir = opt('--keygen');
    if (!dir) { console.error('Usage: --keygen <dir>'); process.exit(2); }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'license-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'license-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    console.log(JSON.stringify({ wrote: [path.join(dir, 'license-private.pem'), path.join(dir, 'license-public.pem')], note: 'keep the private key offline; embed the public key in PUBLIC_KEY_PEM' }));
  } else if (args.includes('--issue')) {
    const pem = fs.readFileSync(opt('--private'), 'utf8');
    console.log(issueLicense(pem, { edition: opt('--edition'), licensee: opt('--licensee'), seats: Number(opt('--seats') ?? 1), ...(opt('--expires') ? { expires: opt('--expires') } : {}) }));
  } else {
    const i = args.indexOf('--verify');
    const key = i > -1 ? args[i + 1] : undefined;
    console.log(JSON.stringify(key ? verifyLicense(key, { publicKeyPem: process.env.WHALYOM_LICENSE_PUBKEY?.replace(/\\n/g, '\n') ?? PUBLIC_KEY_PEM }) : checkLicense(), null, 2));
  }
}
