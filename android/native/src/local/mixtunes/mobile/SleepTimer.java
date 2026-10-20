package local.mixtunes.mobile;

/**
 * Deadline based sleep timer. Time is read from an injectable clock and only one
 * pending callback is ever scheduled, so a late or early callback, a suspended
 * process or an Activity recreation cannot duplicate the expiry.
 */
final class SleepTimer {
    interface Clock { long now(); }
    interface Scheduler { void schedule(long delayMs, Runnable task); void cancel(); }
    interface Listener { void onExpired(int minutes); }

    private final Clock clock;
    private final Scheduler scheduler;
    private final Listener listener;
    private boolean active;
    private long endsAt;
    private int minutes;
    private int serial;

    SleepTimer(Clock clock, Scheduler scheduler, Listener listener) {
        if (clock == null || scheduler == null || listener == null) throw new IllegalArgumentException("睡眠定时器依赖缺失");
        this.clock = clock; this.scheduler = scheduler; this.listener = listener;
    }

    synchronized boolean active() { return active; }

    synchronized long endsAt() { return active ? endsAt : 0L; }

    synchronized int minutes() { return active ? minutes : 0; }

    synchronized long remaining() { return active ? Math.max(0L, endsAt - clock.now()) : 0L; }

    synchronized void start(int value) {
        if (value < 1 || value > 240) throw new IllegalArgumentException("睡眠定时器需为 1～240 分钟的整数");
        scheduler.cancel();
        serial++;
        active = true;
        minutes = value;
        endsAt = clock.now() + value * 60000L;
        schedule(serial);
    }

    synchronized void cancel() {
        if (!active) return;
        scheduler.cancel();
        serial++;
        clear();
    }

    private void schedule(int id) {
        final long delay = Math.max(0L, endsAt - clock.now());
        scheduler.schedule(delay, () -> fire(id));
    }

    /**
     * Resolves a deadline that has already passed. Used both by the delayed
     * callback and by the lazy checks that run when the app is resumed, when
     * playback starts or when the UI asks for the state: Handler uses
     * uptimeMillis and is deferred while the device is suspended, while the
     * deadline itself is based on elapsedRealtime and must not be extended.
     */
    synchronized boolean expireIfDue(boolean notify) {
        if (!active || endsAt - clock.now() > 0) return false;
        final int finished = minutes;
        serial++;
        scheduler.cancel();
        clear();
        if (notify) listener.onExpired(finished);
        return true;
    }

    private void fire(int id) {
        synchronized (this) {
            if (!active || id != serial) return;
            if (expireIfDue(true)) return;
            schedule(id);
        }
    }

    private void clear() {
        active = false;
        minutes = 0;
        endsAt = 0L;
    }
}
