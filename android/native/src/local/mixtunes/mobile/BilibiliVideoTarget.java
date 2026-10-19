package local.mixtunes.mobile;

import java.net.URI;
import java.net.URLDecoder;

// Keep the requested video/part fixed while accepting the site's canonical
// trailing slash and tracking-only redirects. No remote page receives a bridge.
final class BilibiliVideoTarget {
    static String canonicalUrl(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"www.bilibili.com".equalsIgnoreCase(uri.getHost())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443)
                throw new IllegalArgumentException();
            String path = uri.getPath();
            if (path == null || !path.matches("/video/(BV[a-zA-Z0-9]{10}|av[0-9]{1,20})/?"))
                throw new IllegalArgumentException();
            int page = 1;
            boolean foundPage = false;
            String query = uri.getRawQuery();
            if (query != null) for (String field : query.split("&")) {
                String[] pair = field.split("=", 2);
                if (!"p".equals(URLDecoder.decode(pair[0], "UTF-8"))) continue;
                if (foundPage || pair.length != 2) throw new IllegalArgumentException();
                String number = URLDecoder.decode(pair[1], "UTF-8");
                if (!number.matches("[0-9]{1,5}")) throw new IllegalArgumentException();
                page = Integer.parseInt(number);
                if (page < 1 || page > 10000) throw new IllegalArgumentException();
                foundPage = true;
            }
            return "https://www.bilibili.com" + path.replaceAll("/$", "") + "/" + (page == 1 ? "" : "?p=" + page);
        } catch (Exception invalid) {
            throw new IllegalArgumentException("Bilibili 视频或分 P 地址无效");
        }
    }
    static boolean sameVideo(String expected, String candidate) {
        try { return canonicalUrl(expected).equals(canonicalUrl(candidate)); }
        catch (IllegalArgumentException invalid) { return false; }
    }
}
