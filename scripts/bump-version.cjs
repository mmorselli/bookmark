const fs = require('node:fs');
const path = require('node:path');

function bumpVersion(root) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const app = read('app.json');
  const pkg = read('package.json');
  const lock = read('package-lock.json');
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(app.expo.version);
  if (!match || pkg.version !== app.expo.version) throw new Error('Versioni app.json/package.json non allineate.');
  const version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  const build = app.expo.android.versionCode + 1;
  if (!Number.isSafeInteger(build) || build > 2100000000) throw new Error('versionCode non valido.');
  app.expo.version = pkg.version = lock.version = lock.packages[''].version = version;
  app.expo.android.versionCode = build;
  app.expo.extra = { ...app.expo.extra, builtAt: new Date().toISOString() };
  for (const [name, value] of [['app.json', app], ['package.json', pkg], ['package-lock.json', lock]]) {
    fs.writeFileSync(path.join(root, `${name}.tmp`), JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(path.join(root, `${name}.tmp`), path.join(root, name));
  }
  return { version, build };
}

module.exports = { bumpVersion };
if (require.main === module) {
  const { version, build } = bumpVersion(path.resolve(__dirname, '..'));
  console.log(process.argv.includes('--json') ? JSON.stringify({ version, build }) : `Bookmark ${version} · build ${build}`);
}
