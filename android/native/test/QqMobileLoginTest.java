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
        require(QqMobileLogin.defaultUrl().equals("https://y.qq.com/n/ryqq_v2/profile"), "default must open QQ Music itself, not a copied authorization URL");
        require(new URI(QqMobileLogin.defaultUrl()).getRawQuery() == null, "default must not embed copied app ids or callback parameters");
        require(QqMobileLogin.desktopPage(QqMobileLogin.defaultUrl()), "desktop login entry not recognized");
        require(QqMobileLogin.desktopPage("https://y.qq.com/n/ryqq/profile"), "legacy official profile route must remain recognized");
        require(!QqMobileLogin.desktopPage(QqMobileLogin.defaultUrl()+"?other=1"), "desktop script must be limited to its fixed entry");
        for (String allowed : new String[]{QqMobileLogin.defaultUrl(), QqMobileLogin.CHOICE_URL, "https://graph.qq.com/oauth2.0/authorize", "https://xui.ptlogin2.qq.com/cgi-bin/xlogin", "https://open.weixin.qq.com/connect/oauth2/authorize"}) require(QqMobileLogin.allowed("qq", allowed), "official navigation rejected");
        for (String blocked : new String[]{"http://graph.qq.com/", "file:///android_asset/index.html", "javascript:alert(1)", "intent://anything", "https://graph.qq.com.evil.test/", "https://evil.test/?return=https://y.qq.com/", "https://evil@y.qq.com/", "https://y.qq.com:444/", "https://music.163.com/", "https://passport.bilibili.com/", "https://unrelated.qq.com/"}) require(!QqMobileLogin.allowed("qq", blocked), "unsafe/cross-platform navigation allowed: " + blocked);
        require(!QqMobileLogin.allowed("netease", QqMobileLogin.defaultUrl()) && !QqMobileLogin.allowed("bilibili", QqMobileLogin.defaultUrl()), "QQ helper must not govern other platforms");
        require(QqMobileLogin.choicePage(QqMobileLogin.CHOICE_URL), "official choice page missing");
        require(!QqMobileLogin.choicePage(QqMobileLogin.MUSIC_HOME) && !QqMobileLogin.choicePage(QqMobileLogin.CHOICE_URL + "&other=1"), "choice injection cannot follow arbitrary navigation");
        System.out.println("defaultUrl=" + QqMobileLogin.defaultUrl());
        System.out.println("desktopScript=" + QqMobileLogin.desktopScript());
        System.out.println("choiceUrl=" + QqMobileLogin.CHOICE_URL);
        System.out.println("choiceScript=" + QqMobileLogin.choiceScript());
        System.out.println("QqMobileLogin: official website entry, navigation allowlist and platform scope PASS");
    }
}
