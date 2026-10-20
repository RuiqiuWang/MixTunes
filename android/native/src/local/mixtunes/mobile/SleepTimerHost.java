package local.mixtunes.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;

/**
 * Process-wide host for the single sleep timer. The timer lives as long as the
 * app process, not an Activity, so recreation never creates a second deadline.
 * Expiry pauses native audio when needed and sends sleep-timer-expired to a
 * surviving WebView. Its runtime uses the existing engine pause command to
 * pause video and synchronize the displayed playback state.
 */
final class SleepTimerHost {
    private static SleepTimer timer;
    private static Handler handler;
    private static Runnable pending;
    private static Context context;

    private SleepTimerHost() {}

    static synchronized SleepTimer timer(Context source) {
        if (timer != null) return timer;
        context = source.getApplicationContext();
        handler = new Handler(Looper.getMainLooper());
        timer = new SleepTimer(SystemClock::elapsedRealtime, new SleepTimer.Scheduler() {
            @Override public void schedule(long delayMs, Runnable task) {
                cancel();
                pending = task;
                handler.postDelayed(task, Math.max(0L, delayMs));
            }
            @Override public void cancel() {
                if (pending == null) return;
                handler.removeCallbacks(pending);
                pending = null;
            }
        }, minutes -> expire());
        return timer;
    }

    private static void expire() {
        try {
            AudioController audio = PlaybackService.audio(context);
            // A manually paused player must not receive another pause, and it must
            // never be resumed. Only an actively playing audio entry is paused here.
            if (SleepTimerPolicy.shouldPauseAudio(audio.playing())) audio.pauseAll();
            MainActivity activity = MainActivity.current();
            if (activity != null && SleepTimerPolicy.shouldNotifyWebView(true)) activity.onSleepTimerExpired();
            PlaybackService.refresh();
        } catch (Exception ignored) {
            // Playback may already be released; the timer is still cleared.
        }
    }

    /** Resolves a deadline that passed while the device was suspended. */
    static void checkExpired(Context source) { timer(source).expireIfDue(true); }

    /** Clears a passed deadline before starting new playback without pausing it. */
    static void clearIfExpired(Context source) { timer(source).expireIfDue(false); }

    static JSONObject start(Context source, int minutes) {
        SleepTimer value = timer(source);
        value.start(minutes);
        return state(source);
    }

    static void cancel(Context source) {
        timer(source).cancel();
    }

    static JSONObject state(Context source) {
        SleepTimer value = timer(source);
        value.expireIfDue(true);
        boolean active = value.active();
        long remaining = value.remaining();
        return Json.object(
            "ok", true,
            "active", active,
            "endsAt", active ? System.currentTimeMillis() + remaining : null,
            "remainingMs", remaining,
            "minutes", active ? value.minutes() : null
        );
    }
}
