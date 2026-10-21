package local.mixtunes.mobile;

import java.net.URI;
import java.net.URLEncoder;

// These are QQ Music's own website identifiers and callbacks, not a MixTunes
// OAuth application identity. Verified against the official music-react 2.3.0.
final class QqMobileLogin {
    static final String MUSIC_HOME = "https://i2.y.qq.com/n3/other/pages/myqq/index.html";
    static final String CHOICE_URL = MUSIC_HOME + "?outsideLogin=1";
    static final String CALLBACK = "https://y.qq.com/m/login/redirect.html";
    private static String encode(String value) { try { return URLEncoder.encode(value, "UTF-8"); } catch (Exception impossible) { throw new IllegalStateException(impossible); } }
    private static String query(String... fields) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < fields.length; i += 2) { if (result.length() > 0) result.append('&'); result.append(encode(fields[i])).append('=').append(encode(fields[i + 1])); }
        return result.toString();
    }
    static String callback(boolean connect) {
        return CALLBACK + "?" + (connect ? "is_qq_connect=1&" : "") + query("login_type", "1", "surl", CHOICE_URL);
    }
    static String authorizeUrl() { return authorizeUrl(true); }
    private static String authorizeUrl(boolean mobile) {
        return "https://graph.qq.com/oauth2.0/authorize?" + query("response_type", "code", "client_id", "100497308", "redirect_uri", callback(true), "state", "state", "display", mobile ? "mobile" : "pc", "scope", "get_user_info,get_app_friends");
    }
    static String accountUrl() {
        // The old ptlogin-only callback returned without exchanging a QQ
        // Connect code for a QQ Music session. Keep both methods on the music
        // site's full authorization flow; the native view uses desktop UA here.
        return authorizeUrl(false);
    }
    static String handoffUrl(String value) {
        if (value == null || value.length() > 32768) return "";
        try {
            URI uri = new URI(value); String scheme = uri.getScheme(); if (scheme == null || uri.getRawUserInfo() != null) return "";
            if ("intent".equalsIgnoreCase(scheme)) {
                int mark = value.indexOf("#Intent;"); if (!value.startsWith("intent://") || mark < 0 || !value.endsWith(";end")) return "";
                String inner = "", requestedPackage = "";
                for (String field : value.substring(mark + 8, value.length() - 4).split(";")) {
                    if (field.startsWith("scheme=")) { if (!inner.isEmpty()) return ""; inner = field.substring(7); }
                    if (field.startsWith("package=")) { if (!requestedPackage.isEmpty()) return ""; requestedPackage = field.substring(8); }
                }
                String clean = inner + "://" + value.substring(9, mark);
                String pkg = handoffPackage(clean);
                if (pkg.isEmpty() || !requestedPackage.isEmpty() && !requestedPackage.equals(pkg)) return "";
                return clean; // Drop component, selector, arbitrary extras and browser fallback.
            }
            return handoffPackage(value).isEmpty() ? "" : value;
        } catch (Exception invalid) { return ""; }
    }
    static String handoffPackage(String value) {
        try {
            URI uri = new URI(value); if (uri.getRawUserInfo() != null || uri.getScheme() == null) return "";
            String scheme = uri.getScheme().toLowerCase(java.util.Locale.ROOT);
            if (scheme.equals("wtloginmqq") || scheme.equals("mqqapi") || scheme.equals("mqqopensdkapi") || scheme.equals("mqq")) return "com.tencent.mobileqq";
            if (scheme.equals("qqmusic") || scheme.equals("androidqqmusic")) return "com.tencent.qqmusic";
            if (scheme.equals("weixin")) return "com.tencent.mm";
        } catch (Exception invalid) { }
        return "";
    }
    static boolean handoffAllowed(String source, String target) {
        return allowed(source) && !handoffUrl(target).isEmpty();
    }
    private static URI safe(String value) {
        try { URI url = new URI(value); if (!"https".equalsIgnoreCase(url.getScheme()) || url.getHost() == null || url.getRawUserInfo() != null || url.getPort() != -1 && url.getPort() != 443) return null; return url; }
        catch (Exception invalid) { return null; }
    }
    private static boolean domain(String host, String root) { return host.equals(root) || host.endsWith("." + root); }
    static boolean allowed(String value) {
        URI url = safe(value); if (url == null) return false; String host = url.getHost().toLowerCase(java.util.Locale.ROOT);
        return domain(host, "y.qq.com") || domain(host, "ptlogin2.qq.com") || domain(host, "captcha.qq.com") || host.equals("graph.qq.com") || host.equals("connect.qq.com") || host.equals("aq.qq.com") || host.equals("ssl.zc.qq.com") || domain(host, "weixin.qq.com") || domain(host, "weixin.com") || domain(host, "wechat.com");
    }
    static boolean allowed(String platform, String value) { return "qq".equals(platform) && allowed(value); }
    static boolean musicReturnPage(String value) {
        URI url = safe(value); return url != null && url.getHost().equals("i2.y.qq.com") && url.getPath().equals("/n3/other/pages/myqq/index.html");
    }
    static boolean choicePage(String value) { return musicReturnPage(value) && value.equals(CHOICE_URL); }
    static String choiceScript() {
        return "(()=>{if(location.protocol!=='https:'||location.hostname!=='i2.y.qq.com'||location.pathname!=='/n3/other/pages/myqq/index.html'||new URLSearchParams(location.search).get('outsideLogin')!=='1')return false;if(typeof window.Music?.userLogin!=='function')return false;if(!window.__mixQqChoiceOpened){window.Music.userLogin({noConfirm:true});window.__mixQqChoiceOpened=true;}return true;})()";
    }
}
