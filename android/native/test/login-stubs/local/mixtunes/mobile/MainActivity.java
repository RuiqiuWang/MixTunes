package local.mixtunes.mobile;
import android.content.Intent;
import android.content.pm.PackageManager;
final class MainActivity {
    final Official official=new Official(); int starts; String lastPackage;
    PackageManager getPackageManager() { return new PackageManager(); }
    void startActivity(Intent intent) { starts++;lastPackage=intent.pkg; }
    static final class Official { String platform;void login(String value) { platform=value; } }
}
final class Json {
    static org.json.JSONObject object(Object... values) { return new org.json.JSONObject(); }
}
