package local.mixtunes.mobile;

final class BackgroundImages {
    // Canvas-normalized JPEGs only. Never permit a data: main-frame navigation,
    // scripts, SVG, arbitrary local paths or resources from remote WebViews.
    static boolean allowResource(String url, boolean mainFrame, boolean trusted) {
        return trusted && !mainFrame && url != null && url.length() <= 5600000
            && url.startsWith("data:image/jpeg;base64,/9j/")
            && url.matches("data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}");
    }
}
