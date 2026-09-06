const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bumpVersion } = require('../scripts/bump-version.cjs');

test('consecutive builds advance version and code in every manifest without losing configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-version-'));
  try {
    for (const [name, data] of Object.entries({
      'app.json': { expo: { version: '1.0.9', android: { versionCode: 20, package: 'it.massimo.streammark' } } },
      'package.json': { name: 'bookmark', version: '1.0.9', dependencies: { react: 'existing' } },
      'package-lock.json': { version: '1.0.9', packages: { '': { version: '1.0.9' }, 'node_modules/react': { version: 'existing' } } },
    })) fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
    assert.deepEqual(bumpVersion(dir), { version: '1.0.10', build: 21 });
    assert.deepEqual(bumpVersion(dir), { version: '1.0.11', build: 22 });
    const read = name => JSON.parse(fs.readFileSync(path.join(dir, name)));
    assert.equal(read('app.json').expo.android.package, 'it.massimo.streammark');
    assert.ok(Date.parse(read('app.json').expo.extra.builtAt));
    assert.equal(read('package.json').version, '1.0.11');
    assert.equal(read('package-lock.json').packages[''].version, '1.0.11');
    assert.equal(read('package-lock.json').packages['node_modules/react'].version, 'existing');
  } finally { fs.rmSync(dir, { recursive: true }); }
});
