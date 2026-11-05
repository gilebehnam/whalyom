// The logo: the brand kit's artwork is shipped and served, and the vector redraw keeps the kit's colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markSvg, faviconSvg, GOLD, CREAM, NIGHT } from '../make-logo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('brand kit artwork and its web sizes are in the repo', () => {
  for (const f of ['kit/logos/whalyom-horizontal-en.png', 'kit/logos/whalyom-horizontal-fa.png', 'kit/logos/whalyom-symbol.png', 'kit/tokens.json', 'web/whalyom-horizontal-en.png', 'web/whalyom-horizontal-fa.png', 'web/whalyom-symbol.png'])
    assert.ok(fs.existsSync(path.join(root, 'assets', 'brand', f)), f);
  const tokens = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'brand', 'kit', 'tokens.json'), 'utf8'));
  assert.equal(tokens.color.brand.brass.$value, GOLD);
  assert.equal(tokens.color.brand.ivory.$value, CREAM);
  assert.equal(tokens.color.background.$value, NIGHT);
});

test('the vector mark keeps the brass arc and the favicon sits on the ink tile', () => {
  assert.ok(markSvg().includes(`stroke="${GOLD}"`));
  assert.match(markSvg(), /viewBox="0 0 100 100"/);
  assert.ok(faviconSvg().includes(`fill="${NIGHT}"`));
});

test('the Command Center masthead shows the kit logos, not the wordmark as text', () => {
  const html = fs.readFileSync(path.join(root, 'live', 'index.html'), 'utf8');
  assert.match(html, /<!-- brand:logo -->[\s\S]*alt="WHALYOM"[\s\S]*alt="والیوم"[\s\S]*<!-- \/brand:logo -->/);
  assert.ok(!/<h1 aria-label="Whalyom"><span class="lt"/.test(html));
});
