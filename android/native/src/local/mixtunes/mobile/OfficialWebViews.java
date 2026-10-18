package local.mixtunes.mobile;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class OfficialWebViews {
    final MainActivity activity;
    WebView login;
    LinearLayout loginPanel;
    WebView video;
    FrameLayout videoPanel;
    TextView videoStatus;
    Button videoRetry;
    String videoEmbedUrl;
    JSONObject videoRequest;
    String loginPlatform;
    boolean qqChoicePending;
    boolean videoReady;
    boolean videoWantPlay;
    boolean videoClosed;
    boolean videoStartPending;
    boolean videoSeeking;
    boolean videoFallback;
    View videoCustomView;
    WebChromeClient.CustomViewCallback videoCustomCallback;
    final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    // 内嵌播放器会按 UA 选内核：桌面 UA 会挂 PC 版（<bwp-video> 自定义元素，且更容易被风控），
    // 手机 UA 才会挂 H5 播放器（真正的 <video>，也支持全屏手势）。
    static final String MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    static final Pattern VIDEO_PATH = Pattern.compile("^/video/(BV[a-zA-Z0-9]{10}|av[0-9]{1,20})/?$");
    OfficialWebViews(MainActivity activity) { this.activity = activity; main.post(poll); }
    private WebView web() {
        WebView web = new WebView(activity); WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setDatabaseEnabled(true); settings.setUserAgentString(DESKTOP_UA);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false); CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebChromeClient(new WebChromeClient()); return web;
    }
    static boolean loginAllowed(String platform, String value) {
        try {
            URI url = new URI(value); if (!"https".equalsIgnoreCase(url.getScheme()) || url.getUserInfo() != null || url.getHost() == null || url.getPort() != -1 && url.getPort() != 443) return false;
            String host = url.getHost().toLowerCase(java.util.Locale.ROOT);
            if (platform.equals("qq")) return QqMobileLogin.allowed(platform, value);
            if (platform.equals("netease")) return NativeNetwork.suffix(host, "163.com") || NativeNetwork.suffix(host, "126.net") || NativeNetwork.suffix(host, "qq.com") || NativeNetwork.suffix(host, "weibo.com");
            return NativeNetwork.suffix(host, "bilibili.com") || NativeNetwork.suffix(host, "qq.com") || NativeNetwork.suffix(host, "weibo.com");
        } catch (Exception ignored) { return false; }
    }
    void login(String platform) {
        if (!platform.matches("qq|netease|bilibili")) throw new IllegalArgumentException("不支持的平台");
        closeLogin(); loginPlatform = platform;
        loginPanel = new LinearLayout(activity); loginPanel.setOrientation(LinearLayout.VERTICAL); loginPanel.setBackgroundColor(Color.WHITE);
        LinearLayout bar = new LinearLayout(activity); TextView title = new TextView(activity); title.setText(platform.equals("qq") ? "QQ 音乐官方登录" : platform.equals("netease") ? "网易云官方登录" : "Bilibili 官方登录"); title.setPadding(24, 16, 8, 16);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1)); Button done = new Button(activity); done.setText("完成"); done.setOnClickListener(v -> closeLogin()); bar.addView(done); loginPanel.addView(bar);
        login = web();login.getSettings().setUserAgentString(WebSettings.getDefaultUserAgent(activity));
        qqChoicePending = false;
        if (platform.equals("qq")) {
            LinearLayout methods = new LinearLayout(activity);
            String[] labels = {"QQ授权", "账号密码", "更多登录"};
            for (int i = 0; i < labels.length; i++) {
                final int method = i; Button button = new Button(activity); button.setText(labels[i]); button.setTextSize(14);
                button.setOnClickListener(v -> { if (login == null || !"qq".equals(loginPlatform)) return; qqChoicePending = method == 2; login.loadUrl(method == 0 ? QqMobileLogin.authorizeUrl() : method == 1 ? QqMobileLogin.accountUrl() : QqMobileLogin.CHOICE_URL); });
                methods.addView(button, new LinearLayout.LayoutParams(0, -2, 1));
            }
            loginPanel.addView(methods);
        }
        login.setWebViewClient(new WebViewClient() { @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String target=request.getUrl().toString();if(loginAllowed(platform,target))return false;
            if(request.hasGesture()&&loginAllowed(platform,view.getUrl()))MobileLogin.handoff(activity,platform,target);
            return true;
        }
            @Override public void onPageFinished(WebView view, String url) {
                if (!platform.equals("qq") || login != view) return;
                if (qqChoicePending && QqMobileLogin.choicePage(url)) showQqChoices(view, 0);
                else if (QqMobileLogin.musicReturnPage(url)) { CookieManager.getInstance().flush(); activity.event(Json.object("type", "accounts-refresh", "platform", "qq")); }
            }
        });
        // There is deliberately no addJavascriptInterface on this remote page.
        loginPanel.addView(login, new LinearLayout.LayoutParams(-1, 0, 1)); activity.root.addView(loginPanel, new FrameLayout.LayoutParams(-1, -1));
        login.loadUrl(platform.equals("qq") ? QqMobileLogin.authorizeUrl() : platform.equals("netease") ? "https://music.163.com/m/login/" : "https://passport.bilibili.com/h5-app/passport/login");
    }
    private void showQqChoices(WebView view, int attempt) {
        if (login != view || !"qq".equals(loginPlatform) || !qqChoicePending || !QqMobileLogin.choicePage(view.getUrl())) return;
        view.evaluateJavascript(QqMobileLogin.choiceScript(), result -> {
            if (login != view || !qqChoicePending) return;
            if ("true".equals(result)) qqChoicePending = false;
            else if (attempt < 15) main.postDelayed(() -> showQqChoices(view, attempt + 1), 300);
            else { qqChoicePending = false; android.widget.Toast.makeText(activity, "官方登录组件未加载，请使用 QQ授权或账号密码", android.widget.Toast.LENGTH_LONG).show(); }
        });
    }
    void closeLogin() {
        if (login == null) return; String platform = loginPlatform; qqChoicePending = false; login.stopLoading(); login.destroy(); login = null;
        if (loginPanel != null) activity.root.removeView(loginPanel); loginPanel = null; CookieManager.getInstance().flush();
        activity.event(Json.object("type", "accounts-refresh", "platform", platform));
    }
    boolean back() {
        if (login != null) { if (login.canGoBack()) login.goBack(); else closeLogin(); return true; }
        if (videoCustomView != null) { hideVideoCustom(); return true; }
        if (videoPanel != null && videoPanel.getVisibility() == View.VISIBLE) { closeVideo(); return true; }
        return false;
    }
    // The desktop watch page never mounts its player inside a phone-sized WebView,
    // so the panel loads the official embeddable player instead. The incoming url is
    // still validated as an official www.bilibili.com watch link.
    void loadVideo(JSONObject data) throws Exception {
        String url = data.getString("url"); URI target = new URI(url);
        if (!"https".equalsIgnoreCase(target.getScheme()) || !"www.bilibili.com".equalsIgnoreCase(target.getHost())) throw new SecurityException("仅支持官方 Bilibili 视频");
        String path = target.getPath() == null ? "" : target.getPath();
        Matcher matcher = VIDEO_PATH.matcher(path);
        if (!matcher.matches()) throw new SecurityException("仅支持官方 Bilibili 视频");
        String id = matcher.group(1);
        int page = 1;
        String query = target.getRawQuery();
        if (query != null) for (String part : query.split("&")) { if (part.startsWith("p=")) { try { page = Math.max(1, Integer.parseInt(part.substring(2).trim())); } catch (Exception ignored) {} } }
        String embed = "https://player.bilibili.com/player.html?" + (id.startsWith("BV") ? "bvid=" + id : "aid=" + id.substring(2)) + "&page=" + page + "&autoplay=1&danmaku=0&high_quality=1";
        closeVideo(false); videoRequest = new JSONObject(data.toString()); videoEmbedUrl = embed; videoFallback = false;
        videoReady = false; videoWantPlay = false; videoClosed = false; videoStartPending = false; lastVideoState = "";
        videoPanel = new FrameLayout(activity); videoPanel.setBackgroundColor(Color.BLACK);
        video = web(); video.setBackgroundColor(Color.BLACK);
        WebSettings vs = video.getSettings();
        vs.setUseWideViewPort(true); vs.setLoadWithOverviewMode(true); vs.setSupportZoom(false); vs.setBuiltInZoomControls(false);
        videoPanel.addView(video, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout bar = new LinearLayout(activity); bar.setOrientation(LinearLayout.HORIZONTAL);
        Button close = new Button(activity); close.setText("收起"); close.setTextSize(13); close.setOnClickListener(v -> closeVideo());
        // 内嵌播放器万一被风控挡住，至少还有一条“在系统浏览器里看”的退路。
        Button external = new Button(activity); external.setText("浏览器"); external.setTextSize(13);
        external.setOnClickListener(v -> {
            try {
                String openUrl = videoRequest != null ? videoRequest.optString("url") : url;
                activity.startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(openUrl)));
            } catch (Exception ignored) {}
        });
        bar.addView(external); bar.addView(close);
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END);
        barParams.topMargin = activity.dp(4); barParams.rightMargin = activity.dp(4);
        videoPanel.addView(bar, barParams);
        videoStatus = new TextView(activity); videoStatus.setTextColor(Color.WHITE); videoStatus.setTextSize(14);
        videoStatus.setGravity(Gravity.CENTER); videoStatus.setText("正在加载视频…（停留在封面时请先登录 B 站）");
        videoRetry = new Button(activity); videoRetry.setText("重试"); videoRetry.setTextSize(13);
        videoRetry.setVisibility(View.GONE);
        videoRetry.setOnClickListener(v -> retryVideo());
        LinearLayout statusBox = new LinearLayout(activity); statusBox.setOrientation(LinearLayout.VERTICAL); statusBox.setGravity(Gravity.CENTER);
        statusBox.addView(videoStatus); statusBox.addView(videoRetry);
        videoPanel.addView(statusBox, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        activity.root.addView(videoPanel, new FrameLayout.LayoutParams(-1, -1));
        // 不再提供手动横竖屏按钮：视频跟随手机的自动旋转（系统里关掉自动旋转就会保持竖屏）。
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER);
        // Some devices render WebView media with audio but no picture unless the view is
        // explicitly placed on a hardware layer.
        video.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        video.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) { showVideoCustom(view, callback); }
            @Override public void onHideCustomView() { hideVideoCustom(); }
        });
        video.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String next = request.getUrl().toString();
                String base = videoEmbedUrl;
                if (base != null && (next.equals(base) || next.startsWith(base + "&") || next.startsWith(base + "#") || next.startsWith(base + "?"))) return false;
                if (next.equals(url) || next.startsWith(url + "?")) return false;
                return true;
            }
            @Override public void onPageStarted(WebView view, String current, android.graphics.Bitmap favicon) { videoReady = false; view.getSettings().setMediaPlaybackRequiresUserGesture(true); }
            @Override public void onPageFinished(WebView view, String current) {
                if (video != view || videoRequest == null) return;
                view.evaluateJavascript(bootstrap(videoRequest), result -> {
                    if (video != view) return; videoReady = true; view.getSettings().setMediaPlaybackRequiresUserGesture(false);
                    if (videoWantPlay) playVideo();
                });
            }
        });
        Map<String, String> headers = new HashMap<>(); headers.put("Referer", "https://www.bilibili.com/");
        video.getSettings().setUserAgentString(MOBILE_UA);
        video.loadUrl(embed, headers);
    }
    private void showVideoCustom(View view, WebChromeClient.CustomViewCallback callback) {
        if (videoCustomView != null) { callback.onCustomViewHidden(); return; }
        videoCustomView = view; videoCustomCallback = callback;
        if (videoPanel != null) videoPanel.setVisibility(View.GONE);
        activity.root.addView(view, new FrameLayout.LayoutParams(-1, -1));
    }
    private void hideVideoCustom() {
        if (videoCustomView == null) return;
        View view = videoCustomView; WebChromeClient.CustomViewCallback callback = videoCustomCallback;
        videoCustomView = null; videoCustomCallback = null;
        activity.root.removeView(view);
        if (videoPanel != null) videoPanel.setVisibility(View.VISIBLE);
        if (callback != null) callback.onCustomViewHidden();
    }
    // Some videos refuse to be embedded. When the embeddable player never produces a
    // <video> element, retry once on the official mobile watch page with a phone UA.
    // Shows a plain-language overlay instead of a silent black panel, and offers a manual
    // retry that jumps straight to the mobile watch page.
    private void retryVideo() {
        if (video == null || videoRequest == null) return;
        setVideoStatus("正在重试…", false);
        videoReady = false; lastVideoState = ""; videoRequest.remove("_errorSent");
        if (videoFallback) { video.stopLoading(); video.loadUrl(videoEmbedUrl); }
        else loadVideoFallback();
    }
    private void setVideoStatus(String text, boolean retry) {
        if (videoStatus == null) return;
        if (text == null) { videoStatus.setVisibility(View.GONE); if (videoRetry != null) videoRetry.setVisibility(View.GONE); return; }
        videoStatus.setVisibility(View.VISIBLE); videoStatus.setText(text);
        if (videoRetry != null) videoRetry.setVisibility(retry ? View.VISIBLE : View.GONE);
    }
    private void loadVideoFallback() {
        if (video == null || videoRequest == null) return;
        String url = videoRequest.optString("url");
        try {
            URI target = new URI(url);
            Matcher matcher = VIDEO_PATH.matcher(target.getPath() == null ? "" : target.getPath());
            if (!matcher.matches()) return;
            String id = matcher.group(1);
            int page = 1;
            String query = target.getRawQuery();
            if (query != null) for (String part : query.split("&")) { if (part.startsWith("p=")) { try { page = Math.max(1, Integer.parseInt(part.substring(2).trim())); } catch (Exception ignored) {} } }
            String mobile = "https://m.bilibili.com/video/" + id + (page > 1 ? "?p=" + page : "");
            videoEmbedUrl = mobile; videoFallback = true;
            video.getSettings().setUserAgentString(MOBILE_UA);
            setVideoStatus("正在加载视频…（停留在封面时请先登录 B 站）", false);
            video.stopLoading();
            video.loadUrl(mobile);
        } catch (Exception ignored) {}
    }
    private String bootstrap(JSONObject request) {
        return "(()=>{const cfg=" + request.toString() + ";"
            + "if(window.__mixMobileVideo)return true;"
            + "const s={cfg,start:Math.max(0,cfg.startMs||0)/1000,end:cfg.endMs==null?null:cfg.endMs/1000,initial:Math.max(0,cfg.initialPositionMs==null?(cfg.startMs||0):cfg.initialPositionMs)/1000,want:false,positioned:false,ended:false,error:'',startedAt:Date.now(),watched:new WeakSet(),original:HTMLMediaElement.prototype.play};window.__mixMobileVideo=s;"
            + "s.pick=()=>{let v=document.querySelector('video');if(v)return v;v=document.querySelector('bwp-video');if(v)return v;const nodes=document.querySelectorAll('*');for(let i=0;i<nodes.length;i++){const el=nodes[i];if(/video/i.test(el.tagName||'')&&typeof el.play==='function'&&('currentTime' in el))return el;}return null;};"
            + "s.find=()=>{let v=s.el&&document.contains(s.el)?s.el:null;if(!v){v=s.pick();if(!v){const f=document.querySelector('iframe');try{if(f&&f.contentDocument)v=f.contentDocument.querySelector('video, bwp-video');}catch(e){}}if(v)s.el=v;}if(v&&!s.watched.has(v)){s.watched.add(v);v.pause();v.muted=!!cfg.muted;v.addEventListener('ended',e=>{e.stopImmediatePropagation();if(!s.positioned||v.seeking)return;s.want=false;s.ended=true;v.pause();},true);}return v;};"
            + "s.prepare=()=>{const v=s.find();if(!v||v.readyState<1)return false;if(s.positioned)return !v.seeking;v.pause();v.muted=!!cfg.muted;v.volume=cfg.volume==null?0.7:cfg.volume;if(s.start>=v.duration){s.start=0;s.end=null;s.initial=0;s.rangeReset=true;}const target=Math.max(s.start,Math.min(s.end==null?v.duration:s.end,s.initial));if(Math.abs(v.currentTime-target)>0.05)v.currentTime=target;if(v.seeking)return false;s.positioned=true;return true;};"
            + "s.play=async()=>{s.want=true;if(!s.prepare())return false;const v=s.find();if(!v)return false;if(v.currentTime<s.start||(s.end!==null&&v.currentTime>=s.end)){v.currentTime=s.start;for(let i=0;i<100&&v.seeking&&s.want;i++)await new Promise(r=>setTimeout(r,20));}if(!s.want||v.seeking)return false;if(v.tagName==='VIDEO')await s.original.call(v);else await v.play();return true;};"
            + "s.pause=()=>{s.want=false;const v=s.find();if(v)v.pause();};"
            + "s.seek=async(ms)=>{const revision=(s.seekRevision||0)+1;s.seekRevision=revision;s.ended=false;s.initial=Math.max(0,ms)/1000;s.positioned=false;for(let i=0;i<500&&revision===s.seekRevision;i++){if(s.prepare()){if(s.want)await s.play();return true;}await new Promise(r=>setTimeout(r,20));}return false;};"
            + "s.snapshot=()=>{const v=s.find();if(!v){if(!s.error&&Date.now()-s.startedAt>12000)s.error='timeout';return {ready:false,error:s.error};}if(!s.positioned)s.prepare();const ready=s.positioned&&v.readyState>0&&!v.seeking;if(ready&&s.want&&s.end!==null&&v.currentTime>=s.end){s.want=false;s.ended=true;v.pause();}return {ready,paused:v.paused,ended:ready&&(s.ended||v.ended),positionMs:Math.round(v.currentTime*1000),durationMs:Number.isFinite(v.duration)?Math.round(v.duration*1000):0,error:s.error,rangeReset:!!s.rangeReset};};"
            + "const style=document.createElement('style');style.textContent='html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important;width:100%!important;height:100%!important}video{position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important;object-fit:contain!important;background:#000!important;z-index:2147483000!important}bwp-video{position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important;z-index:2147483000!important}.bilibili-player,.bilibili-player-video,.bpx-player-container,.bpx-player-video-area{position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important}';document.head.append(style);s.prepare();return true;})()";
    }
    void playVideo() {
        videoWantPlay = true; videoStartPending = true;
        if (video != null && videoReady) video.evaluateJavascript("window.__mixMobileVideo&&window.__mixMobileVideo.play().catch(e=>window.__mixMobileVideo.error=e.name)", null);
    }
    void checkVideo(JSONObject data){if(videoRequest==null||data.has("generation")&&data.optLong("generation")!=videoRequest.optLong("generation"))throw new IllegalStateException("视频播放请求已失效");}
    void pauseVideo() { videoWantPlay = false; videoStartPending = false; if (video != null) video.evaluateJavascript("window.__mixMobileVideo&&window.__mixMobileVideo.pause()", null); }
    void seekVideo(long position) {
        videoSeeking=true;videoStartPending=videoWantPlay;
        if(videoRequest!=null)try{videoRequest.put("initialPositionMs",Math.max(0,position));}catch(Exception ignored){}
        if (video != null) video.evaluateJavascript("window.__mixMobileVideo&&window.__mixMobileVideo.seek(" + Math.max(0,position) + ").catch(e=>window.__mixMobileVideo.error=e.name)", null);
    }
    void rangeVideo(JSONObject range) { if (videoRequest != null) try { videoRequest.put("startMs", range.optLong("startMs", 0)); videoRequest.put("endMs", range.isNull("endMs") ? JSONObject.NULL : range.opt("endMs")); } catch (Exception ignored) {} if (video != null) video.evaluateJavascript("(()=>{const s=window.__mixMobileVideo;if(s){const r=" + range.toString() + ";s.start=Math.max(0,r.startMs||0)/1000;s.end=r.endMs==null?null:r.endMs/1000;s.ended=false;const v=s.find();if(v&&(v.currentTime<s.start||(s.end!==null&&v.currentTime>=s.end)))s.seek(s.start*1000).catch(e=>s.error=e.name);}})()", null); }
    void volumeVideo(JSONObject data) { float value = data.optBoolean("muted") ? 0 : (float) Math.max(0, Math.min(1, data.optDouble("volume", .7))); if(videoRequest!=null)try{videoRequest.put("volume",data.optDouble("volume",.7));videoRequest.put("muted",data.optBoolean("muted"));}catch(Exception ignored){} if (video != null) video.evaluateJavascript("(()=>{const s=window.__mixMobileVideo,v=document.querySelector('video');if(s){s.cfg.muted=" + data.optBoolean("muted") + ";s.cfg.volume=" + value + ";}if(v){v.muted=" + data.optBoolean("muted") + ";v.volume=" + value + ";}})()", null); }
    // The phone panel is always full screen: a narrow inline window keeps the desktop
    // player from mounting, so incoming bounds are intentionally ignored.
    void layoutVideo(JSONObject data) {
        if (videoPanel == null) return; videoPanel.setVisibility(data.optBoolean("visible", true) ? View.VISIBLE : View.GONE);
    }
    void closeVideo() { closeVideo(true); }
    private void closeVideo(boolean emit) {
        JSONObject old = videoRequest; pauseVideo();videoSeeking=false; hideVideoCustom();
        if (video != null) { video.stopLoading(); video.destroy(); video = null; }
        if (videoPanel != null) activity.root.removeView(videoPanel); videoPanel = null; videoStatus = null; videoRetry = null;
        videoEmbedUrl = null; videoFallback = false; videoReady = false; videoRequest = null;
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (emit && old != null && !videoClosed) { videoClosed = true; videoEvent(old, "closed", null); activity.event(Json.object("type", "video-panel-close")); }
    }
    private void videoEvent(JSONObject request, String type, JSONObject state) {
        JSONObject event = Json.object("type", type, "backend", "video", "key", request.optString("key"), "generation", request.optLong("generation"), "positionMs", state == null ? 0 : state.optLong("positionMs"), "durationMs", state == null ? 0 : state.optLong("durationMs"), "rangeReset", state != null && state.optBoolean("rangeReset"), "message", state == null ? "" : state.optString("message", ""));
        activity.event(Json.object("type", "video", "event", event));
    }
    // 未就绪时也必须把 timeout / 错误暴露出来，否则界面会永远停在“正在加载视频…”。
    private void failVideoIfNeeded(JSONObject request, JSONObject state) throws Exception {
        if (state.optString("error").isEmpty() || request.optBoolean("_errorSent")) return;
        request.put("_errorSent", true);
        if ("timeout".equals(state.optString("error")) && !videoFallback) { request.remove("_errorSent"); loadVideoFallback(); return; }
        String detail = state.optString("error");
        String message = "timeout".equals(detail) ? "视频加载超时：若一直停在封面，先在应用内登录 B 站再点重试" : "官方视频播放失败：" + detail;
        setVideoStatus(message, true);
        videoEvent(request, "error", Json.object("message", message));
    }
    private String lastVideoState = "";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (video != null && videoReady && videoRequest != null) {
                WebView view = video; JSONObject request = videoRequest;
                view.evaluateJavascript("JSON.stringify(window.__mixMobileVideo?window.__mixMobileVideo.snapshot():{ready:false})", value -> {
                    if (video != view || videoRequest != request) return;
                    try {
                        Object decoded = new JSONTokener(value).nextValue(); if (!(decoded instanceof String)) return; JSONObject state = new JSONObject((String) decoded);
                        if (!state.optBoolean("ready")) { failVideoIfNeeded(request, state); if (videoWantPlay) playVideo(); return; }
                        if(videoSeeking){videoSeeking=false;videoEvent(request,"seeked",state);}
                        if (videoStartPending && state.optBoolean("paused") && !state.optBoolean("ended")) playVideo();
                        if (!state.optBoolean("paused")) videoStartPending = false;
                        if (!request.optBoolean("_readySent")) { request.put("_readySent", true); videoEvent(request, "ready", state); setVideoStatus(null, false); }
                        failVideoIfNeeded(request, state);
                        String status = state.optBoolean("ended") ? "ended" : state.optBoolean("paused") ? "paused" : "playing";
                        if (!status.equals(lastVideoState)) { lastVideoState = status; videoEvent(request, status, state); }
                        videoEvent(request, "progress", state);
                    } catch (Exception ignored) {}
                });
            }
            main.postDelayed(this, 300);
        }
    };
    void destroy() { main.removeCallbacks(poll); closeLogin(); hideVideoCustom(); closeVideo(false); }
}
