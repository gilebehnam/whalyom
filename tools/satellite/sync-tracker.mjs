// Copies the tracker from whalyom-satellite.mjs (the single source of truth) into the integrations
// that ship it as a file. Run after editing TRACKER_JS:  node tools/satellite/sync-tracker.mjs
// tools/test/satellite-stacks.test.mjs fails when a copy drifts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKER_JS, BOOST_JS } from './whalyom-satellite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TRACKER_COPIES = ['integrations/snippet/whalyom.js', 'integrations/wordpress/whalyom/assets/whalyom.js'];
export const BOOST_COPIES = ['integrations/wordpress/whalyom/assets/whalyom-boost.js'];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const rel of TRACKER_COPIES) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, TRACKER_JS);
    console.log(`wrote ${rel}`);
  }
  for (const rel of BOOST_COPIES) {
    fs.writeFileSync(path.join(root, rel), BOOST_JS);
    console.log(`wrote ${rel}`);
  }
}
