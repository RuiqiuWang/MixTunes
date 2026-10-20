package local.mixtunes.mobile;

/**
 * Pure decisions for the Android expiry path so they can be unit tested without
 * a running device. Keeping the "already paused" check here prevents the timer
 * from issuing a redundant pause and, more importantly, from ever resuming.
 */
final class SleepTimerPolicy {
    private SleepTimerPolicy() {}

    static boolean shouldPauseAudio(boolean audioPlaying) { return audioPlaying; }

    static boolean shouldPauseEngine(String status) {
        return "playing".equals(status) || "buffering".equals(status) || "loading".equals(status);
    }

    static boolean shouldNotifyWebView(boolean activityAlive) { return activityAlive; }
}
