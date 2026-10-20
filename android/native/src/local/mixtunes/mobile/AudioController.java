package local.mixtunes.mobile;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

final class AudioController {
    interface Listener { void onEvent(JSONObject event); }
    final Context context;
    final Handler main = new Handler(Looper.getMainLooper());
    final Map<String, Entry> entries = new LinkedHashMap<>();
    MediaProxy proxy;
    Listener listener;
    Entry active;
    float volume = .7f;
    boolean muted;
    final AudioManager manager;
    final AudioFocusRequest focus;

    final class Entry {
        final String token, key, title, artist;
        final long generation;
        final int slot;
        final MediaPlayer player;
        long start, end, pendingSeek = -1;
        int seekRetries;
        boolean prepared, positioned, wantsPlay, ended, released;
        Entry(JSONObject data) throws Exception {
            token = UUID.randomUUID().toString(); key = data.getString("key"); generation = data.getLong("generation"); slot = data.optInt("slot", 0);
            title = data.optString("title", "MixTunes"); artist = data.optString("artist", "");
            start = Math.max(0, data.optLong("startMs", 0)); end = data.isNull("endMs") || !data.has("endMs") ? -1 : data.optLong("endMs", -1);
            if (slot < 0 || slot > 1 || key.length() > 200 || start > Integer.MAX_VALUE || end > Integer.MAX_VALUE || end >= 0 && end - start < 1000) throw new IllegalArgumentException("音频参数无效");
            player = new MediaPlayer();
        }
    }

    AudioController(Context context) {
        this.context = context.getApplicationContext(); manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(change -> {
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) { pauseAll(); command("pause", null); }
            else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) applyVolume(.2f);
            else if (change == AudioManager.AUDIOFOCUS_GAIN) applyVolume(1f);
        }, main).build();
        main.post(tick);
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            try {
                Entry entry = active;
                if (entry != null && entry.prepared && entry.positioned && entry.pendingSeek<0 && !entry.released && entry.player.isPlaying()) {
                    long position = entry.player.getCurrentPosition();
                    if (entry.end >= 0 && position >= entry.end) finish(entry);
                    else emit(entry, "progress", null);
                }
            } catch (Exception ignored) {}
            main.postDelayed(this, 100);
        }
    };

    JSONObject load(JSONObject data) throws Exception {
        NativeNetwork.safeUrl(data.getString("url"), data.optString("platform", ""));
        if (proxy == null) proxy = new MediaProxy();
        Entry entry = new Entry(data);
        for (Entry previous : new ArrayList<>(entries.values())) if (previous.slot == entry.slot) release(previous);
        entries.put(entry.token, entry);
        if (data.has("volume")) volume = (float) Math.max(0, Math.min(1, data.optDouble("volume", .7)));
        if (data.has("muted")) muted = data.optBoolean("muted");
        try {
        entry.player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
        entry.player.setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK); entry.player.setVolume(muted ? 0 : volume, muted ? 0 : volume);
        entry.player.setOnPreparedListener(player -> {
            if (entry.released) return;
            entry.prepared = true;
            long duration = player.getDuration(); boolean reset = duration > 0 && entry.start >= duration;
            if (reset) { entry.start = 0; entry.end = -1; }
            emit(entry, "metadata", Json.object("rangeReset", reset));
            try { position(entry, entry.pendingSeek >= 0 ? entry.pendingSeek : entry.start); } catch (Exception error) { error(entry, error); }
        });
        entry.player.setOnSeekCompleteListener(player -> {
            if (entry.released) return;
            if(entry.pendingSeek>=0&&Math.abs(player.getCurrentPosition()-entry.pendingSeek)>350){if(entry.seekRetries++<5){player.seekTo(entry.pendingSeek,MediaPlayer.SEEK_CLOSEST);return;}entry.pendingSeek=-1;entry.positioned=false;error(entry,new IllegalStateException("音频定位未完成，请重试"));return;}
            entry.pendingSeek = -1; entry.positioned = true;
            emit(entry, "seeked", null);emit(entry, "ready", null); emit(entry, "progress", null); maybeStart(entry);
        });
        entry.player.setOnCompletionListener(player -> {if(entry.positioned&&entry.pendingSeek<0)finish(entry);});
        entry.player.setOnErrorListener((player, what, extra) -> { error(entry, new IllegalStateException("音频加载失败（媒体错误 " + what + "/" + extra + "）")); return true; });
        entry.player.setOnInfoListener((player, what, extra) -> { if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) emit(entry, "buffering", null); else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END && entry.wantsPlay) emit(entry, "playing", null); return false; });
        entry.player.setDataSource(context, android.net.Uri.parse(proxy.add(entry.token, data)));
        entry.player.prepareAsync();
        } catch (Exception error) {
            // A failed load must not leave a prepared MediaPlayer and proxy
            // source behind; the JS side only sees the error.
            release(entry);
            throw error;
        }
        return Json.object("token", entry.token, "key", entry.key, "generation", entry.generation, "slot", entry.slot);
    }
    Entry required(JSONObject data) { Entry entry = entries.get(data.optString("token")); if (entry == null || entry.released) throw new IllegalStateException("音频请求已失效"); return entry; }
    void activate(JSONObject data) {
        Entry entry = required(data); PlaybackService.ensure(context);
        for (Entry other : entries.values()) if (other != entry) pause(other);
        active = entry; entry.wantsPlay = true; entry.ended = false; maybeStart(entry);
    }
    private void maybeStart(Entry entry) {
        if (!entry.wantsPlay || !entry.prepared || !entry.positioned || entry.released) return;
        try {
            if (manager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new IllegalStateException("暂时无法获得音频焦点");
            if (entry.end >= 0 && entry.player.getCurrentPosition() >= entry.end) { finish(entry); return; }
            entry.player.start(); active = entry; emit(entry, "playing", null); PlaybackService.refresh();
        } catch (Exception error) { error(entry, error); }
    }
    void pause(Entry entry) { if (entry == null || entry.released) return; entry.wantsPlay = false; try { if (entry.prepared && entry.player.isPlaying()) entry.player.pause(); } catch (Exception ignored) {} emit(entry, "paused", null); PlaybackService.refresh(); }
    void pauseAll() { for (Entry entry : new ArrayList<>(entries.values())) pause(entry); manager.abandonAudioFocusRequest(focus); }
    void seek(JSONObject data) throws Exception { Entry entry = required(data); entry.ended = false; position(entry, data.getLong("positionMs")); }
    private long clamp(Entry entry, long position) {
        long end = entry.end; if (entry.prepared) try { long duration = entry.player.getDuration(); if (duration > 0) end = end < 0 ? duration : Math.min(end, duration); } catch (Exception ignored) {}
        return Math.max(entry.start, end < 0 ? Math.max(0, position) : Math.min(end, position));
    }
    private void position(Entry entry, long value) throws Exception {
        long target = clamp(entry, value); entry.pendingSeek = target;entry.seekRetries=0; entry.positioned = false;
        if (!entry.prepared) return;
        if (Math.abs(entry.player.getCurrentPosition() - target) < 30) { entry.pendingSeek = -1; entry.positioned = true; emit(entry, "seeked", null);emit(entry, "ready", null); maybeStart(entry); }
        else entry.player.seekTo(target, MediaPlayer.SEEK_CLOSEST);
    }
    void setRange(JSONObject data) throws Exception {
        Entry entry = required(data); long start = Math.max(0, data.optLong("startMs", 0)), end = data.isNull("endMs") || !data.has("endMs") ? -1 : data.getLong("endMs");
        if (start > Integer.MAX_VALUE || end > Integer.MAX_VALUE || end >= 0 && end - start < 1000) throw new IllegalArgumentException("播放范围至少需要 1 秒");
        entry.start = start; entry.end = end; entry.ended = false;
        if (!entry.prepared) { entry.pendingSeek = start; return; }
        long now = entry.player.getCurrentPosition(); if (now < start || end >= 0 && now >= end) position(entry, start);
    }
    void volume(JSONObject data) { volume = (float) Math.max(0, Math.min(1, data.optDouble("volume", volume))); muted = data.optBoolean("muted", muted); applyVolume(1f); }
    private void applyVolume(float scale) { float level = muted ? 0 : volume * scale; for (Entry entry : entries.values()) try { entry.player.setVolume(level, level); } catch (Exception ignored) {} }
    void unload(JSONObject data) { Entry entry = entries.get(data.optString("token")); if (entry != null) release(entry); }
    void stopAll() { pauseAll(); }
    private void release(Entry entry) { entry.released = true; entry.wantsPlay = false; try { entry.player.reset(); entry.player.release(); } catch (Exception ignored) {} entries.remove(entry.token); if (proxy != null) proxy.remove(entry.token); if (active == entry) active = null; }
    void destroy() { main.removeCallbacks(tick); for (Entry entry : new ArrayList<>(entries.values())) release(entry); if (proxy != null) proxy.close(); manager.abandonAudioFocusRequest(focus); }
    private void finish(Entry entry) { if (entry.released || entry.ended || !entry.positioned || entry.pendingSeek>=0) return; entry.ended = true; entry.wantsPlay = false; try { if (entry.player.isPlaying()) entry.player.pause(); } catch (Exception ignored) {} emit(entry, "ended", null); PlaybackService.refresh(); }
    private void error(Entry entry, Exception error) { if (entry.released) return; entry.wantsPlay = false; emit(entry, "error", Json.object("message", Json.error(error))); PlaybackService.refresh(); }
    void command(String name, JSONObject payload) { if (listener != null) listener.onEvent(Json.object("type", "command", "name", name, "payload", payload == null ? new JSONObject() : payload)); }
    private void emit(Entry entry, String type, JSONObject extra) {
        if (listener == null || entry.released) return;
        long position = 0, duration = 0;
        try { if (entry.prepared) { position = entry.player.getCurrentPosition(); duration = Math.max(0, entry.player.getDuration()); } } catch (Exception ignored) {}
        JSONObject event = Json.object("type", type, "backend", "audio", "key", entry.key, "generation", entry.generation, "token", entry.token, "slot", entry.slot, "positionMs", position, "durationMs", duration);
        if (extra != null) try { java.util.Iterator<String> names = extra.keys(); while (names.hasNext()) { String name = names.next(); event.put(name, extra.get(name)); } } catch (Exception ignored) {}
        listener.onEvent(Json.object("type", "audio", "event", event));
    }
    boolean playing() { try { return active != null && active.prepared && active.player.isPlaying(); } catch (Exception ignored) { return false; } }
    long position() { try { return active != null && active.prepared ? active.player.getCurrentPosition() : 0; } catch (Exception ignored) { return 0; } }
    long duration() { try { return active != null && active.prepared ? Math.max(0, active.player.getDuration()) : 0; } catch (Exception ignored) { return 0; } }
}
