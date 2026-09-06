#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

SKIP_INSTALL=false
OFFLINE=false
for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=true ;;
    --offline) OFFLINE=true ;;
    *) printf 'Opzione sconosciuta: %s\n' "$arg" >&2; exit 1 ;;
  esac
done
command -v node >/dev/null || { echo 'Installa Node.js 22 LTS.' >&2; exit 1; }
[[ "$(node -p "process.versions.node.split('.')[0]")" == 22 ]] || { echo 'Usa Node.js 22 LTS (nvm use).' >&2; exit 1; }
command -v java >/dev/null || { echo 'Installa OpenJDK 21.' >&2; exit 1; }

export ANDROID_HOME="${ANDROID_HOME:-/home/$(id -un)/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
[[ -d "$ANDROID_HOME/platforms/android-36" ]] || { echo 'Installa Android SDK 36 e configura ANDROID_HOME.' >&2; exit 1; }

# Serialize version reservation and APK compilation; failed builds keep their number.
mkdir -p .build
exec 9>.build/android.lock
flock 9
if ! $SKIP_INSTALL; then npm ci --include=dev; fi
npm run typecheck
npm test
export NODE_ENV=production
CI=1 npx expo prebuild --platform android --clean --no-install
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties

# A stable local key allows subsequent sideloaded versions to update the app.
# For distribution, supply a private keystore using the variables documented in README.
if [[ -n "${STREAMMARK_KEYSTORE:-}" ]]; then
  node scripts/configure-signing.cjs
fi

# Include both x86 ABIs for tablet and Android TV AVDs. ARM translation can
# install the APK, but SoLoader needs libraries matching the emulator's ABI.
GRADLE_ARGS=(--no-daemon --max-workers=4 "-PreactNativeArchitectures=${STREAMMARK_ARCHITECTURES:-armeabi-v7a,arm64-v8a,x86,x86_64}")
if $OFFLINE; then GRADLE_ARGS+=(--offline); fi
(
  cd android
  ./gradlew :app:assembleRelease "${GRADLE_ARGS[@]}"
)

mkdir -p dist
VERSION="$(node -p "require('./package.json').version")"
BUILD_NUMBER="$(node -p "require('./app.json').expo.android.versionCode")"
OUTPUT_APK="$PROJECT_DIR/dist/Bookmark-$VERSION-build-$BUILD_NUMBER.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUTPUT_APK"
printf '\nAPK pronto: %s\n' "$OUTPUT_APK"
if [[ -n "${STREAMMARK_COPY_TO:-}" ]]; then
  mkdir -p "$STREAMMARK_COPY_TO"
  cp "$OUTPUT_APK" "$STREAMMARK_COPY_TO/"
fi
