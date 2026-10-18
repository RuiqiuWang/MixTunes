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
    static String authorizeUrl() {
        return "https://graph.qq.com/oauth2.0/authorize?" + query("response_type", "code", "client_id", "100497308", "redirect_uri", callback(true), "state", "state", "display", "mobile", "scope", "get_user_info,get_app_friends");
    }
    // Embedded WebViews may fail QQ app detection even when QQ is current.
    // Start with the official password flow; quick authorization stays opt-in.
    static String defaultUrl() { return accountUrl(); }
    static String accountUrl() {
        return "https://ui.ptlogin2.qq.com/cgi-bin/login?" + query("pt_no_auth", "1", "pt_wxtest", "1", "pt_no_onekey", "1", "daid", "384", "style", "9", "hln_css", "https://y.gtimg.cn/music/common/upload/t_cm3_photo_publish/1117688.png?max_age=2592000", "appid", "83886593", "s_url", callback(false));
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
