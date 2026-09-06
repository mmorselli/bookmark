package expo.modules.streammark

/** Each launch, including a fallback, owns a different activity-result code. */
internal class PickerRequestTracker(lastCode: Int = 4926) {
  private var lastCode = lastCode.coerceIn(4926, 65535)
  var activeCode: Int? = null
    private set

  fun begin(): Int {
    lastCode = if (lastCode == 65535) 4927 else lastCode + 1
    activeCode = lastCode
    return lastCode
  }

  fun accept(code: Int): Boolean {
    if (activeCode != code) return false
    activeCode = null
    return true
  }

  fun clear() { activeCode = null }
}
