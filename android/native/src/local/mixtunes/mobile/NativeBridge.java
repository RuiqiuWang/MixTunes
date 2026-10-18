package local.mixtunes.mobile;

import android.content.Intent;
import android.net.Uri;
import android.util.AtomicFile;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

final class NativeBridge {
    final MainActivity activity;
    final ExecutorService network = Executors.newFixedThreadPool(4);
    final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final ExecutorService accounts = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timeouts = Executors.newSingleThreadScheduledExecutor();
    private final ConcurrentHashMap<String, RequestControl> requests = new ConcurrentHashMap<>();
    NativeBridge(MainActivity activity) { this.activity = activity; }
    @JavascriptInterface public String crypto(String text) { if (!activity.trustedPage || text == null || text.length() > 20 * 1024 * 1024) return Json.object("ok", false, "error", "本地页面请求无效").toString(); return CryptoBridge.execute(text); }
    @JavascriptInterface public void postMessage(String text) {
        Object id = null;
        try {
            if (!activity.trustedPage || text == null || text.length() > 20 * 1024 * 1024) throw new SecurityException("本地页面请求无效");
            JSONObject message = new JSONObject(text); id = message.get("id"); final Object requestId = id;
            String method = message.getString("method"); JSONObject payload = message.optJSONObject("payload"); if (payload == null) payload = new JSONObject(); final JSONObject data = payload;
            if (method.equals("fetch")||method.equals("share-fetch")) { fetch(requestId, data,method.equals("share-fetch")); return; }
            if (method.equals("cancel")) { cancelFetch(data.get("requestId"), "请求已取消"); activity.reply(requestId, true, true, null); return; }
            Runnable operation = () -> { try { Object value = execute(requestId, method, data); if (value != PENDING) activity.reply(requestId, true, value, null); } catch (Exception error) { activity.reply(requestId, false, null, Json.error(error)); } };
            if (method.startsWith("storage-")) storage.execute(operation); else if (method.equals("cookies")) accounts.execute(operation); else activity.runOnUiThread(operation);
        } catch (Exception error) { if (id != null) activity.reply(id, false, null, Json.error(error)); }
    }
    static final Object PENDING = new Object();
    private void fetch(Object id, JSONObject data,boolean share) {
        String key = String.valueOf(id); RequestControl control = new RequestControl();
        if (requests.putIfAbsent(key, control) != null) throw new IllegalArgumentException("请求编号重复");
        FutureTask<Void> task = new FutureTask<>(() -> {
            try { JSONObject result = share?ShareLink.fetch(data.getString("url"),control):NativeNetwork.fetch(data, control); if (control.claimReply()) activity.reply(id, true, result, null); }
            catch (Exception error) { if (control.claimReply()) activity.reply(id, false, null, Json.error(error)); }
            finally { requests.remove(key, control); control.finish(); }
            return null;
        });
        control.task(task);
        try { control.deadline(timeouts.schedule(() -> cancelFetch(id, control, "网络请求超时"), 10, TimeUnit.SECONDS)); network.execute(task); }
        catch (RuntimeException error) { requests.remove(key, control); control.cancel(); throw error; }
    }
    private void cancelFetch(Object id, String message) {
        RequestControl control = requests.get(String.valueOf(id)); if (control != null) cancelFetch(id, control, message);
    }
    private void cancelFetch(Object id, RequestControl control, String message) {
        if (!requests.remove(String.valueOf(id), control)) return;
        if (control.claimReply()) activity.reply(id, false, null, message);
        control.cancel();
    }
    private Object execute(Object id, String method, JSONObject data) throws Exception {
        AudioController audio = method.startsWith("audio-") || (method.equals("video-load") || method.equals("web-load")) ? PlaybackService.audio(activity) : null;
        switch (method) {
            case "cancel": cancelFetch(data.get("requestId"), "请求已取消"); return true;
            case "cookies": return cookies(data.getString("platform"));
            case "login": return MobileLogin.open(activity,data.getString("platform"));
            case "app-ready": activity.uiReady=true;activity.dispatchShareIntent();return true;
            case "playback-start": PlaybackService.ensure(activity); return Json.object("started", true);
            case "audio-load": return audio.load(data);
            case "audio-activate": audio.activate(data); return true;
            case "audio-pause": if (data.has("token")) audio.pause(audio.required(data)); else audio.pauseAll(); return true;
            case "audio-stop": audio.stopAll(); return true;
            case "audio-seek": audio.seek(data); return true;
            case "audio-range": audio.setRange(data); return true;
            case "audio-volume": audio.volume(data); return true;
            case "audio-unload": audio.unload(data); return true;
            case "audio-destroy": PlaybackService.release(activity); return true;
            case "video-load": audio.pauseAll(); activity.official.loadVideo(data); return Json.object("loading", true);
            case "video-play": activity.official.checkVideo(data); activity.official.playVideo(); return true;
            case "video-pause": activity.official.pauseVideo(); return true;
            case "video-seek": activity.official.seekVideo(data.getLong("positionMs")); return true;
            case "video-range": activity.official.rangeVideo(data); return true;
            case "video-volume": activity.official.volumeVideo(data); return true;
            case "video-layout": activity.official.layoutVideo(data); return true;
            case "video-close": activity.official.closeVideo(); return true;
            case "web-load": audio.pauseAll(); activity.qqPlayer.load(data); return Json.object("loading",true);
            case "web-play": activity.qqPlayer.play(data); return true;
            case "web-pause": activity.qqPlayer.pause(); return true;
            case "web-seek": activity.qqPlayer.seek(data); return true;
            case "web-range": activity.qqPlayer.range(data); return true;
            case "web-volume": activity.qqPlayer.volume(data); return true;
            case "web-panel": activity.qqPlayer.show(data.optBoolean("visible",true)); return true;
            case "web-close": activity.qqPlayer.close(); return true;
            case "storage-load": {
                AtomicFile file = new AtomicFile(new File(activity.getFilesDir(), "library.json"));
                try{return Json.object("json", new String(NativeNetwork.read(file.openRead(), NativeNetwork.MAX_BODY), StandardCharsets.UTF_8));}
                catch(java.io.FileNotFoundException absent){return Json.object("json",null);}
            }
            case "storage-save": {
                byte[] bytes = data.getString("json").getBytes(StandardCharsets.UTF_8); if (bytes.length > NativeNetwork.MAX_BODY) throw new IllegalArgumentException("歌单文件过大");
                AtomicFile file = new AtomicFile(new File(activity.getFilesDir(), "library.json")); FileOutputStream output = null;
                try { output = file.startWrite(); output.write(bytes); file.finishWrite(output); } catch (Exception error) { if (output != null) file.failWrite(output); throw error; }
                return true;
            }
            case "export": case "backup-export": activity.exportFile(id, data); return PENDING;
            case "import": case "backup-import": activity.importFile(id); return PENDING;
            case "open-external": {
                String value = data.getString("url"); NativeNetwork.safeUrl(value, null);
                Uri uri = Uri.parse(value); String host = uri.getHost();
                if (!(NativeNetwork.suffix(host, "y.qq.com") || host.equals("music.163.com") || host.equals("y.music.163.com") || host.equals("163cn.tv") || host.equals("www.bilibili.com") || host.equals("search.bilibili.com") || host.equals("space.bilibili.com") || host.equals("b23.tv"))) throw new SecurityException("只能打开官方音乐或视频页面");
                activity.startActivity(new Intent(Intent.ACTION_VIEW, uri)); return true;
            }
            case "theme": activity.theme(data.optString("theme", "light")); return true;
            case "quit": PlaybackService.release(activity); activity.finishAndRemoveTask(); return true;
            default: throw new IllegalArgumentException("不支持的原生操作：" + method);
        }
    }
    private JSONArray cookies(String platform) {
        String[] domains;
        if (platform.equals("qq")) domains = new String[]{"y.qq.com", "u.y.qq.com", "qq.com"};
        else if (platform.equals("netease")) domains = new String[]{"music.163.com", "163.com"};
        else if (platform.equals("bilibili")) domains = new String[]{"bilibili.com", "www.bilibili.com", "api.bilibili.com"};
        else throw new IllegalArgumentException("不支持的平台");
        JSONArray result = new JSONArray(); LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (String domain : domains) {
            String values = CookieManager.getInstance().getCookie("https://" + domain + "/"); if (values == null) continue;
            for (String part : values.split(";")) {
                int equals = part.indexOf('='); if (equals <= 0) continue;
                String name = part.substring(0, equals).trim(), value = part.substring(equals + 1).trim();
                String identity = domain + ":" + name; if (!name.matches("[A-Za-z0-9_.-]{1,100}") || value.length() > 8192 || !seen.add(identity)) continue;
                result.put(Json.object("name", name, "value", value, "domain", domain));
            }
        }
        return result;
    }
    void destroy() { for (RequestControl control : requests.values()) control.cancel(); requests.clear(); timeouts.shutdownNow(); network.shutdownNow(); accounts.shutdownNow(); storage.shutdown(); }
}
