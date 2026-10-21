package android.content;
import android.net.Uri;
import android.content.pm.PackageManager;
public final class Intent {
    public static final String ACTION_VIEW="view", CATEGORY_BROWSABLE="browsable";
    public String pkg;
    public Intent(String action, Uri uri) { }
    public Intent setPackage(String value) { pkg=value; return this; }
    public Intent addCategory(String value) { return this; }
    public Object resolveActivity(PackageManager manager) { return new Object(); }
}
