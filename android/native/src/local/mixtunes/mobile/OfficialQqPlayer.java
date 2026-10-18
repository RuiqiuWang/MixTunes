package local.mixtunes.mobile;

import android.graphics.Color;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONTokener;
import java.nio.charset.StandardCharsets;

/** Owns a remote QQ official player, sharing only the system cookie store with
 * official login. No JavascriptInterface, file access or custom OAuth identity. */
final class OfficialQqPlayer {
    final MainActivity activity;
    final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    WebView web;
    LinearLayout panel;
    TextView status;
    JSONObject request;
    boolean ready, wantPlay, failed, polling;
    String lastState = "", script;
    double volume = .7;
    Long seek;
    JSONObject range;
    long deadline;
    OfficialQqPlayer(MainActivity activity) { this.activity = activity; }
    void load(JSONObject data) throws Exception {
        if (!"qq".equals(data.optString("platform")) || data.optJSONObject("qqSong") == null || data.optString("expectedId").isEmpty()) throw new IllegalArgumentException("QQ 歌曲资料缺失，请重新导入");
        close(); request = new JSONObject(data.toString()); range = data.optJSONObject("range");
        if (range == null) range = Json.object("startMs", 0, "endMs", JSONObject.NULL);
        seek = null; wantPlay = false; ready = false; failed = false; lastState = ""; deadline = android.os.SystemClock.uptimeMillis() + 24000;
        if (script == null) try(java.io.InputStream input = activity.getAssets().open("official-qq-player.js")) { script = new String(NativeNetwork.read(input, NativeNetwork.MAX_BODY), StandardCharsets.UTF_8); }
        panel = new LinearLayout(activity); panel.setOrientation(LinearLayout.VERTICAL); panel.setBackgroundColor(Color.WHITE);
        LinearLayout bar = new LinearLayout(activity);
        Button login = new Button(activity); login.setText("官方网页登录"); login.setOnClickListener(v -> activity.official.login("qq")); bar.addView(login);
        Button hide = new Button(activity); hide.setText("收起网页"); hide.setOnClickListener(v -> show(false)); bar.addView(hide); panel.addView(bar);
        status = new TextView(activity); status.setText("正在加载 QQ 官方网页播放器…"); status.setTextColor(Color.DKGRAY); status.setPadding(16, 8, 16, 8); panel.addView(status);
        web = new WebView(activity); WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setDatabaseEnabled(true);
        settings.setUserAgentString(OfficialWebViews.DESKTOP_UA); settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true); settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        panel.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        activity.root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
        final JSONObject target = request;
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest resource) { return resource.isForMainFrame() && !QqMobileLogin.allowed(resource.getUrl().toString()); }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { if (web == view && request == target) ready = false; }
            @Override public void onPageFinished(WebView view, String url) {
                if (web != view || request != target || failed) return;
                if (!QqMobileLogin.playerPage(url)) { error(target, "QQ 播放页面已跳转，请完成官方网页登录后重新播放"); return; }
                configure(view, target);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest resource, WebResourceError problem) { if (web == view && resource.isForMainFrame()) error(target, "QQ 官方网页加载失败（错误 " + problem.getErrorCode() + "）"); }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest resource, WebResourceResponse response) { if (web == view && resource.isForMainFrame()) error(target, "QQ 官方网页请求失败（HTTP " + response.getStatusCode() + "）"); }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) { if (web == view) { error(target, "QQ 网页播放器进程退出，请重新播放"); view.destroy(); web = null; } return true; }
        });
        web.loadUrl("https://y.qq.com/portal/player.html");
        main.post(poll);
    }
    private void configure(WebView view, JSONObject target) {
        if (web != view || request != target || failed || !QqMobileLogin.playerPage(view.getUrl())) return;
        view.evaluateJavascript("(()=>{try{" + script + ";const b=window.__mixMobileQqPlayer;b.configure(" + target + ");return JSON.stringify({ok:true});}catch(e){return JSON.stringify({ok:false});}})()", result -> {
            if (web != view || request != target || failed) return;
            try {
                JSONObject state = decode(result);
                if (!state.optBoolean("ok")) {
                    if (android.os.SystemClock.uptimeMillis() < deadline) main.postDelayed(() -> configure(view, target), 400);
                    else error(target, "QQ 官网播放器接口未就绪，请检查网络、登录或官网是否支持该歌曲");
                    return;
                }
                ready = true;
                command("volume", volume); command("range", range); if (seek != null) command("seek", seek);
                if (wantPlay) command("play", JSONObject.NULL);
            } catch (Exception invalid) { error(target, "QQ 网页播放器初始化失败"); }
        });
    }
    void play(JSONObject data) {
        if (request == null || data.optLong("generation") != request.optLong("generation")) throw new IllegalStateException("QQ 播放请求已失效");
        if (!wantPlay) deadline = android.os.SystemClock.uptimeMillis() + 24000;
        wantPlay = true; command("play", JSONObject.NULL);
    }
    void pause() { wantPlay = false; command("pause", JSONObject.NULL); }
    void volume(JSONObject data) { volume = Math.max(0, Math.min(1, data.optDouble("volume", .7))); command("volume", volume); }
    void seek(JSONObject data) { seek = Math.max(0, data.optLong("positionMs")); command("seek", seek); }
    void range(JSONObject data) { range = Json.object("startMs", Math.max(0, data.optLong("startMs")), "endMs", data.opt("endMs")); command("range", range); }
    void show(boolean visible) { if (panel != null) panel.setVisibility(visible ? View.VISIBLE : View.GONE); }
    boolean back() { if (panel != null && panel.getVisibility() == View.VISIBLE) { show(false); return true; } return false; }
    private void command(String name, Object value) {
        if (!ready || web == null || failed) return;
        String encoded = new JSONArray().put(value == null ? JSONObject.NULL : value).toString();
        web.evaluateJavascript("(()=>{const b=window.__mixMobileQqPlayer;if(b)b.command(" + JSONObject.quote(name) + "," + encoded + "[0]).catch(e=>{b.lastError=e.name==='NotAllowedError'?'请点击网页中的播放按钮':e.message;});})()", null);
    }
    private JSONObject decode(String value) throws Exception { Object text = new JSONTokener(value).nextValue(); return text instanceof String ? new JSONObject((String)text) : new JSONObject(); }
    private void emit(JSONObject target, String type, JSONObject state) {
        activity.event(Json.object("type", "web", "event", Json.object("backend", "web", "type", type, "key", target.optString("key"), "generation", target.optLong("generation"), "positionMs", state.optDouble("positionMs"), "durationMs", state.optDouble("durationMs"), "message", state.optString("message"))));
    }
    private void error(JSONObject target, String message) {
        if (request != target || failed) return;
        pause(); failed = true; if (status != null) status.setText(message);
        emit(target, "error", Json.object("message", message));
    }
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (request == null || failed) return;
            final JSONObject target = request; final WebView view = web;
            if (wantPlay && android.os.SystemClock.uptimeMillis() > deadline && !target.optBoolean("_playing") && !target.optBoolean("_gesture")) { error(target, "QQ 网页未能开始播放，请在官方网页登录并确认歌曲权限后重试"); return; }
            if (ready && view != null && !polling) {
                polling = true;
                view.evaluateJavascript("JSON.stringify(window.__mixMobileQqPlayer?.snapshot()||{})", result -> {
                    if (web != view || request != target) return;
                    polling = false;
                    if (failed) return;
                    try {
                        JSONObject state = decode(result);
                        if (!state.optString("error").isEmpty()) { error(target, state.optString("error")); return; }
                        JSONArray events = state.optJSONArray("events");
                        if (events != null) for (int i = 0; i < events.length(); i++) {
                            JSONObject event = events.getJSONObject(i); String type = event.optString("type");
                            if (type.equals("error")) { error(target, event.optString("message", "QQ 官方网页播放失败")); return; }
                            if (type.equals("ended")) { emit(target, type, state); return; }
                        }
                        if (state.optBoolean("needsGesture")) {
                            if (!target.optBoolean("_gesture")) { target.put("_gesture", true); show(true); status.setText("请点击网页画面中的“点击播放”继续"); emit(target, "gesture-required", state); }
                            return;
                        }
                        target.put("_gesture", false);
                        if (!state.optBoolean("matches") || !state.optBoolean("media") || state.optLong("generation") != target.optLong("generation")) return;
                        String next = state.optBoolean("ended") ? "ended" : state.optBoolean("paused") ? "paused" : "playing";
                        if (!wantPlay && next.equals("playing")) { pause(); return; }
                        if (next.equals("playing")) { target.put("_playing", true); status.setText("正在播放 QQ 官方网页音频，可收起网页继续使用"); }
                        if (!next.equals(lastState)) { lastState = next; emit(target, next, state); }
                        emit(target, "progress", state);
                    } catch (Exception invalid) { error(target, "QQ 网页播放状态读取失败，请重新播放"); }
                });
            }
            main.postDelayed(this, 300);
        }
    };
    void close() {
        main.removeCallbacks(poll); pause(); ready = false; request = null; polling = false;
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        if (panel != null) activity.root.removeView(panel); panel = null; status = null;
    }
}
