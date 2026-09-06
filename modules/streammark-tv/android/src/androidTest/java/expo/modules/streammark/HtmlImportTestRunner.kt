package expo.modules.streammark

import android.app.Activity
import android.app.Instrumentation
import android.content.ClipData
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle

/** On-device regression tests using the real Intent and ContentResolver APIs. */
class HtmlImportTestRunner : Instrumentation() {
  override fun onCreate(arguments: Bundle?) {
    super.onCreate(arguments)
    val picker = arguments?.getString("picker")
    if (picker == "get-content-only" || picker == "both") {
      context.packageManager.setComponentEnabledSetting(
        ComponentName(context, "expo.modules.streammark.HtmlDocumentPickerTestActivity"),
        if (picker == "get-content-only") PackageManager.COMPONENT_ENABLED_STATE_DISABLED else PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
        PackageManager.DONT_KILL_APP
      )
      finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "Test picker: $picker\n") })
      return
    }
    start()
  }

  override fun onStart() {
    var passed = 0
    fun test(name: String, body: () -> Unit) {
      try { body(); passed++ }
      catch (e: Throwable) { throw AssertionError("$name: ${e.message}", e) }
    }
    fun expectError(code: String, body: () -> Unit) {
      try { body(); error("Expected $code") }
      catch (e: HtmlImportException) { check(e.code == code) { "${e.code} != $code" } }
    }
    val uri = Uri.parse("content://it.massimo.bookmark.importtests/html")
    fun fixture(path: String) = uri.buildUpon().path(path).build()
    try {
      test("failed OPEN_DOCUMENT cancellation cannot consume the GET_CONTENT result") {
        val requests = PickerRequestTracker()
        val failedDocument = requests.begin()
        val fallback = requests.begin()
        check(failedDocument != fallback)
        // Replay the HK1 RBOX H8 log: launch failure, cancellation, then selected file.
        check(!requests.accept(failedDocument))
        check(requests.activeCode == fallback)
        check(requests.accept(fallback))
        check(HtmlImport.selectedUri(Activity.RESULT_OK, Intent().setData(uri)) == uri)
        check(!requests.accept(fallback))
      }
      test("cancelling the active fallback is still a real cancellation") {
        val requests = PickerRequestTracker()
        requests.begin()
        val fallback = requests.begin()
        check(requests.accept(fallback))
        check(HtmlImport.selectedUri(Activity.RESULT_CANCELED, null) == null)
        check(requests.activeCode == null)
      }
      test("late callbacks cannot affect a later import") {
        val requests = PickerRequestTracker()
        val previous = requests.begin()
        check(requests.accept(previous))
        val current = requests.begin()
        check(!requests.accept(previous))
        check(requests.activeCode == current)
        check(requests.accept(current))
      }
      test("request allocation resumes after module recreation and stays within 16 bits") {
        val savedCode = PickerRequestTracker().begin()
        val restored = PickerRequestTracker(savedCode)
        check(restored.begin() != savedCode)
        check(!restored.accept(savedCode))
        val boundary = PickerRequestTracker(65534)
        check(boundary.begin() == 65535)
        check(boundary.begin() in 4927..65535)
        boundary.clear()
        check(boundary.activeCode == null)
      }
      test("ordinary data URI") {
        check(HtmlImport.selectedUri(Activity.RESULT_OK, Intent().setData(uri)) == uri)
      }
      test("ClipData-only result") {
        val result = Intent().apply { clipData = ClipData.newRawUri("HTML", uri) }
        check(HtmlImport.selectedUri(Activity.RESULT_OK, result) == uri)
      }
      test("same URI in both fields") {
        val result = Intent().setData(uri).apply { clipData = ClipData.newRawUri("HTML", uri) }
        check(HtmlImport.selectedUri(Activity.RESULT_OK, result) == uri)
      }
      test("stream extra") {
        check(HtmlImport.selectedUri(Activity.RESULT_OK, Intent().putExtra(Intent.EXTRA_STREAM, uri)) == uri)
      }
      test("cancellation never imports even if data is attached") {
        check(HtmlImport.selectedUri(Activity.RESULT_CANCELED, null) == null)
        check(HtmlImport.selectedUri(Activity.RESULT_CANCELED, Intent().setData(uri)) == null)
      }
      test("successful result with no file is an error, not cancellation") {
        expectError("PICKER_NO_FILE") { HtmlImport.selectedUri(Activity.RESULT_OK, null) }
        expectError("PICKER_NO_FILE") { HtmlImport.selectedUri(Activity.RESULT_OK, Intent()) }
        expectError("PICKER_NO_FILE") {
          HtmlImport.selectedUri(Activity.RESULT_OK, Intent().apply { clipData = ClipData.newPlainText("HTML", "not a URI") })
        }
      }
      test("unexpected result code") {
        expectError("PICKER_RESULT") { HtmlImport.selectedUri(42, Intent().setData(uri)) }
      }
      test("multiple files are not silently truncated") {
        val result = Intent().apply {
          clipData = ClipData.newRawUri("HTML", uri).apply { addItem(ClipData.Item(fixture("second"))) }
        }
        expectError("PICKER_MULTIPLE") { HtmlImport.selectedUri(Activity.RESULT_OK, result) }
      }
      test("unsupported URI scheme") {
        expectError("PICKER_URI") { HtmlImport.selectedUri(Activity.RESULT_OK, Intent().setData(Uri.parse("https://example.org/a"))) }
      }
      test("real content stream with UTF-8 text") {
        val file = HtmlImport.read(context.contentResolver, uri)
        check(file["name"] == "demo.html")
        check(file["html"] == HtmlImportTestProvider.HTML)
      }
      test("metadata query failure does not prevent reading") {
        val file = HtmlImport.read(context.contentResolver, fixture("no-metadata"))
        check(file["name"] == "bookmarks.html")
        check(file["html"] == HtmlImportTestProvider.HTML)
      }
      test("missing display-name column does not prevent reading") {
        check(HtmlImport.read(context.contentResolver, fixture("missing-column"))["html"] == HtmlImportTestProvider.HTML)
      }
      test("UTF-16 export") {
        check(HtmlImport.read(context.contentResolver, fixture("utf16"))["html"] == HtmlImportTestProvider.HTML)
      }
      test("empty file") {
        expectError("FILE_EMPTY") { HtmlImport.read(context.contentResolver, fixture("empty")) }
      }
      test("read permission denied") {
        expectError("READ_PERMISSION") { HtmlImport.read(context.contentResolver, fixture("denied")) }
      }
      test("20 MB limit") {
        expectError("FILE_TOO_LARGE") { HtmlImport.read(context.contentResolver, fixture("large")) }
      }
      test("single-file picker grants read access") {
        val intent = HtmlImport.pickerIntent(Intent.ACTION_GET_CONTENT)
        check(intent.action == Intent.ACTION_GET_CONTENT && intent.type == "*/*")
        check(!intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, true))
        check(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
      }
      test("persistent log rotation and bounded viewer snapshot") {
        DiagnosticLog.initialize(context)
        repeat(300) { DiagnosticLog.write("test.rotation", "$it " + "x".repeat(8100)) }
        DiagnosticLog.write("test.rotation.complete", "last record retained")
        val snapshot = DiagnosticLog.snapshot(context)
        check(snapshot["writeError"] == "")
        check(snapshot["text"]!!.endsWith("last record retained\n"))
        check(snapshot["text"]!!.length <= 60000 && snapshot["truncated"] == "true")
        val previous = java.io.File(context.filesDir, "logs/bookmark.previous.log")
        check(previous.exists() && previous.length() <= 2 * 1024 * 1024 + 20000)
      }
      test("intent diagnostics omit file paths and contents") {
        val result = Intent().setData(Uri.parse("content://provider/private/export.html?token=secret"))
          .putExtra("sensitive-extra", "private file contents")
        val summary = DiagnosticLog.intentInfo(result)
        check("authority=provider" in summary && "sensitive-extra" in summary)
        check("export.html" !in summary && "secret" !in summary && "private file contents" !in summary)
      }
      finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "OK: $passed native import tests passed\n") })
    } catch (e: Throwable) {
      finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "FAILED after $passed tests: ${e.stackTraceToString()}\n") })
    }
  }
}
