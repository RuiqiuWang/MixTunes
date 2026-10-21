package local.mixtunes.mobile;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import org.json.JSONObject;

final class MobileLogin {
    static String appPackage(String platform){switch(platform){case "qq":return "com.tencent.qqmusic";case "netease":return "com.netease.cloudmusic";case "bilibili":return "tv.danmaku.bili";default:throw new IllegalArgumentException("不支持的平台");}}
    static boolean installed(MainActivity activity,String name){try{activity.getPackageManager().getPackageInfo(name,0);return true;}catch(PackageManager.NameNotFoundException absent){return false;}}
    static JSONObject open(MainActivity activity,String platform){
        boolean present=installed(activity,appPackage(platform));
        // Installed application != permission to obtain its private session.
        // MixTunes has no registered official OAuth app/SDK identity. Only a
        // handoff offered by the official mobile login page may authorize it.
        activity.official.login(platform);
        return Json.object("opened",true,"method","web","appInstalled",present,"oneClickAvailable",false,"reason",platform.equals("qq")?"registration-required":"no-configured-official-app-authorization","message","已打开官方手机登录页");
    }
    static boolean handoff(MainActivity activity,String platform,String target){
        // QQ Music website authorization in another app has no callback into
        // this package. Do not strand a successful login in an external jar.
        if(platform.equals("qq"))return false;
        try{
            Uri uri=Uri.parse(target);String scheme=uri.getScheme(),pkg=null;
            if("weixin".equals(scheme))pkg="com.tencent.mm";
            else if(platform.equals("netease")&&"orpheus".equals(scheme))pkg="com.netease.cloudmusic";
            else if(platform.equals("bilibili")&&"bilibili".equals(scheme))pkg="tv.danmaku.bili";
            if(pkg==null||pkg.isEmpty()||!installed(activity,pkg))return false;
            Intent intent=new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(pkg);if(intent.resolveActivity(activity.getPackageManager())==null)return false;
            activity.startActivity(intent);return true;
        }catch(Exception unavailable){return false;}
    }
}
