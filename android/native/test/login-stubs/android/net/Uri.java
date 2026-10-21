package android.net;
public final class Uri {
    private final java.net.URI value;
    private Uri(String text) { value=java.net.URI.create(text); }
    public static Uri parse(String text) { return new Uri(text); }
    public String getScheme() { return value.getScheme(); }
}
