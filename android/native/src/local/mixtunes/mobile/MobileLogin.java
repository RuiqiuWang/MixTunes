package local.mixtunes.mobile;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import org.json.JSONObject;

final class MobileLogin {
    static boolean installed(MainActivity activity,String name){try{activity.getPackageManager().getPackageInfo(name,0);return true;}catch(PackageManager.NameNotFoundException absent){return false;}}
    static JSONObject open(MainActivity activity,String platform){
        activity.official.login(platform);
        return Json.object("opened",true,"method","web","message",platform.equals("qq")?"已打开 QQ 音乐官方网页登录页，请使用网页内的登录方式":"已打开官方网页登录页");
    }
    static boolean handoff(MainActivity activity,String platform,String target){
        if(platform.equals("qq"))return false; // QQ has one official web-login path.
        try{
            Uri uri=Uri.parse(target);String scheme=uri.getScheme(),pkg=null;
            if("weixin".equals(scheme))pkg="com.tencent.mm";
            else if(platform.equals("netease")&&"orpheus".equals(scheme))pkg="com.netease.cloudmusic";
            else if(platform.equals("bilibili")&&"bilibili".equals(scheme))pkg="tv.danmaku.bili";
            if(pkg==null||!installed(activity,pkg))return false;
            Intent intent=new Intent(Intent.ACTION_VIEW,uri).setPackage(pkg);if(intent.resolveActivity(activity.getPackageManager())==null)return false;
            activity.startActivity(intent);return true;
        }catch(Exception unavailable){return false;}
    }
}
