package expo.modules.streammark

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream

internal class HtmlImportException(val code: String, message: String, cause: Throwable? = null) :
  Exception(message, cause)

internal object HtmlImport {
  private const val MAX_BYTES = 20 * 1024 * 1024

  fun pickerIntent(action: String) = Intent(action).apply {
    // Keep all files visible: USB providers may advertise HTML as octet-stream.
    type = "*/*"
    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
    addCategory(Intent.CATEGORY_OPENABLE)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }

  @Suppress("DEPRECATION")
  fun selectedUri(resultCode: Int, data: Intent?): Uri? {
    // A cancellation is distinct from a successful result with no usable file.
    if (resultCode == Activity.RESULT_CANCELED) return null
    if (resultCode != Activity.RESULT_OK) {
      throw HtmlImportException("PICKER_RESULT", "Il gestore file ha restituito un risultato inatteso ($resultCode). Riprova con un altro gestore file.")
    }
    val uris = linkedSetOf<Uri>()
    data?.data?.let(uris::add)
    data?.clipData?.let { clip ->
      for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(uris::add)
    }
    // Some file managers use the stream extra even for a single-file selection.
    if (uris.isEmpty()) data?.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let(uris::add)
    if (uris.isEmpty()) {
      throw HtmlImportException("PICKER_NO_FILE", "Il gestore file ha confermato la selezione senza restituire un file leggibile. Riprova con un altro gestore file. (PICKER_NO_FILE)")
    }
    if (uris.size != 1) throw HtmlImportException("PICKER_MULTIPLE", "Seleziona un solo file HTML alla volta.")
    return uris.single().also { uri ->
      if (uri.scheme !in listOf("content", "file")) {
        throw HtmlImportException("PICKER_URI", "Il gestore file ha restituito un indirizzo non supportato. Seleziona un file locale. (PICKER_URI)")
      }
    }
  }

  fun read(resolver: ContentResolver, uri: Uri): Map<String, String> {
    DiagnosticLog.write("reader.metadata.begin", DiagnosticLog.uriInfo(uri))
    // Display-name metadata is optional. Its absence must not prevent reading.
    val name = runCatching {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
      }
    }.onFailure { DiagnosticLog.write("reader.metadata.failed", error = it) }.getOrNull()?.takeIf { it.isNotBlank() } ?: "bookmarks.html"
    DiagnosticLog.write("reader.metadata.complete", "nameChars=${name.length} mime=${runCatching { resolver.getType(uri) }.getOrNull()}")
    try {
      DiagnosticLog.write("reader.stream.open")
      val stream = resolver.openInputStream(uri)
        ?: throw HtmlImportException("READ_FAILED", "Impossibile aprire il file selezionato. (READ_FAILED)")
      val output = ByteArrayOutputStream()
      stream.use { input ->
        val buffer = ByteArray(8192)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          if (output.size() + count > MAX_BYTES) throw HtmlImportException("FILE_TOO_LARGE", "Il file supera il limite di 20 MB.")
          output.write(buffer, 0, count)
          if (output.size() == count || output.size() % (256 * 1024) < count)
            DiagnosticLog.write("reader.stream.progress", "bytes=${output.size()}")
        }
      }
      val bytes = output.toByteArray()
      DiagnosticLog.write("reader.stream.closed", "bytes=${bytes.size}")
      if (bytes.isEmpty()) throw HtmlImportException("FILE_EMPTY", "Il file selezionato è vuoto. Esporta di nuovo i segnalibri da Firefox.")
      val encoding = when {
        bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte() -> Charsets.UTF_16LE
        bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte() -> Charsets.UTF_16BE
        else -> Charsets.UTF_8
      }
      DiagnosticLog.write("reader.decode", "encoding=$encoding bytes=${bytes.size}")
      return mapOf("name" to name, "html" to String(bytes, encoding).removePrefix("\uFEFF"))
    } catch (e: SecurityException) {
      throw HtmlImportException("READ_PERMISSION", "Il gestore file non ha concesso l'accesso al file. Prova a copiarlo nella cartella Download e selezionalo di nuovo. (READ_PERMISSION)", e)
    }
  }
}
