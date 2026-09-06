package expo.modules.streammark

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Process
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Persistent diagnostics, usable before React Native and across process restarts. */
object DiagnosticLog {
  private const val MAX_FILE_BYTES = 2 * 1024 * 1024
  private var directory: File? = null
  private var appInfo: Map<String, String> = emptyMap()
  private var writeError: String? = null
  private val session = "${Process.myPid()}-${System.currentTimeMillis().toString(36)}"
  private val time = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }

  @Synchronized fun initialize(context: Context) {
    if (directory != null) return
    directory = File(context.applicationContext.filesDir, "logs")
    @Suppress("DEPRECATION")
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    appInfo = mapOf("version" to (info.versionName ?: "?"), "build" to info.versionCode.toString(),
      "device" to "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} / API ${Build.VERSION.SDK_INT} · ${Build.SUPPORTED_ABIS.joinToString()}",
      "package" to context.packageName)
    write("process.start", "$appInfo session=$session previousPending=${context.getSharedPreferences("bookmark-import", Context.MODE_PRIVATE).getBoolean("pending", false)}")
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      write("native.uncaught", "thread=${thread.name}", error)
      previous?.uncaughtException(thread, error)
    }
  }

  @Synchronized fun info(context: Context): Map<String, String> { initialize(context); return appInfo }

  @Synchronized fun write(event: String, details: String = "", error: Throwable? = null) {
    try {
      val dir = directory ?: return
      check(dir.isDirectory || dir.mkdirs()) { "Impossibile creare la cartella log" }
      val current = File(dir, "bookmark.log")
      if (current.length() >= MAX_FILE_BYTES) {
        val previous = File(dir, "bookmark.previous.log")
        if (previous.exists()) check(previous.delete())
        check(current.renameTo(previous))
      }
      val line = "${time.format(Date())} [$session/${Thread.currentThread().name}] ${event.take(160)} ${details.take(8192)}" +
        (error?.let { "\n${Log.getStackTraceString(it).take(16384)}" } ?: "") + "\n"
      current.appendText(line, Charsets.UTF_8)
      writeError = null
    } catch (e: Exception) {
      writeError = "Log su file non disponibile: ${e.javaClass.simpleName}: ${e.message}"
      Log.e("BookmarkLog", writeError, e)
    }
  }

  // Record URI shape and provider, never bookmark contents or private file paths.
  fun uriInfo(uri: Uri?): String = uri?.let { "scheme=${it.scheme} authority=${it.authority} pathChars=${it.path?.length} query=${it.query != null}" } ?: "null"
  fun intentInfo(intent: Intent?): String = runCatching {
    if (intent == null) "intent=null" else {
      val clips = intent.clipData
      "action=${intent.action} type=${intent.type} flags=0x${intent.flags.toString(16)} data={${uriInfo(intent.data)}} " +
        "clipCount=${clips?.itemCount ?: 0} clips=${(0 until minOf(clips?.itemCount ?: 0, 5)).map { uriInfo(clips!!.getItemAt(it).uri) }} " +
        "extraKeys=${intent.extras?.keySet()?.sorted()}"
    }
  }.getOrElse { "intent inspection failed: ${it.javaClass.simpleName}" }

  @Synchronized private fun contents(): String {
    val dir = requireNotNull(directory) { "Log non inizializzato" }
    return "Bookmark ${appInfo["version"]} · build ${appInfo["build"]}\n${appInfo["device"]}\n${appInfo["package"]}\n\n" +
      listOf("bookmark.previous.log", "bookmark.log").joinToString("") { name ->
        File(dir, name).takeIf { it.exists() }?.readText(Charsets.UTF_8) ?: ""
      }
  }

  @Synchronized fun snapshot(context: Context): Map<String, String> {
    initialize(context)
    val text = contents()
    return appInfo + mapOf("filePath" to File(directory, "bookmark.log").absolutePath,
      "text" to text.takeLast(60000), "truncated" to (text.length > 60000).toString(), "writeError" to (writeError ?: ""))
  }

  fun export(context: Context): String {
    initialize(context)
    check(Build.VERSION.SDK_INT >= 29) { "Il salvataggio diretto in Download richiede Android 10 o successivo. Il log resta consultabile in questa schermata." }
    write("log.export.begin")
    val text = synchronized(this) { contents() }
    val stamp = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.ROOT).format(Date())
    val name = "Bookmark-${appInfo["version"]}-build-${appInfo["build"]}-$stamp.log.txt"
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.MIME_TYPE, "text/plain")
      put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Bookmark")
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val uri = requireNotNull(resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)) { "Impossibile creare il file nella cartella Download." }
    try {
      requireNotNull(resolver.openOutputStream(uri)).bufferedWriter(Charsets.UTF_8).use { it.write(text) }
      check(resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null) == 1)
      // MediaStore may adjust a display name (extension or duplicate suffix).
      val savedName = runCatching {
        resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use {
          if (it.moveToFirst()) it.getString(0) else null
        }
      }.getOrNull() ?: name
      write("log.export.complete", "name=$savedName chars=${text.length}")
      return "${Environment.DIRECTORY_DOWNLOADS}/Bookmark/$savedName"
    } catch (e: Exception) {
      runCatching { resolver.delete(uri, null, null) }
      write("log.export.failed", error = e)
      throw e
    }
  }
}
