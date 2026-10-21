package local.mixtunes.mobile;
public final class MobileLoginTest {
    static void require(boolean value,String message) { if(!value)throw new AssertionError(message); }
    public static void main(String[] args) {
        MainActivity activity=new MainActivity();
        MobileLogin.open(activity,"qq");
        require("qq".equals(activity.official.platform)&&activity.starts==0,"login must enter the application-owned web session even if QQ Music is installed");
        for(String url:new String[]{"wtloginmqq://ptlogin/qlogin?p=test","mqqapi://login","qqmusic://login","weixin://login","intent://ptlogin/qlogin#Intent;scheme=wtloginmqq;end"}) {
            require(!MobileLogin.handoff(activity,"qq",url),"external authorization has no MixTunes callback and must not strand the session: "+url);
        }
        require(activity.starts==0,"QQ login opened an external cookie jar");
        require(MobileLogin.handoff(activity,"netease","orpheus://login"),"NetEase handoff changed");
        require("com.netease.cloudmusic".equals(activity.lastPackage),"NetEase package changed");
        require(MobileLogin.handoff(activity,"bilibili","bilibili://login"),"Bilibili handoff changed");
        require("tv.danmaku.bili".equals(activity.lastPackage),"Bilibili package changed");
        System.out.println("MobileLogin: app-owned login, no unregistered external QQ handoff, other platforms retained PASS");
    }
}
