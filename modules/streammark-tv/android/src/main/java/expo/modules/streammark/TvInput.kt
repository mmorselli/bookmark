package expo.modules.streammark

import android.os.Handler
import android.os.Looper
import android.view.KeyEvent

/** Activity-level input also works with ordinary React Native on Android TV. */
object TvInput {
  private val handler = Handler(Looper.getMainLooper())
  @Volatile var listener: ((String) -> Unit)? = null
  @Volatile var enabled = false
  private var heldKey: Int? = null
  private var longPress = false
  private val hold = Runnable { longPress = true; listener?.invoke("longSelect") }

  fun reset() {
    handler.removeCallbacks(hold)
    heldKey = null
    longPress = false
  }

  fun dispatch(event: KeyEvent): Boolean {
    if (!enabled || listener == null) return false
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0)
      DiagnosticLog.write("remote.key", "code=${event.keyCode}")
    val key = when (event.keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> "up"
      KeyEvent.KEYCODE_DPAD_DOWN -> "down"
      KeyEvent.KEYCODE_DPAD_LEFT -> "left"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
      KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_SPACE,
      KeyEvent.KEYCODE_BUTTON_A -> "select"
      KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_F2 -> "menu"
      KeyEvent.KEYCODE_ESCAPE, KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_BUTTON_B -> "back"
      else -> return false
    }
    if (key == "select") {
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        reset()
        heldKey = event.keyCode
        handler.postDelayed(hold, 550)
      } else if (event.action == KeyEvent.ACTION_UP && heldKey == event.keyCode) {
        handler.removeCallbacks(hold)
        if (!longPress && !event.isCanceled) listener?.invoke("select")
        reset()
      }
    } else if (event.action == KeyEvent.ACTION_DOWN &&
      (event.repeatCount == 0 || key in listOf("up", "down", "left", "right"))) {
      // Changing selection cancels a pending long press.
      reset()
      listener?.invoke(key)
    }
    return true
  }
}
