package expo.modules.streammark

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

class StreamMarkModule : Module() {
  private var pendingPicker: Promise? = null
  private val reader = Executors.newSingleThreadExecutor()
  private var importId = "none"
  private fun log(event: String, details: String = "", error: Throwable? = null) =
    DiagnosticLog.write(event, "import=$importId $details", error)
  private val importState by lazy {
    requireNotNull(appContext.reactContext).getSharedPreferences("bookmark-import", Context.MODE_PRIVATE)
  }
  private val pickerRequests by lazy { PickerRequestTracker(importState.getInt("lastRequestCode", 4926)) }

  private fun launchPicker(activity: Activity, action: String) {
    val code = pickerRequests.begin()
    // Persist across module/process recreation so an old callback cannot match a new import.
    importState.edit().putInt("lastRequestCode", code).apply()
    log("picker.launch", "action=$action request=$code activity=${activity.javaClass.name}")
    activity.startActivityForResult(HtmlImport.pickerIntent(action), code)
  }

  private fun finishPicker() {
    log("picker.finish")
    importState.edit().remove("pending").apply()
  }

  override fun definition() = ModuleDefinition {
    Name("StreamMarkTV")
    Events("onRemoteKey")

    OnCreate {
      appContext.reactContext?.let { DiagnosticLog.initialize(it) }
      log("module.create")
      TvInput.listener = { sendEvent("onRemoteKey", mapOf("key" to it)) }
    }
    OnActivityEntersBackground { log("module.background", "pending=${pendingPicker != null}"); TvInput.reset() }
    OnActivityEntersForeground {
      log("module.foreground", "pending=${pendingPicker != null}")
      Handler(Looper.getMainLooper()).postDelayed({
        if (pendingPicker != null && appContext.currentActivity?.hasWindowFocus() == true)
          log("picker.awaiting_result_after_resume", "pending=true; app has focus but no result received")
      }, 2000)
    }
    OnDestroy {
      log("module.destroy", "pending=${pendingPicker != null}")
      TvInput.enabled = false
      TvInput.reset()
      TvInput.listener = null
      pendingPicker?.reject("CLOSED", "Importazione interrotta. Riprova.", null)
      pendingPicker = null
      reader.shutdown()
    }
    Function("setInputEnabled") { enabled: Boolean -> TvInput.enabled = enabled }
    Function("getAppInfo") { DiagnosticLog.info(requireNotNull(appContext.reactContext)) }
    Function("writeDiagnostic") { event: String, details: String -> DiagnosticLog.write("js.$event", details) }
    AsyncFunction("readDiagnostics") { DiagnosticLog.snapshot(requireNotNull(appContext.reactContext)) }
    AsyncFunction("exportDiagnostics") { DiagnosticLog.export(requireNotNull(appContext.reactContext)) }
    Function("consumeImportInterruption") {
      val interrupted = pendingPicker == null && importState.getBoolean("pending", false)
      log("picker.consumeInterruption", "interrupted=$interrupted pending=${pendingPicker != null}")
      if (interrupted) finishPicker()
      interrupted
    }

    AsyncFunction("pickHtml") { attempt: String, promise: Promise ->
      log("picker.request", "attempt=$attempt pending=${pendingPicker != null}")
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "Impossibile aprire il selettore file.", null)
      } else if (pendingPicker != null) {
        promise.reject("PICKER_BUSY", "Seleziona prima il file già richiesto.", null)
      } else {
        importId = attempt
        pendingPicker = promise
        importState.edit().putBoolean("pending", true).apply()
        try {
          // Prefer the document picker. A generic GET_CONTENT request can be
          // intercepted by TV photo pickers even when a file manager is present.
          try {
            launchPicker(activity, Intent.ACTION_OPEN_DOCUMENT)
          } catch (e: ActivityNotFoundException) {
            // Android can send RESULT_CANCELED for the failed launch after this
            // catch. Its code must not close the fallback's pending promise.
            log("picker.fallback", "abandonedRequest=${pickerRequests.activeCode} action=GET_CONTENT", e)
            launchPicker(activity, Intent.ACTION_GET_CONTENT)
          }
          log("picker.launched")
        } catch (e: Exception) {
          log("picker.launch.failed", error = e)
          pendingPicker = null
          pickerRequests.clear()
          finishPicker()
          promise.reject("NO_PICKER", "Impossibile aprire il selettore. Installa un gestore file compatibile con Android TV e riprova. (NO_PICKER)", e)
        }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, result ->
      val promise = pendingPicker
      val expectedCode = pickerRequests.activeCode
      log("module.activityResult", "request=${result.requestCode} expected=$expectedCode result=${result.resultCode} pending=${promise != null} ${DiagnosticLog.intentInfo(result.data)}")
      if (promise != null && pickerRequests.accept(result.requestCode)) {
        pendingPicker = null
        try {
          val uri = HtmlImport.selectedUri(result.resultCode, result.data)
          log("picker.uri", DiagnosticLog.uriInfo(uri))
          if (uri == null) {
            finishPicker()
            promise.resolve(null)
            log("picker.resolved.cancelled")
          } else {
            val resolver = requireNotNull(appContext.reactContext).contentResolver
            reader.execute {
              try {
                log("reader.begin", DiagnosticLog.uriInfo(uri))
                val file = HtmlImport.read(resolver, uri)
                log("reader.complete", "chars=${file["html"]?.length}")
                finishPicker()
                promise.resolve(file)
                log("picker.resolved.file")
              } catch (e: Exception) {
                log("reader.failed", error = e)
                finishPicker()
                promise.reject((e as? HtmlImportException)?.code ?: "READ_FAILED", (e as? HtmlImportException)?.message ?: "Impossibile leggere il file selezionato. Prova un altro gestore file. (READ_FAILED)", e)
              }
            }
          }
        } catch (e: Exception) {
          log("picker.result.failed", error = e)
          finishPicker()
          promise.reject((e as? HtmlImportException)?.code ?: "PICKER_RESULT", (e as? HtmlImportException)?.message ?: "Risposta del gestore file non valida. (PICKER_RESULT)", e)
        }
      } else {
        log("picker.result.ignored", "requestMismatch=${result.requestCode != expectedCode} missingPromise=${promise == null}")
      }
    }

    AsyncFunction("listBrowsers") {
      val context = appContext.reactContext ?: error("App non disponibile.")
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.org")).addCategory(Intent.CATEGORY_BROWSABLE)
      context.packageManager.queryIntentActivities(intent, 0).map {
        mapOf("id" to it.activityInfo.packageName, "name" to it.loadLabel(context.packageManager).toString())
      }.distinctBy { it["id"] }.sortedBy { it["name"] }
    }

    AsyncFunction("openUrl") { url: String, browser: String? ->
      val activity = appContext.currentActivity ?: error("App non disponibile.")
      val uri = Uri.parse(url)
      require(uri.scheme in listOf("https", "http") && !uri.host.isNullOrEmpty()) { "Indirizzo non valido." }
      val intent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
      if (browser != null) intent.setPackage(browser)
      try {
        activity.startActivity(intent)
      } catch (e: Exception) {
        throw IllegalStateException("Browser non disponibile. Installa un browser o cambia quello selezionato nell’app.", e)
      }
    }.runOnQueue(Queues.MAIN)
  }
}
