package local.mixtunes.mobile;

public final class BilibiliVideoTargetTest {
    private static final String VIDEO = "https://www.bilibili.com/video/BV1xx411c7mD";
    private static void check(boolean value, String label) { if (!value) throw new AssertionError(label); }
    public static void main(String[] args) {
        check((VIDEO + "/").equals(BilibiliVideoTarget.canonicalUrl(VIDEO)), "provider URL needs canonical slash");
        check((VIDEO + "/?p=2").equals(BilibiliVideoTarget.canonicalUrl(VIDEO + "?p=2")), "keep requested part");
        check(BilibiliVideoTarget.sameVideo(VIDEO, VIDEO + "/"), "allow canonical redirect");
        check(BilibiliVideoTarget.sameVideo(VIDEO, VIDEO + "/?p=1&spm_id_from=333.788"), "allow tracking and explicit first part");
        check(BilibiliVideoTarget.sameVideo(VIDEO + "?p=2", VIDEO + "/?spm_id_from=333.788&p=2"), "allow tracking on requested part");
        for (String rejected : new String[]{
                VIDEO + "/?p=2", "https://www.bilibili.com/video/BV1gL411G7Bk/",
                "https://www.bilibili.com.evil.test/video/BV1xx411c7mD/", "http://www.bilibili.com/video/BV1xx411c7mD/",
                "https://user@www.bilibili.com/video/BV1xx411c7mD/", "https://www.bilibili.com:8443/video/BV1xx411c7mD/",
                VIDEO + "/?p=1&p=2", VIDEO + "/?p=0", VIDEO + "/?p=10001", VIDEO + "/?p=invalid",
                "https://www.bilibili.com/account/", "javascript:alert(1)", "intent://video", "not a URL"}) {
            check(!BilibiliVideoTarget.sameVideo(VIDEO, rejected), "reject navigation: " + rejected);
        }
        check(!BilibiliVideoTarget.sameVideo(VIDEO + "?p=2", VIDEO + "/"), "cannot silently reset part");
        System.out.println("BilibiliVideoTarget: 20 checks passed");
    }
}
