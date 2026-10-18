package local.mixtunes.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

public final class PlaybackService extends Service {
    private static AudioController shared;
    private static PlaybackService current;
    private static final String CHANNEL = "mixtunes.playback";
    private MediaSession mediaSession;
    static synchronized AudioController audio(Context context) { if (shared == null) shared = new AudioController(context.getApplicationContext()); return shared; }
    static void ensure(Context context) { if (current == null) context.startForegroundService(new Intent(context, PlaybackService.class)); }
    static void refresh() { if (current != null) current.update(); }
    static void release(Context context) { if (shared != null) { shared.destroy(); shared = null; } context.stopService(new Intent(context, PlaybackService.class)); }
    private final BroadcastReceiver noisy = new BroadcastReceiver() { @Override public void onReceive(Context context, Intent intent) { audio(context).pauseAll(); audio(context).command("pause", null); } };
    @Override public void onCreate() {
        super.onCreate(); current = this;
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "音乐播放", NotificationManager.IMPORTANCE_LOW));
        mediaSession = new MediaSession(this, "MixTunes");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { audio(PlaybackService.this).command("play", null); }
            @Override public void onPause() { audio(PlaybackService.this).pauseAll(); audio(PlaybackService.this).command("pause", null); }
            @Override public void onSkipToNext() { audio(PlaybackService.this).command("next", null); }
            @Override public void onSkipToPrevious() { audio(PlaybackService.this).command("previous", null); }
            @Override public void onSeekTo(long pos) { audio(PlaybackService.this).command("seek", Json.object("positionMs", pos)); }
            @Override public void onStop() { AudioController audio = audio(PlaybackService.this); audio.stopAll(); if (shared != null) { shared.destroy(); shared = null; } stopSelf(); }
        });
        mediaSession.setActive(true);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED); else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        update();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String name = intent.getAction();
            if (name.equals("pause")) audio(this).pauseAll();
            if (name.matches("play|pause|previous|next")) audio(this).command(name, null);
        }
        update(); return START_NOT_STICKY;
    }
    private PendingIntent action(String name, int code) { return PendingIntent.getService(this, code, new Intent(this, PlaybackService.class).setAction(name), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); }
    void update() {
        AudioController audio = audio(this); boolean playing = audio.playing();
        String title = audio.active == null ? "MixTunes" : audio.active.title, artist = audio.active == null ? "准备播放" : audio.active.artist;
        mediaSession.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, artist).putLong(MediaMetadata.METADATA_KEY_DURATION, audio.duration()).build());
        mediaSession.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP).setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, audio.position(), playing ? 1 : 0).build());
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(title).setContentText(artist).setContentIntent(open).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(playing)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一首", action("previous", 1)).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "暂停" : "播放", action(playing ? "pause" : "play", 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一首", action("next", 3)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(mediaSession.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(101, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK); else startForeground(101, notification);
    }
    @Override public void onTaskRemoved(Intent rootIntent) { if (shared != null) { shared.destroy(); shared = null; } stopSelf(); }
    @Override public void onDestroy() { current = null; try { unregisterReceiver(noisy); } catch (Exception ignored) {} if (mediaSession != null) mediaSession.release(); if (shared != null) shared.pauseAll(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
