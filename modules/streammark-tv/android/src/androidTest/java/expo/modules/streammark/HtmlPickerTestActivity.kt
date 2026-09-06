package expo.modules.streammark

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout

/** File-manager fixture; included only in the test APK, never in Bookmark. */
class HtmlPickerTestActivity : Activity() {
  override fun onCreate(state: Bundle?) {
    setTheme(android.R.style.Theme_Material_NoActionBar)
    super.onCreate(state)
    val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    val uri = Uri.parse("content://it.massimo.bookmark.importtests/html")
    fun option(label: String, result: () -> Intent?, code: Int = RESULT_OK) {
      layout.addView(Button(this).apply {
        text = label
        setOnClickListener { setResult(code, result()); finish() }
      })
    }
    option("URI standard", { Intent().setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) })
    option("Solo ClipData", { Intent().apply { clipData = ClipData.newRawUri("HTML", uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) } })
    option("Risposta senza file", { Intent() })
    option("Annulla", { null }, RESULT_CANCELED)
    option("File senza permesso", { Intent().setData(uri) })
    setContentView(layout)
  }
}
