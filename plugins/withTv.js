const { withAndroidManifest, withAppBuildGradle, withMainActivity, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function withTv(config) {
  config = withAppBuildGradle(config, config => {
    const marker = '// Bookmark automatic build version';
    if (!config.modResults.contents.includes(marker)) config.modResults.contents += `
${marker}
// Reserve a unique version before bundling JS or processing the Android manifest.
// Also applies to direct Gradle builds and expo run:android; library tests are excluded.
if (gradle.startParameter.taskNames.any { task ->
    (!task.contains(':') || task.startsWith(':app:') || task.startsWith('app:')) &&
    task.tokenize(':').last() ==~ /((assemble|bundle|install|package)(Debug|Release)?|build)/
}) {
    def result = providers.exec {
        workingDir rootProject.projectDir.parentFile
        commandLine 'node', 'scripts/bump-version.cjs', '--json'
    }.standardOutput.asText.get()
    def bookmarkBuild = new groovy.json.JsonSlurper().parseText(result)
    android.defaultConfig.versionName = bookmarkBuild.version
    android.defaultConfig.versionCode = bookmarkBuild.build as int
    println("Bookmark " + bookmarkBuild.version + " · build " + bookmarkBuild.build)
}
`;
    return config;
  });
  config = withMainApplication(config, config => {
    if (!config.modResults.contents.includes('DiagnosticLog.initialize')) {
      config.modResults.contents = config.modResults.contents.replace('super.onCreate()', 'super.onCreate()\n    expo.modules.streammark.DiagnosticLog.initialize(this)');
    }
    return config;
  });
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest['uses-feature'] = [
      { $: { 'android:name': 'android.software.leanback', 'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'false' } },
    ];
    manifest.queries = [{ intent: [{
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
      data: [{ $: { 'android:scheme': 'https' } }],
    }] }];
    const app = manifest.application[0];
    app.$['android:banner'] = '@drawable/tv_banner';
    app.$['android:icon'] = '@drawable/streammark_icon';
    delete app.$['android:roundIcon'];
    const main = app.activity.find(a => a.$['android:name'] === '.MainActivity');
    main.$['android:screenOrientation'] = 'landscape';
    const launcher = main['intent-filter'].find(f => f.action?.some(a => a.$['android:name'] === 'android.intent.action.MAIN'));
    launcher.category.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
    return config;
  });
  config = withMainActivity(config, config => {
    const marker = '  // StreamMark TV input';
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents = config.modResults.contents.replace('class MainActivity : ReactActivity() {', `class MainActivity : ReactActivity() {
${marker}
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    if (expo.modules.streammark.TvInput.dispatch(event)) return true
    return super.dispatchKeyEvent(event)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    expo.modules.streammark.DiagnosticLog.write("activity.windowFocus", "hasFocus=$hasFocus")
    super.onWindowFocusChanged(hasFocus)
    if (!hasFocus) expo.modules.streammark.TvInput.reset()
    if (hasFocus) {
      androidx.core.view.WindowCompat.getInsetsController(window, window.decorView).apply {
        hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
    }
  }
`);
    }
    if (!config.modResults.contents.includes('activity.result.raw')) {
      const create = 'override fun onCreate(savedInstanceState: Bundle?) {';
      config.modResults.contents = config.modResults.contents.replace(create, `${create}
    expo.modules.streammark.DiagnosticLog.initialize(this)
    expo.modules.streammark.DiagnosticLog.write("activity.create", "savedState=" + (savedInstanceState != null) + " task=" + taskId)
`);
      const lifecycle = ['Start', 'Resume', 'Pause', 'Stop', 'Destroy'].map(name => `
  override fun on${name}() {
    expo.modules.streammark.DiagnosticLog.write("activity.${name.toLowerCase()}", "finishing=" + isFinishing + " changingConfig=" + isChangingConfigurations)
    super.on${name}()
  }
`).join('');
      config.modResults.contents = config.modResults.contents.replace('class MainActivity : ReactActivity() {', `class MainActivity : ReactActivity() {
${lifecycle}
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
    expo.modules.streammark.DiagnosticLog.write("activity.result.raw", "request=$requestCode result=$resultCode " + expo.modules.streammark.DiagnosticLog.intentInfo(data))
    super.onActivityResult(requestCode, resultCode, data)
    expo.modules.streammark.DiagnosticLog.write("activity.result.forwarded", "request=$requestCode")
  }

  override fun onNewIntent(intent: android.content.Intent) {
    expo.modules.streammark.DiagnosticLog.write("activity.newIntent", expo.modules.streammark.DiagnosticLog.intentInfo(intent))
    super.onNewIntent(intent)
  }
`);
    }
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const resources = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
    await fs.mkdir(resources, { recursive: true });
    for (const name of ['tv_banner.xml', 'streammark_icon.xml']) {
      await fs.copyFile(path.join(__dirname, 'resources', name), path.join(resources, name));
    }
    return config;
  }]);
};
