package local.mixtunes.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static WeakReference<MainActivity> current;
    static MainActivity current() {
        MainActivity value = current == null ? null : current.get();
        return value != null && !value.isFinishing() ? value : null;
    }
    FrameLayout root;
    WebView ui;
    OfficialWebViews official;
    NativeBridge bridge;
    AudioController boundAudio;
    AudioController.Listener audioListener;
    boolean uiReady;
    String pendingShareUrl;
    volatile boolean trustedPage;
    Object pendingFileId;
    byte[] pendingExport;
    private static final int EXPORT = 210, IMPORT = 211;
    int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); current = new WeakReference<>(this); root = new FrameLayout(this); root.setFitsSystemWindows(true); root.setBackgroundColor(Color.WHITE); setContentView(root);
        CookieManager.getInstance().setAcceptCookie(true);
        ui = new WebView(this); ui.setBackgroundColor(Color.WHITE); WebSettings settings = ui.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true); settings.setAllowContentAccess(false); settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setMediaPlaybackRequiresUserGesture(true);
        root.addView(ui, new FrameLayout.LayoutParams(-1, -1)); official = new OfficialWebViews(this); bridge = new NativeBridge(this);
        // The bridge exists only on this navigation-locked packaged local UI.
        // Remote login and video WebViews never receive a JavascriptInterface.
        ui.addJavascriptInterface(bridge, "MixTunesBridge");
        ui.setWebChromeClient(new WebChromeClient()); ui.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !request.getUrl().toString().startsWith("file:///android_asset/"); }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { trustedPage = url.startsWith("file:///android_asset/"); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString(); if (url.startsWith("file:///android_asset/")) return null;
                // Only images may reach the network from the local document;
                // fetch/API calls go through the manually validated bridge.
                try {
                    java.net.URL target = NativeNetwork.safeUrl(url, null); String host = target.getHost();
                    boolean image = NativeNetwork.suffix(host, "gtimg.cn") || NativeNetwork.suffix(host, "qpic.cn") || NativeNetwork.suffix(host, "music.126.net") || NativeNetwork.suffix(host, "hdslb.com");
                    if (image && !request.isForMainFrame()) {
                        java.net.HttpURLConnection connection = NativeNetwork.open(url, "GET", null, null, NativeNetwork.platform(host));
                        int status = connection.getResponseCode(); String type = connection.getContentType();
                        if (status == 200 && type != null && type.toLowerCase(java.util.Locale.ROOT).startsWith("image/")) return new WebResourceResponse(type.split(";")[0], null, connection.getInputStream());
                        connection.disconnect();
                    }
                } catch (Exception ignored) {}
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
            }
        });
        boundAudio = PlaybackService.audio(this); audioListener = this::event; boundAudio.listener = audioListener;
        ui.loadUrl("file:///android_asset/index.html"); theme("light");
        receiveShareIntent(getIntent());
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 220);
    }
    void reply(Object id, boolean ok, Object value, String error) { JSONObject data = Json.object("id", id, "ok", ok, "value", value, "error", error); runOnUiThread(() -> { if (ui != null && trustedPage) ui.evaluateJavascript("window.__mixNativeReply&&window.__mixNativeReply(" + data.toString() + ");", null); }); }
    void event(JSONObject data) { runOnUiThread(() -> { if (ui != null && trustedPage) ui.evaluateJavascript("window.__mixNativeEvent&&window.__mixNativeEvent(" + data.toString() + ");", null); }); }
    void theme(String mode) { boolean dark = mode.equals("dark"); root.setBackgroundColor(dark ? Color.rgb(17, 21, 25) : Color.WHITE); ui.setBackgroundColor(dark ? Color.rgb(17, 21, 25) : Color.WHITE); getWindow().setStatusBarColor(dark ? Color.rgb(17, 21, 25) : Color.WHITE); getWindow().setNavigationBarColor(dark ? Color.rgb(17, 21, 25) : Color.WHITE); getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR); }
    void exportFile(Object id, JSONObject data) throws Exception {
        if (pendingFileId != null) throw new IllegalStateException("请先完成当前文件选择");
        String json = data.has("json") ? data.getString("json") : data.optString("text", ""); byte[] bytes = json.getBytes(StandardCharsets.UTF_8); if (bytes.length > NativeNetwork.MAX_BODY) throw new IllegalArgumentException("歌单文件过大");
        pendingFileId = id; pendingExport = bytes; String name = data.optString("suggestedName", data.optString("fileName", "MixTunes-歌单备份.json")).replaceAll("[\\\\/\\r\\n]", "_");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, name); startActivityForResult(intent, EXPORT);
    }
    void importFile(Object id) {
        if (pendingFileId != null) throw new IllegalStateException("请先完成当前文件选择"); pendingFileId = id;
        startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "text/csv"}), IMPORT);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data); if ((request != IMPORT && request != EXPORT) || pendingFileId == null) return;
        Object id = pendingFileId; final byte[] exportBytes = pendingExport; pendingFileId = null; pendingExport = null;
        if (result != RESULT_OK || data == null || data.getData() == null) { pendingExport = null; reply(id, true, Json.object("canceled", true), null); return; }
        Uri uri = data.getData();
        bridge.storage.execute(() -> {
            try {
                if (request == EXPORT) { try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) { if (output == null || exportBytes == null) throw new IllegalStateException("无法写入文件"); output.write(exportBytes); } reply(id, true, Json.object("saved", true), null); }
                else { String text = new String(NativeNetwork.read(getContentResolver().openInputStream(uri), NativeNetwork.MAX_BODY), StandardCharsets.UTF_8); reply(id, true, Json.object("text", text), null); }
            } catch (Exception error) { pendingExport = null; reply(id, false, null, Json.error(error)); }
        });
    }
    void receiveShareIntent(Intent intent){
        if(intent==null||intent.getData()==null)return;
        Uri value=intent.getData();if(!"mixtunes".equals(value.getScheme())||!"playlist-import".equals(value.getHost()))return;
        try{pendingShareUrl=ShareLink.normalise(value.getQueryParameter("url"));dispatchShareIntent();}
        catch(Exception invalid){if(uiReady)event(Json.object("type","notice","message","歌单链接无效，请在电脑上重新生成"));}
    }
    void dispatchShareIntent(){if(!uiReady||pendingShareUrl==null)return;String url=pendingShareUrl;pendingShareUrl=null;event(Json.object("type","playlist-import-link","url",url));}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);receiveShareIntent(intent);}
    @Override protected void onResume(){super.onResume();SleepTimerHost.checkExpired(this);if(uiReady)event(Json.object("type","accounts-refresh"));}
    void onSleepTimerExpired(){event(Json.object("type","sleep-timer-expired"));}
    @Override public void onBackPressed() {
        if(official.back())return;
        if(ui==null||!trustedPage){moveTaskToBack(true);return;}
        ui.evaluateJavascript("(window.mobileUI&&window.mobileUI.back)?window.mobileUI.back():false",value->{if(!"true".equals(value)&&!isFinishing())moveTaskToBack(true);});
    }
    @Override protected void onDestroy() {
        if (current != null && current.get() == this) current = null;
        trustedPage = false;uiReady=false;
        // Back moves the task to the background and does not reach onDestroy.
        // A genuinely destroyed UI no longer owns a running JS queue.
        boolean ownsAudio = boundAudio != null && boundAudio.listener == audioListener;
        if (ownsAudio) boundAudio.listener = null;
        if (!isChangingConfigurations() && ownsAudio) PlaybackService.release(this);
        if (official != null) official.destroy(); if (bridge != null) bridge.destroy();
        if (ui != null) { ui.removeJavascriptInterface("MixTunesBridge"); ui.destroy(); ui = null; }
        super.onDestroy();
    }
}
