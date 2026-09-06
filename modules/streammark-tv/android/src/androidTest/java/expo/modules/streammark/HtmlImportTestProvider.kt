package expo.modules.streammark

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

class HtmlImportTestProvider : ContentProvider() {
  companion object {
    const val HTML = "<DL><DT><A HREF=\"https://example.org/import-test\">Segnalibro di prova è 🎬</A></DL>"
  }
  override fun onCreate() = true
  override fun getType(uri: Uri) = "text/html"
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
    if (uri.lastPathSegment == "no-metadata") throw UnsupportedOperationException("No metadata")
    if (uri.lastPathSegment == "missing-column") return MatrixCursor(arrayOf("other"))
    return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME)).apply { addRow(arrayOf("demo.html")) }
  }
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (uri.lastPathSegment == "denied") throw SecurityException("No read grant")
    val file = File.createTempFile("html-import-", ".html", requireNotNull(context).cacheDir)
    try {
      when (uri.lastPathSegment) {
        "empty" -> file.writeBytes(byteArrayOf())
        "utf16" -> file.writeBytes("\uFEFF$HTML".toByteArray(Charsets.UTF_16LE))
        "large" -> file.outputStream().use { out -> repeat(21 * 128) { out.write(ByteArray(8192)) } }
        else -> file.writeText(HTML)
      }
      return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    } finally { file.delete() }
  }
  override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
  override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int = throw UnsupportedOperationException()
  override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?): Int = throw UnsupportedOperationException()
}
