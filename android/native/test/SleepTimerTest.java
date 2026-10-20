package local.mixtunes.mobile;

/** Plain-JVM tests for the deadline based sleep timer core. */
final class SleepTimerTest {
    static final class FakeClock implements SleepTimer.Clock {
        long time = 1_000_000L;
        @Override public long now() { return time; }
        void advance(long millis) { time += millis; }
    }

    static final class FakeScheduler implements SleepTimer.Scheduler {
        Runnable task;
        long delay;
        int scheduled;
        @Override public void schedule(long delayMs, Runnable value) { task = value; delay = delayMs; scheduled++; }
        @Override public void cancel() { task = null; }
        void fire() { Runnable value = task; task = null; if (value != null) value.run(); }
    }

    static final class Recorder implements SleepTimer.Listener {
        int count;
        int minutes;
        @Override public void onExpired(int value) { count++; minutes = value; }
    }

    private static int passed;

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void test(String name, Runnable body) {
        body.run();
        passed++;
        System.out.println("PASS " + name);
    }

    public static void main(String[] args) {
        test("presets schedule the exact deadline", () -> {
            for (int minutes : new int[]{15, 30, 60}) {
                FakeClock clock = new FakeClock();
                FakeScheduler scheduler = new FakeScheduler();
                Recorder recorder = new Recorder();
                SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
                timer.start(minutes);
                check(timer.active(), "active after start");
                check(timer.minutes() == minutes, "minutes stored");
                check(timer.remaining() == minutes * 60000L, "remaining at start");
                check(scheduler.delay == minutes * 60000L, "scheduled delay");
                clock.advance(minutes * 60000L);
                scheduler.fire();
                check(recorder.count == 1 && recorder.minutes == minutes, "expired once");
                check(!timer.active(), "inactive after expiry");
            }
        });

        test("custom 1 and 240 minutes expire once", () -> {
            for (int minutes : new int[]{1, 240}) {
                FakeClock clock = new FakeClock();
                FakeScheduler scheduler = new FakeScheduler();
                Recorder recorder = new Recorder();
                SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
                timer.start(minutes);
                clock.advance(minutes * 60000L + 1);
                scheduler.fire();
                scheduler.fire();
                check(recorder.count == 1, "single expiry");
            }
        });

        test("early callback reschedules for the remainder", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(15);
            clock.advance(1000);
            scheduler.fire();
            check(recorder.count == 0, "no early expiry");
            check(scheduler.delay == 15 * 60000L - 1000, "rearmed remainder");
            clock.advance(15 * 60000L - 1000);
            scheduler.fire();
            check(recorder.count == 1, "expired after rearm");
        });

        test("long suspend expires on the next callback", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(30);
            clock.advance(31 * 60000L);
            scheduler.fire();
            check(recorder.count == 1, "expired after suspend");
            check(!timer.active(), "cleared");
        });

        test("cancel removes the deadline", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(15);
            timer.cancel();
            check(!timer.active(), "inactive");
            check(scheduler.task == null, "scheduler cleared");
            clock.advance(60 * 60000L);
            check(recorder.count == 0, "no expiry after cancel");
        });

        test("replacement invalidates the old callback", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(15);
            Runnable stale = scheduler.task;
            clock.advance(5 * 60000L);
            timer.start(30);
            clock.advance(15 * 60000L);
            stale.run();
            check(recorder.count == 0, "stale callback ignored");
            check(timer.active() && timer.minutes() == 30, "new timer intact");
            clock.advance(15 * 60000L);
            scheduler.fire();
            check(recorder.count == 1 && recorder.minutes == 30, "new timer expires");
        });

        test("invalid minutes keep a running timer", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(15);
            for (int value : new int[]{0, -1, 241}) {
                try { timer.start(value); throw new AssertionError("accepted " + value); }
                catch (IllegalArgumentException expected) { }
            }
            check(timer.active() && timer.minutes() == 15, "original timer intact");
            check(recorder.count == 0, "no expiry");
        });

        test("remaining never goes negative", () -> {
            FakeClock clock = new FakeClock();
            SleepTimer timer = new SleepTimer(clock, new FakeScheduler(), new Recorder());
            timer.start(1);
            clock.advance(5 * 60000L);
            check(timer.remaining() == 0L, "clamped remaining");
        });

        test("a callback delayed by suspend still uses the elapsed deadline", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(30);
            // Handler uses uptimeMillis and does not run while the device is suspended.
            clock.advance(2 * 60 * 60000L);
            scheduler.fire();
            check(recorder.count == 1 && recorder.minutes == 30, "expired once after suspend");
            check(!timer.active(), "cleared after suspend");
        });

        test("expireIfDue resolves a missed deadline exactly once", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(15);
            clock.advance(14 * 60000L);
            check(!timer.expireIfDue(true), "not due yet");
            check(timer.active(), "still active before the deadline");
            clock.advance(60000L);
            check(timer.expireIfDue(true), "due now");
            check(recorder.count == 1, "notified once");
            check(!timer.expireIfDue(true), "second check is a no-op");
            check(recorder.count == 1, "never notified twice");
        });

        test("silent expiry clears without pausing new playback", () -> {
            FakeClock clock = new FakeClock();
            FakeScheduler scheduler = new FakeScheduler();
            Recorder recorder = new Recorder();
            SleepTimer timer = new SleepTimer(clock, scheduler, recorder);
            timer.start(5);
            clock.advance(6 * 60000L);
            check(timer.expireIfDue(false), "cleared silently");
            check(recorder.count == 0, "no pause requested for new playback");
            check(!timer.active(), "inactive");
        });

        test("policy keeps paused audio untouched and never resumes", () -> {
            check(!SleepTimerPolicy.shouldPauseAudio(false), "paused audio is not paused again");
            check(SleepTimerPolicy.shouldPauseAudio(true), "playing audio is paused");
            check(SleepTimerPolicy.shouldPauseEngine("playing"), "playing engine");
            check(SleepTimerPolicy.shouldPauseEngine("buffering"), "buffering engine");
            check(SleepTimerPolicy.shouldPauseEngine("loading"), "loading engine");
            check(!SleepTimerPolicy.shouldPauseEngine("paused"), "paused engine untouched");
            check(!SleepTimerPolicy.shouldPauseEngine("idle"), "idle engine untouched");
            check(!SleepTimerPolicy.shouldPauseEngine(null), "unknown engine untouched");
            check(SleepTimerPolicy.shouldNotifyWebView(true), "web view notified when alive");
            check(!SleepTimerPolicy.shouldNotifyWebView(false), "no notification when dead");
        });

        System.out.println("SleepTimer: " + passed + " tests PASS");
    }
}
