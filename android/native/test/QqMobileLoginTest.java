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
        require(new URI(QqMobileLogin.authorizeUrl()).getHost().equals("graph.qq.com"), "default must open official authorization, not music homepage");
        require(auth.get("client_id").equals("100497308") && auth.get("display").equals("mobile"), "official mobile QQ Music identity required");
        String callback = auth.get("redirect_uri");
        require(new URI(callback).getHost().equals("y.qq.com") && new URI(callback).getPath().equals("/m/login/redirect.html"), "music authorization callback must remain first party");
        require(query(callback).get("is_qq_connect").equals("1") && query(callback).get("login_type").equals("1"), "QQ Connect callback mode required");
        require(query(callback).get("surl").equals(QqMobileLogin.CHOICE_URL), "callback must return to fixed QQ Music origin");
        Map<String,String> account = query(QqMobileLogin.accountUrl());
        require(new URI(QqMobileLogin.accountUrl()).getHost().equals("graph.qq.com"), "web fallback must complete QQ Connect, not stop at a generic QQ session");
        require(account.get("display").equals("pc") && account.get("response_type").equals("code"), "web fallback must retain the code exchange in desktop web mode");
        require(account.get("redirect_uri").equals(callback), "both methods must exchange credentials at the same first-party QQ Music callback");
        for (String allowed : new String[]{QqMobileLogin.authorizeUrl(), QqMobileLogin.accountUrl(), callback, QqMobileLogin.CHOICE_URL, "https://xui.ptlogin2.qq.com/cgi-bin/xlogin", "https://open.weixin.qq.com/connect/oauth2/authorize"}) require(QqMobileLogin.allowed("qq", allowed), "official navigation rejected");
        for (String blocked : new String[]{"http://graph.qq.com/", "file:///android_asset/index.html", "javascript:alert(1)", "intent://anything", "https://graph.qq.com.evil.test/", "https://evil.test/?return=https://y.qq.com/", "https://evil@y.qq.com/", "https://y.qq.com:444/", "https://music.163.com/", "https://passport.bilibili.com/", "https://unrelated.qq.com/"}) require(!QqMobileLogin.allowed("qq", blocked), "unsafe/cross-platform navigation allowed: " + blocked);
        require(!QqMobileLogin.allowed("netease", QqMobileLogin.authorizeUrl()) && !QqMobileLogin.allowed("bilibili", QqMobileLogin.authorizeUrl()), "QQ helper must not govern other platforms");
        require(QqMobileLogin.choicePage(QqMobileLogin.CHOICE_URL), "official choice page missing");
        require(!QqMobileLogin.choicePage(QqMobileLogin.MUSIC_HOME) && !QqMobileLogin.choicePage(QqMobileLogin.CHOICE_URL + "&other=1"), "choice injection cannot follow arbitrary navigation");
        String officialHandoff = "wtloginmqq://ptlogin/qlogin?p=official%20payload";
        require(QqMobileLogin.handoffPackage(officialHandoff).equals("com.tencent.mobileqq"), "current official wtloginmqq scheme was silently rejected");
        require(QqMobileLogin.handoffAllowed("https://xui.ptlogin2.qq.com/cgi-bin/xlogin", officialHandoff), "trusted delayed/iframe handoff must be eligible for native confirmation");
        require(!QqMobileLogin.handoffAllowed("https://evil.test/", officialHandoff), "untrusted source must not open an app");
        require(!QqMobileLogin.handoffAllowed("https://xui.ptlogin2.qq.com.evil.test/", officialHandoff), "lookalike source must not open an app");
        for (String scheme : new String[]{"mqq", "mqqapi", "mqqopensdkapi", "wtloginmqq"}) require(QqMobileLogin.handoffPackage(scheme + "://ptlogin/login").equals("com.tencent.mobileqq"), "QQ handoff package mismatch");
        require(QqMobileLogin.handoffPackage("qqmusic://login").equals("com.tencent.qqmusic"), "music package mismatch");
        require(QqMobileLogin.handoffPackage("weixin://login").equals("com.tencent.mm"), "WeChat package mismatch");
        String intent = "intent://ptlogin/qlogin?p=official#Intent;scheme=wtloginmqq;package=com.tencent.mobileqq;S.browser_fallback_url=https%3A%2F%2Fevil.test;component=evil/.Activity;end";
        require(QqMobileLogin.handoffUrl(intent).equals("wtloginmqq://ptlogin/qlogin?p=official"), "intent must discard arbitrary components/extras/fallback while retaining official payload");
        for (String blocked : new String[]{null, "", "https://evil.test/", "file:///sdcard/a", "javascript:alert(1)", "mqqapi://user:pass@ptlogin/", "intent://x#Intent;scheme=javascript;end", "intent://x#Intent;scheme=mqqapi;package=evil.package;end", "intent://x#Intent;scheme=mqqapi;scheme=wtloginmqq;end", "intent://x#Intent;scheme=mqqapi"}) require(QqMobileLogin.handoffUrl(blocked).isEmpty(), "unsafe native handoff accepted");
        System.out.println("authorizeUrl=" + QqMobileLogin.authorizeUrl());
        System.out.println("accountUrl=" + QqMobileLogin.accountUrl());
        System.out.println("choiceUrl=" + QqMobileLogin.CHOICE_URL);
        System.out.println("choiceScript=" + QqMobileLogin.choiceScript());
        System.out.println("QqMobileLogin: full music callback on both methods, current app schemes, sanitized intents, source and navigation allowlists PASS");
    }
}
