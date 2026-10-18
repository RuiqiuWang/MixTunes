package local.mixtunes.mobile;

import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.RenderProcessGoneDetail;
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

final class OfficialWebViews {
    final MainActivity activity;
    WebView login;
    LinearLayout loginPanel;
    WebView video;
    FrameLayout videoPanel;
    TextView videoStatus;
    Runnable videoTimeout;
    JSONObject videoRequest;
    String loginPlatform;
    boolean qqChoicePending;
    boolean videoReady;
    boolean videoWantPlay;
    boolean videoClosed;
    boolean videoStartPending;
    boolean videoSeeking;
    final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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
    boolean back() { if (login != null) { if (login.canGoBack()) login.goBack(); else closeLogin(); return true; } if (videoPanel != null && videoPanel.getVisibility() == View.VISIBLE) { closeVideo(); return true; } return false; }
    void loadVideo(JSONObject data) throws Exception {
        String url = BilibiliVideoTarget.canonicalUrl(data.getString("url"));
        closeVideo(false); videoRequest = new JSONObject(data.toString()); videoReady = false; videoWantPlay = false; videoClosed = false; videoStartPending = false; lastVideoState = "";
        videoPanel = new FrameLayout(activity); videoPanel.setBackgroundColor(Color.BLACK); video = web(); video.setBackgroundColor(Color.BLACK);
        videoPanel.addView(video, new FrameLayout.LayoutParams(-1, -1)); Button close = new Button(activity); close.setText("收起视频");
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(-2, -2, android.view.Gravity.TOP | android.view.Gravity.RIGHT); videoPanel.addView(close, closeParams); close.setOnClickListener(v -> closeVideo());
        videoStatus = new TextView(activity); videoStatus.setText("正在加载 B站视频…"); videoStatus.setTextColor(Color.WHITE); videoStatus.setBackgroundColor(0xcc202020); videoStatus.setPadding(activity.dp(12), activity.dp(8), activity.dp(12), activity.dp(8));
        videoPanel.addView(videoStatus, new FrameLayout.LayoutParams(-1, -2, android.view.Gravity.BOTTOM));
        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(-1, activity.dp(260), android.view.Gravity.TOP); activity.root.addView(videoPanel, panelParams);
        final JSONObject request = videoRequest;
        video.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String next = request.getUrl().toString(); if (BilibiliVideoTarget.sameVideo(url, next)) return false;
                return true;
            }
            @Override public void onPageStarted(WebView view, String current, android.graphics.Bitmap favicon) { if(video!=view||videoRequest!=request)return; videoReady = false; view.getSettings().setMediaPlaybackRequiresUserGesture(true); }
            @Override public void onPageFinished(WebView view, String current) {
                if (video != view || videoRequest != request || request.optBoolean("_errorSent")) return;
                view.evaluateJavascript(bootstrap(request), result -> {
                    if (video != view || videoRequest != request || request.optBoolean("_errorSent")) return;
                    if (!"true".equals(result)) { videoError(request, "视频控制器初始化失败，请更新 Android System WebView 后重试"); return; }
                    videoReady = true; view.getSettings().setMediaPlaybackRequiresUserGesture(false);
                    if (videoWantPlay) playVideo();
                });
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest resource, WebResourceError error) {
                if(video==view&&resource.isForMainFrame())videoError(request,"B站视频页面加载失败（错误 "+error.getErrorCode()+"），请检查网络后重试");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest resource, WebResourceResponse response) {
                if(video==view&&resource.isForMainFrame())videoError(request,"B站视频页面请求失败（HTTP "+response.getStatusCode()+"）");
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if(video!=view)return true;
                videoError(request,"视频页面进程已退出，请重新打开视频或更新 Android System WebView");
                view.destroy();video=null;videoReady=false;return true;
            }
        });
        videoTimeout = () -> { if(videoRequest==request&&!request.optBoolean("_readySent"))videoError(request,"视频未就绪，请检查网络、账号权限及 Android System WebView 版本后重试"); };
        main.postDelayed(videoTimeout, 30000);
        video.loadUrl(url);
    }
    private String bootstrap(JSONObject request) {
        return "(()=>{const cfg=" + request.toString() + ";"
            + "if(window.__mixMobileVideo)return true;"
            + "const s={cfg,start:Math.max(0,cfg.startMs||0)/1000,end:cfg.endMs==null?null:cfg.endMs/1000,initial:Math.max(0,cfg.initialPositionMs==null?(cfg.startMs||0):cfg.initialPositionMs)/1000,want:false,positioned:false,ended:false,error:'',watched:new WeakSet(),original:HTMLMediaElement.prototype.play};window.__mixMobileVideo=s;"
            + "s.find=()=>{const v=document.querySelector('video');if(v&&s.current!==v){s.current=v;s.positioned=false;s.ended=false;s.error='';}if(v&&!s.watched.has(v)){s.watched.add(v);v.pause();v.muted=!!cfg.muted;v.addEventListener('error',()=>{if(s.current!==v)return;s.error='媒体资源加载或解码失败（错误 '+(v.error?.code||0)+'）';s.want=false;v.pause();});v.addEventListener('ended',e=>{e.stopImmediatePropagation();if(s.current!==v||!s.positioned||v.seeking)return;s.want=false;s.ended=true;v.pause();},true);}if(v?.error)s.error='媒体资源加载或解码失败（错误 '+v.error.code+'）';return v;};"
            + "s.prepare=()=>{const v=s.find();if(s.error||!v||v.readyState<1)return false;if(s.positioned)return !v.seeking;v.pause();v.muted=!!cfg.muted;v.volume=cfg.volume==null?0.7:cfg.volume;if(s.start>=v.duration){s.start=0;s.end=null;s.initial=0;s.rangeReset=true;}const target=Math.max(s.start,Math.min(s.end==null?v.duration:s.end,s.initial));if(Math.abs(v.currentTime-target)>0.05)v.currentTime=target;if(v.seeking)return false;s.positioned=true;return true;};"
            + "s.play=async()=>{s.want=true;if(!s.prepare())return false;const v=s.find();if(!v)return false;if(v.currentTime<s.start||(s.end!==null&&v.currentTime>=s.end)){v.currentTime=s.start;for(let i=0;i<100&&v.seeking&&s.want;i++)await new Promise(r=>setTimeout(r,20));}if(!s.want||v.seeking)return false;await s.original.call(v);return true;};"
            + "HTMLMediaElement.prototype.play=function(...args){if(this.tagName==='VIDEO'){if(!s.want){this.pause();return Promise.resolve();}return s.play();}return s.original.apply(this,args);};"
            + "s.pause=()=>{s.want=false;const v=s.find();if(v)v.pause();};"
            + "s.seek=async(ms)=>{const revision=(s.seekRevision||0)+1;s.seekRevision=revision;s.ended=false;s.initial=Math.max(0,ms)/1000;s.positioned=false;for(let i=0;i<500&&revision===s.seekRevision;i++){if(s.prepare()){if(s.want)await s.play();return true;}await new Promise(r=>setTimeout(r,20));}return false;};"
            + "s.snapshot=()=>{const v=s.find();if(!v)return {ready:false,error:s.error};if(s.error)return {ready:false,error:s.error};if(!s.positioned)s.prepare();if(!s.want&&!v.paused)v.pause();const ready=s.positioned&&v.readyState>0&&!v.seeking;if(ready&&s.want&&s.end!==null&&v.currentTime>=s.end){s.want=false;s.ended=true;v.pause();}return {ready,paused:v.paused,ended:ready&&(s.ended||v.ended),positionMs:Math.round(v.currentTime*1000),durationMs:Number.isFinite(v.duration)?Math.round(v.duration*1000):0,error:s.error,rangeReset:!!s.rangeReset};};"
            + "const style=document.createElement('style');style.textContent='html,body{background:#000!important;margin:0!important;padding:0!important;overflow:hidden!important}.bili-header,.bili-header-m,.right-container,.left-container-under-player,.video-info-container,#reco_list,.bili-footer{display:none!important}#bilibili-player,.bpx-player-container,.bpx-player-video-area{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;min-width:0!important;z-index:9999!important}';document.head.append(style);s.prepare();return true;})()";
    }
    void playVideo() {
        videoWantPlay = true; videoStartPending = true;
        if (video != null && videoReady && videoRequest != null && !videoRequest.optBoolean("_errorSent")) video.evaluateJavascript("window.__mixMobileVideo&&window.__mixMobileVideo.play().catch(e=>window.__mixMobileVideo.error=e.name)", null);
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
    void layoutVideo(JSONObject data) {
        if (videoPanel == null) return; videoPanel.setVisibility(data.optBoolean("visible", true) ? View.VISIBLE : View.GONE);
        JSONObject bounds = data.optJSONObject("bounds"); if (bounds != null) { FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(activity.dp(Math.max(1, bounds.optInt("width", 320))), activity.dp(Math.max(1, bounds.optInt("height", 200)))); params.leftMargin = activity.dp(Math.max(0, bounds.optInt("x", 0))); params.topMargin = activity.dp(Math.max(0, bounds.optInt("y", 0))); videoPanel.setLayoutParams(params); }
    }
    void closeVideo() { closeVideo(true); }
    private void closeVideo(boolean emit) {
        if(videoTimeout!=null)main.removeCallbacks(videoTimeout);videoTimeout=null;
        JSONObject old = videoRequest; pauseVideo();videoSeeking=false; if (video != null) { video.stopLoading(); video.destroy(); video = null; } if (videoPanel != null) activity.root.removeView(videoPanel); videoPanel = null; videoStatus = null; videoReady = false; videoRequest = null;
        if (emit && old != null && !videoClosed) { videoClosed = true; videoEvent(old, "closed", null); activity.event(Json.object("type", "video-panel-close")); }
    }
    private void videoEvent(JSONObject request, String type, JSONObject state) {
        JSONObject event = Json.object("type", type, "backend", "video", "key", request.optString("key"), "generation", request.optLong("generation"), "positionMs", state == null ? 0 : state.optLong("positionMs"), "durationMs", state == null ? 0 : state.optLong("durationMs"), "rangeReset", state != null && state.optBoolean("rangeReset"), "message", state == null ? "" : state.optString("message", ""));
        activity.event(Json.object("type", "video", "event", event));
    }
    private void videoError(JSONObject request, String message) {
        if(videoRequest!=request||request.optBoolean("_errorSent"))return;
        if(videoTimeout!=null)main.removeCallbacks(videoTimeout);videoTimeout=null;
        try { request.put("_errorSent",true); } catch(Exception ignored) {}
        videoWantPlay=false;videoStartPending=false;
        if(videoStatus!=null){videoStatus.setText(message);videoStatus.setVisibility(View.VISIBLE);}
        videoEvent(request,"error",Json.object("message",message));
    }
    private String lastVideoState = "";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (video != null && videoReady && videoRequest != null && !videoRequest.optBoolean("_errorSent")) {
                WebView view = video; JSONObject request = videoRequest;
                view.evaluateJavascript("JSON.stringify(window.__mixMobileVideo?window.__mixMobileVideo.snapshot():{ready:false})", value -> {
                    if (video != view || videoRequest != request || request.optBoolean("_errorSent")) return;
                    try {
                        Object decoded = new JSONTokener(value).nextValue(); if (!(decoded instanceof String)) return; JSONObject state = new JSONObject((String) decoded);
                        if (!state.optString("error").isEmpty()) { videoError(request,"官方视频播放失败："+state.optString("error")); return; }
                        if (!state.optBoolean("ready")) { if (videoWantPlay) playVideo(); return; }
                        if(videoStatus!=null)videoStatus.setVisibility(View.GONE);
                        if(videoTimeout!=null)main.removeCallbacks(videoTimeout);videoTimeout=null;
                        if(videoSeeking){videoSeeking=false;videoEvent(request,"seeked",state);}
                        if (videoStartPending && state.optBoolean("paused") && !state.optBoolean("ended")) playVideo();
                        if (!state.optBoolean("paused")) videoStartPending = false;
                        if (!request.optBoolean("_readySent")) { request.put("_readySent", true); videoEvent(request, "ready", state); }
                        String status = state.optBoolean("ended") ? "ended" : state.optBoolean("paused") ? "paused" : "playing";
                        if (!status.equals(lastVideoState)) { lastVideoState = status; videoEvent(request, status, state); }
                        videoEvent(request, "progress", state);
                    } catch (Exception invalidState) { videoError(request,"视频状态读取失败，请重新打开视频"); }
                });
            }
            main.postDelayed(this, 300);
        }
    };
    void destroy() { main.removeCallbacks(poll); closeLogin(); closeVideo(false); }
}
