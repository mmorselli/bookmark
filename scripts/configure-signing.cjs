const fs = require('node:fs');
const path = require('node:path');
for (const key of ['STREAMMARK_KEYSTORE', 'STREAMMARK_STORE_PASSWORD', 'STREAMMARK_KEY_ALIAS', 'STREAMMARK_KEY_PASSWORD']) {
  if (!process.env[key]) throw new Error(`Variabile richiesta: ${key}`);
}
if (!fs.existsSync(path.resolve(process.env.STREAMMARK_KEYSTORE))) throw new Error('Keystore non trovato.');
const file = 'android/app/build.gradle';
let gradle = fs.readFileSync(file, 'utf8');
gradle = gradle.replace('signingConfigs {', `signingConfigs {
        streammark {
            storeFile file(System.getenv('STREAMMARK_KEYSTORE'))
            storePassword System.getenv('STREAMMARK_STORE_PASSWORD')
            keyAlias System.getenv('STREAMMARK_KEY_ALIAS')
            keyPassword System.getenv('STREAMMARK_KEY_PASSWORD')
        }`);
const releaseIndex = gradle.indexOf('        release {');
if (releaseIndex < 0) throw new Error('Configurazione release non trovata.');
gradle = gradle.slice(0, releaseIndex) + gradle.slice(releaseIndex).replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.streammark');
fs.writeFileSync(file, gradle);
