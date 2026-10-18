package local.mixtunes.mobile;

import java.net.URI;
import java.net.URLDecoder;
import java.util.LinkedHashMap;
import java.util.Map;

public final class QqMobileLoginTest {
    static void require(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    static Map<String,String> query(String value) throws Exception {
        Map<String,String> result = new LinkedHashMap<>();
        for (String field : new URI(value).getRawQuery().split("&")) { String[] parts = field.split("=", 2); result.put(URLDecoder.decode(parts[0], "UTF-8"), URLDecoder.decode(parts[1], "UTF-8")); }
        return result;
    }
    public static void main(String[] args) throws Exception {
        Map<String,String> auth = query(QqMobileLogin.authorizeUrl());
        require(new URI(QqMobileLogin.authorizeUrl()).getHost().equals("graph.qq.com"), "optional quick authorization must remain official");
        require(auth.get("client_id").equals("100497308") && auth.get("display").equals("mobile"), "official mobile QQ Music identity required");
        String callback = auth.get("redirect_uri");
        require(new URI(callback).getHost().equals("y.qq.com") && new URI(callback).getPath().equals("/m/login/redirect.html"), "music authorization callback must remain first party");
        require(query(callback).get("is_qq_connect").equals("1") && query(callback).get("login_type").equals("1"), "QQ Connect callback mode required");
        require(query(callback).get("surl").equals(QqMobileLogin.CHOICE_URL), "callback must return to fixed QQ Music origin");
        Map<String,String> account = query(QqMobileLogin.accountUrl());
        require(QqMobileLogin.defaultUrl().equals(QqMobileLogin.accountUrl()), "embedded login must default to account flow without native app detection");
        require(query(QqMobileLogin.defaultUrl()).get("pt_no_onekey").equals("1"), "default login must explicitly disable incompatible one-key flow");
        require(new URI(QqMobileLogin.accountUrl()).getHost().equals("ui.ptlogin2.qq.com"), "account fallback must be official login page");
        require(account.get("pt_no_onekey").equals("1") && account.get("appid").equals("83886593"), "account fallback must use official visible password flow");
        require(query(account.get("s_url")).get("surl").equals(QqMobileLogin.CHOICE_URL), "account callback cannot leave QQ Music");
        for (String allowed : new String[]{QqMobileLogin.authorizeUrl(), QqMobileLogin.accountUrl(), callback, QqMobileLogin.CHOICE_URL, "https://xui.ptlogin2.qq.com/cgi-bin/xlogin", "https://open.weixin.qq.com/connect/oauth2/authorize"}) require(QqMobileLogin.allowed("qq", allowed), "official navigation rejected");
        for (String blocked : new String[]{"http://graph.qq.com/", "file:///android_asset/index.html", "javascript:alert(1)", "intent://anything", "https://graph.qq.com.evil.test/", "https://evil.test/?return=https://y.qq.com/", "https://evil@y.qq.com/", "https://y.qq.com:444/", "https://music.163.com/", "https://passport.bilibili.com/", "https://unrelated.qq.com/"}) require(!QqMobileLogin.allowed("qq", blocked), "unsafe/cross-platform navigation allowed: " + blocked);
        require(!QqMobileLogin.allowed("netease", QqMobileLogin.authorizeUrl()) && !QqMobileLogin.allowed("bilibili", QqMobileLogin.authorizeUrl()), "QQ helper must not govern other platforms");
        require(QqMobileLogin.choicePage(QqMobileLogin.CHOICE_URL), "official choice page missing");
        require(!QqMobileLogin.choicePage(QqMobileLogin.MUSIC_HOME) && !QqMobileLogin.choicePage(QqMobileLogin.CHOICE_URL + "&other=1"), "choice injection cannot follow arbitrary navigation");
        System.out.println("authorizeUrl=" + QqMobileLogin.authorizeUrl());
        System.out.println("accountUrl=" + QqMobileLogin.accountUrl());
        System.out.println("choiceUrl=" + QqMobileLogin.CHOICE_URL);
        System.out.println("choiceScript=" + QqMobileLogin.choiceScript());
        System.out.println("QqMobileLogin: official identity/callback, visible account fallback, allowlist, platform scope PASS");
    }
}
