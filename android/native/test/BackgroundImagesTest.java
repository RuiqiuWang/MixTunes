package local.mixtunes.mobile;

public final class BackgroundImagesTest {
    private static void check(boolean value) { if (!value) throw new AssertionError("Background resource policy"); }
    public static void main(String[] args) {
        String jpeg = "data:image/jpeg;base64,/9j/AAAA";
        check(BackgroundImages.allowResource(jpeg, false, true));
        check(!BackgroundImages.allowResource(jpeg, true, true));
        check(!BackgroundImages.allowResource(jpeg, false, false));
        for (String value : new String[]{null, "data:image/svg+xml;base64,PHN2Zy8+", "data:text/html;base64,AAAA", "javascript:alert(1)", "file:///private/image.jpg", "https://outside.test/image.jpg", "data:image/jpeg;base64,AAAA", jpeg + "<script>", jpeg + "%20"}) check(!BackgroundImages.allowResource(value, false, true));
        StringBuilder oversized = new StringBuilder(jpeg); while (oversized.length() <= 5600000) oversized.append('A');
        check(!BackgroundImages.allowResource(oversized.toString(), false, true));
        System.out.println("BackgroundImages: trusted JPEG subresources only, main-frame/SVG/file/untrusted/oversize blocked PASS");
    }
}
