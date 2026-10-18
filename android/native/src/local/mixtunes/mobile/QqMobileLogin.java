package local.mixtunes.mobile;

import java.net.URI;

// Let QQ Music's live site choose its registered login parameters and callback.
// Copied app IDs can be rejected even when their password page still renders.
final class QqMobileLogin {
    static final String DESKTOP_URL = "https://y.qq.com/n/ryqq_v2/profile";
    static final String MUSIC_HOME = "https://i2.y.qq.com/n3/other/pages/myqq/index.html";
    static String defaultUrl() { return DESKTOP_URL; }
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
    static boolean desktopPage(String value) { return DESKTOP_URL.equals(value) || "https://y.qq.com/n/ryqq/profile".equals(value); }
    static boolean playerPage(String value) {
        URI url = safe(value); return url != null && "y.qq.com".equalsIgnoreCase(url.getHost()) && "/portal/player.html".equals(url.getPath());
    }
    static String desktopScript() {
        return "(()=>{if(location.protocol!=='https:'||location.hostname!=='y.qq.com'||!['/n/ryqq/profile','/n/ryqq_v2/profile'].includes(location.pathname))return false;if(window.__mixQqDesktopOpened)return true;const b=document.querySelector('.profile_unlogin__btn');if(!b)return false;b.click();window.__mixQqDesktopOpened=true;return true;})()";
    }
}
