package local.mixtunes.mobile;

import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.LinkOption;
import java.nio.file.attribute.BasicFileAttributes;

/** Device-private library and previous-generation backup. Never recover implicitly. */
final class LibraryStorage {
    private final File directory, primary, backup;
    private boolean locked;
    LibraryStorage(File root) { directory=root;primary=new File(root,"library.json");backup=new File(root,"library.backup.json"); }
    private String read(File file) throws Exception {
        return new String(NativeNetwork.read(new AtomicFile(file).openRead(),NativeNetwork.MAX_BODY),StandardCharsets.UTF_8);
    }
    private boolean missing(File file) throws Exception {
        for(String suffix:new String[]{"",".bak",".new"}){
            try{Files.readAttributes(new File(file.getPath()+suffix).toPath(),BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);return false;}
            catch(NoSuchFileException absent){} // Permission and I/O errors must propagate.
        }
        return true;
    }
    private void validate(String text) throws Exception {
        if(text==null||text.getBytes(StandardCharsets.UTF_8).length>NativeNetwork.MAX_BODY)throw new IllegalArgumentException("歌单文件过大或为空");
        JSONObject value=new JSONObject(text);
        if(value.has("schemaVersion")){Object version=value.get("schemaVersion");if(!(version instanceof Number)||(((Number)version).doubleValue()!=1&&((Number)version).doubleValue()!=2))throw new IllegalArgumentException("不支持的歌单版本");}
        for(String name:new String[]{"tracks","playlists","queue"})if(value.has(name)&&!(value.get(name) instanceof JSONArray))throw new IllegalArgumentException("歌单结构无效："+name);
        JSONArray playlists=value.optJSONArray("playlists");
        if(playlists!=null)for(int i=0;i<playlists.length();i++){JSONObject p=playlists.optJSONObject(i);if(p==null||(p.has("queue")&&!(p.get("queue") instanceof JSONArray)))throw new IllegalArgumentException("歌单条目无效");}
    }
    private void write(File target,String text) throws Exception {
        AtomicFile file=new AtomicFile(target);FileOutputStream output=null;
        try{output=file.startWrite();output.write(text.getBytes(StandardCharsets.UTF_8));file.finishWrite(output);}
        catch(Exception error){if(output!=null)file.failWrite(output);throw error;}
    }
    synchronized JSONObject load() throws Exception {
        String json=null,copy=null;
        try{json=read(primary);try{validate(json);}catch(Exception bad){locked=true;}}
        catch(FileNotFoundException absent){if(!missing(primary)){locked=true;throw absent;}}
        catch(Exception error){locked=true;throw error;}
        try{copy=read(backup);validate(copy);}catch(Exception ignored){copy=null;}
        if(json==null&&!missing(backup))locked=true;
        return Json.object("json",json,"backup",copy,"readError",locked);
    }
    synchronized void save(String text) throws Exception {
        if(locked)throw new IllegalStateException("歌单读取异常，已禁止保存，请先恢复备份");
        validate(text);String previous=null;
        try{previous=read(primary);validate(previous);}
        catch(FileNotFoundException absent){if(!missing(primary)){locked=true;throw absent;}}
        catch(Exception error){locked=true;throw error;}
        write(backup,previous==null?text:previous);write(primary,text);
    }
    synchronized void restore(String text) throws Exception {
        validate(text);String original=null;
        try{original=read(primary);}catch(FileNotFoundException absent){if(!missing(primary))throw absent;}
        if(original!=null)write(new File(directory,"library.before-restore-"+System.currentTimeMillis()+"-"+System.nanoTime()+".json"),original);
        write(primary,text);locked=false;
    }
}
