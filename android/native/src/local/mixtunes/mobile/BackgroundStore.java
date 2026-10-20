package local.mixtunes.mobile;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

// Separate from the playlist store and never exported with a library backup.
final class BackgroundStore {
    private final AtomicFile file;
    BackgroundStore(Context context) { file = new AtomicFile(new File(context.getFilesDir(), "custom-background.json")); }
    private JSONObject validate(JSONObject value) throws Exception {
        if (value.getInt("version") != 1) throw new IllegalArgumentException("背景版本无效");
        String image = value.getString("image");
        if (!image.startsWith("data:image/jpeg;base64,") || image.length() > 5600000) throw new IllegalArgumentException("背景图片格式或大小无效");
        byte[] bytes = Base64.decode(image.substring(23), Base64.DEFAULT);
        if (bytes.length > 4 * 1024 * 1024 || bytes.length < 4 || (bytes[0] & 255) != 255 || (bytes[1] & 255) != 216) throw new IllegalArgumentException("背景图片格式无效");
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0 || options.outWidth > 2560 || options.outHeight > 2560) throw new IllegalArgumentException("背景图片尺寸无效");
        JSONObject crop = value.optJSONObject("crop"); if (crop == null) crop = new JSONObject();
        return Json.object("version", 1, "image", image, "crop", Json.object("x", number(crop, "x", .5, 0, 1), "y", number(crop, "y", .5, 0, 1), "zoom", number(crop, "zoom", 1, 1, 4)));
    }
    private double number(JSONObject value, String key, double fallback, double min, double max) {
        double n = value.optDouble(key, fallback); if (Double.isNaN(n) || Double.isInfinite(n)) n = fallback;
        return Math.max(min, Math.min(max, n));
    }
    Object load() throws Exception {
        try (java.io.InputStream input = file.openRead()) {
            return validate(new JSONObject(new String(NativeNetwork.read(input, 6 * 1024 * 1024), StandardCharsets.UTF_8)));
        } catch (java.io.FileNotFoundException missing) { return JSONObject.NULL; }
    }
    JSONObject save(JSONObject value) throws Exception {
        JSONObject safe = validate(value); byte[] bytes = safe.toString().getBytes(StandardCharsets.UTF_8);
        FileOutputStream output = null;
        try { output = file.startWrite(); output.write(bytes); file.finishWrite(output); }
        catch (Exception error) { if (output != null) file.failWrite(output); throw error; }
        return safe;
    }
    boolean delete() throws Exception {
        file.delete();
        if (file.getBaseFile().exists()) throw new IllegalStateException("无法删除保存的背景");
        return true;
    }
}
