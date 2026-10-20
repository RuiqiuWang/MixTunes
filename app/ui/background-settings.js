'use strict';
((root) => {
  const policy = root.mixTunesBackgroundImage;
  function mount({ controller, api, status, legacy, onEditor = () => {} }) {
    if (!api?.background || !policy) return null;
    legacy.closest('label').style.display = 'none';
    const panel = document.createElement('section'); panel.className = 'background-settings';
    panel.innerHTML = '<label for="background-mode">背景模式</label><select id="background-mode"><option value="theme">默认主题背景</option><option value="current-cover">当前播放封面</option><option value="custom">自定义本地图片</option></select><div class="background-actions"><button type="button" id="background-pick">选择图片</button><button type="button" id="background-recrop">调整裁剪</button><button type="button" id="background-delete">删除自定义图片</button></div><label for="background-opacity">背景图片不透明度 <output id="background-opacity-value"></output></label><input id="background-opacity" type="range" min="0" max="100" step="1"><label for="background-blur">背景模糊度 <output id="background-blur-value"></output></label><input id="background-blur" type="range" min="0" max="40" step="1"><label for="background-mask">背景遮罩强度 <output id="background-mask-value"></output></label><input id="background-mask" type="range" min="0" max="100" step="1" aria-describedby="background-mask-hint"><p id="background-mask-hint" class="background-hint">0% 无遮罩，100% 完全遮挡图片；浅色、深色主题分别保存。降低遮罩可能影响文字可读性。</p><p class="background-hint">图片只保存在本机，不随歌单导出。支持 JPEG、PNG、静态 WebP，最大 12 MB / 2400 万像素。</p>';
    status.before(panel);
    const advanced=document.createElement('details');advanced.id='background-advanced';
    const summary=document.createElement('summary');summary.textContent='背景效果';advanced.appendChild(summary);
    const effects=document.createElement('div');effects.className='background-effects';advanced.appendChild(effects);
    let effectNode=panel.querySelector('label[for="background-opacity"]');
    while(effectNode){const next=effectNode.nextSibling;effects.appendChild(effectNode);effectNode=next;}
    panel.appendChild(advanced);
    const dialog = document.createElement('dialog'); dialog.id = 'background-crop-dialog'; dialog.className = 'background-crop-dialog';
    dialog.setAttribute('aria-labelledby', 'background-crop-title');
    dialog.innerHTML = '<h2 id="background-crop-title">调整背景构图</h2><p>拖动图片调整位置；用滑块、鼠标滚轮或双指缩放。方向键也可移动图片。</p><div id="background-crop-stage" class="background-crop-stage" tabindex="0" role="group" aria-label="图片裁剪区域，方向键移动图片"><img draggable="false" alt="待裁剪的本地图片"><div class="background-crop-mask"></div></div><label for="background-zoom">缩放 <output id="background-zoom-value"></output></label><input id="background-zoom" type="range" min="1" max="4" step="0.01"><label class="background-effect-option"><input id="background-effect" type="checkbox">预览背景效果（含可读性遮罩）</label><p id="background-crop-status" role="status"></p><div class="background-crop-buttons"><button type="button" id="background-cancel">取消</button><button type="button" id="background-reset">重置裁剪</button><button type="button" id="background-confirm" class="primary">确认使用</button></div>';
    document.body.appendChild(dialog);
    const $ = id => document.getElementById(id), mode = $('background-mode'), opacity = $('background-opacity'), blur = $('background-blur'), mask = $('background-mask');
    const stage = $('background-crop-stage'), image = stage.querySelector('img'), zoom = $('background-zoom');
    let saved = null, draft = null, busy = true, editing = false, saving = false, operation = 0;
    const pointers = new Map(); let pinch = null;
    const message = text => { status.textContent = text; };
    let persistTimer = null;
    function persistEffects() {
      clearTimeout(persistTimer); persistTimer = null;
      const opacitySaved = controller.setOpacity(opacity.value);
      const blurSaved = controller.setBlur(blur.value);
      if (opacitySaved === false || blurSaved === false) message('背景效果仅本次生效，当前环境无法保存设置。');
    }
    function schedulePersist() { clearTimeout(persistTimer); persistTimer = setTimeout(persistEffects, 250); }
    async function call(action, value) { const result = await api.background(action, value); if (result?.ok === false) throw Error(result.error || '背景操作失败'); return result; }
    function paintRange(input) {
      const min = Number(input.min) || 0, max = Number(input.max) || 100, value = Number(input.value) || 0;
      const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--range-progress', percent.toFixed(2) + '%');
    }
    function sync() {
      mode.value = controller.mode(); legacy.checked = controller.enabled();
      opacity.value = controller.opacity(); $('background-opacity-value').textContent = opacity.value + '%';
      blur.value = controller.blur(); $('background-blur-value').textContent = blur.value + 'px';
      mask.value = controller.mask(); $('background-mask-value').textContent = mask.value + '%';
      paintRange(opacity); paintRange(blur); paintRange(mask);
      opacity.disabled = mode.value === 'theme';
      blur.disabled = mode.value === 'theme';
      mask.disabled = mode.value === 'theme';
      $('background-recrop').disabled = busy || !saved;
      $('background-delete').disabled = busy || !saved;
      $('background-pick').disabled = busy;
      $('background-pick').textContent = saved ? '更换图片' : '选择图片';
      mode.disabled = busy;
    }
    function paint() {
      if (!draft || !image.naturalWidth) return;
      const aspect = innerWidth / innerHeight;
      stage.style.width = Math.max(80, Math.min(dialog.clientWidth - 48, innerHeight * .44 * aspect)) + 'px';
      stage.style.aspectRatio = String(aspect);
      const rect = policy.layout(image.naturalWidth, image.naturalHeight, stage.clientWidth, stage.clientHeight, draft.crop);
      for (const name of ['left', 'top', 'width', 'height']) image.style[name] = rect[name] + 'px';
      zoom.value = draft.crop.zoom; $('background-zoom-value').textContent = Number(zoom.value).toFixed(2) + '×';
      stage.classList.toggle('preview-background-effect', $('background-effect').checked);
      stage.style.setProperty('--preview-opacity', String(controller.opacity() / 100));
      const previewBlur = controller.blurFor('custom');
      const previewSize = Math.min(stage.clientWidth, stage.clientHeight) || 1200;
      stage.style.setProperty('--preview-blur', previewBlur + 'px');
      stage.style.setProperty('--preview-blur-scale', String(Number((previewBlur > 0 ? Math.min(.25, (previewBlur * 2.5) / previewSize) : 0).toFixed(4))));
    }
    function close() {
      if (saving) return;
      operation++; editing = false; draft = null; pointers.clear(); pinch = null;
      image.removeAttribute('src'); dialog.close();
      onEditor(false);
    }
    async function edit(value) {
      if (editing) return;
      const request = ++operation;
      draft = { ...value, crop: policy.crop(value.crop) }; editing = true;
      $('background-crop-status').textContent = ''; $('background-effect').checked = false;
      try { image.src = value.image; await image.decode(); }
      catch { if (request !== operation) return; editing = false; draft = null; image.removeAttribute('src'); throw Error('已保存图片无法解码，请重新选择图片'); }
      if (request !== operation || !draft) return;
      onEditor(true); dialog.showModal(); paint(); stage.focus();
    }
    async function normalize(data) {
      if (typeof data !== 'string' || data.length > 17 * 1024 * 1024 || !/^data:image\/(jpeg|png|webp);base64,[a-z\d+/]+=*$/i.test(data)) throw Error('图片格式无效');
      const raw = atob(data.split(',')[1]), bytes = new Uint8Array(raw.length);
      for (let offset = 0; offset < raw.length; offset += 262144) {
        const end = Math.min(raw.length, offset + 262144);
        for (let i = offset; i < end; i++) bytes[i] = raw.charCodeAt(i);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const info = policy.inspect(bytes);
      let bitmap;
      try { bitmap = await createImageBitmap(new Blob([bytes], { type: info.mime }), { imageOrientation: 'from-image' }); }
      catch { throw Error('无法解码图片，文件可能已损坏'); }
      try {
        const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
        canvas.width = canvas.height = 1;
        if (!blob || blob.size > policy.MAX_SAVED) throw Error('处理后的图片仍大于 4 MB，请使用较小图片');
        return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('无法处理图片')); reader.readAsDataURL(blob); });
      } finally { bitmap.close(); }
    }
    mode.addEventListener('change', () => { const persisted = controller.setMode(mode.value); sync(); message(persisted === false ? '背景模式仅本次生效，当前环境无法保存设置。' : mode.value === 'custom' && !saved ? '尚未选择图片，请选择本地背景。' : '背景模式已保存。'); });
    opacity.addEventListener('input', () => { controller.setOpacity(opacity.value, { persist: false }); $('background-opacity-value').textContent = opacity.value + '%'; paintRange(opacity); schedulePersist(); });
    blur.addEventListener('input', () => { controller.setBlur(blur.value, { persist: false }); $('background-blur-value').textContent = blur.value + 'px'; paintRange(blur); schedulePersist(); });
    for (const input of [opacity, blur]) { input.addEventListener('change', persistEffects); input.addEventListener('blur', persistEffects); }
    mask.addEventListener('input', () => {
      const persisted = controller.setMask(mask.value);
      $('background-mask-value').textContent = mask.value + '%'; paintRange(mask); paint();
      message(persisted === false ? '背景遮罩仅本次生效，当前环境无法保存设置。' : '背景遮罩已保存；降低遮罩可能影响文字可读性。');
    });
    // Both clients apply their theme through this attribute. CSS and the crop
    // preview share the same per-theme variables, including while the editor is open.
    const themeObserver = new MutationObserver(() => { sync(); paint(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    legacy.addEventListener('change', sync);
    $('background-pick').addEventListener('click', async () => {
      if (busy) return; busy = true; sync(); const request = ++operation;
      try {
        message('请选择图片；不会上传到服务器。');
        const result = await call('pick');
        if (!result || result.canceled) { message('已取消，原背景保持不变。'); return; }
        message('正在处理图片…');
        const normalized = await normalize(result.image);
        if (request !== operation) return;
        await edit({ version: 1, image: normalized, crop: policy.crop() });
        message('确认裁剪后才会替换原背景。');
      } catch (error) { message(error.message); editing = false; draft = null; image.removeAttribute('src'); }
      finally { busy = false; sync(); }
    });
    $('background-recrop').addEventListener('click', () => edit(saved).catch(error => message(error.message)));
    $('background-delete').addEventListener('click', async () => {
      if (busy || !saved) return;
      if (!root.confirm('删除此设备保存的自定义背景？原始图片不会被删除。')) return;
      busy = true; sync();
      try { await call('delete'); saved = null; controller.setCustom(null); controller.setMode('theme'); message('自定义背景已删除，已恢复主题。'); }
      catch (error) { message('删除失败，原背景保持不变：' + error.message); }
      finally { busy = false; sync(); }
    });
    $('background-cancel').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    $('background-reset').onclick = () => { draft.crop = policy.crop(); paint(); };
    zoom.oninput = () => { if (draft) { draft.crop.zoom = Number(zoom.value); paint(); } };
    $('background-effect').onchange = paint;
    $('background-confirm').onclick = async () => {
      if (!draft || saving) return; saving = true;
      for (const button of dialog.querySelectorAll('button,input')) button.disabled = true;
      const value = { ...draft, crop: { ...draft.crop } };
      try {
        $('background-crop-status').textContent = '正在保存…';
        const result = await call('save', value); saved = policy.validate(result);
        controller.setCustom(saved); const persisted = controller.setMode('custom');
        message(persisted === false ? '图片副本已保存，但背景模式仅本次生效，当前环境无法保存设置。' : '自定义背景已保存，仅在此设备使用。'); saving = false; close(); sync();
      } catch (error) { $('background-crop-status').textContent = '保存失败，原背景未更改：' + error.message; }
      finally { saving = false; for (const button of dialog.querySelectorAll('button,input')) button.disabled = false; }
    };
    function distance() { const values = [...pointers.values()]; return values.length === 2 ? Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y) : null; }
    stage.onpointerdown = event => { if (saving) return; stage.setPointerCapture(event.pointerId); pointers.set(event.pointerId,{ x:event.clientX,y:event.clientY }); pinch = distance(); };
    stage.onpointermove = event => {
      if (!draft || saving || !pointers.has(event.pointerId)) return;
      const before = pointers.get(event.pointerId); pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if (pointers.size === 2) { const next = distance(); if (pinch > 0) draft.crop.zoom = Math.max(1,Math.min(4,draft.crop.zoom*next/pinch)); pinch = next; }
      else {
        const rect = policy.layout(image.naturalWidth,image.naturalHeight,stage.clientWidth,stage.clientHeight,draft.crop);
        draft.crop.x = (stage.clientWidth/2-rect.left-(event.clientX-before.x))/rect.width;
        draft.crop.y = (stage.clientHeight/2-rect.top-(event.clientY-before.y))/rect.height;
        draft.crop = policy.crop(draft.crop);
      }
      paint();
    };
    stage.onpointerup = stage.onpointercancel = event => { pointers.delete(event.pointerId); pinch = distance(); };
    stage.addEventListener('wheel', event => { if (!draft || saving) return; event.preventDefault(); draft.crop.zoom=Math.max(1,Math.min(4,draft.crop.zoom-event.deltaY*.002)); paint(); }, {passive:false});
    stage.onkeydown = event => { const delta = { ArrowLeft:[.02,0],ArrowRight:[-.02,0],ArrowUp:[0,.02],ArrowDown:[0,-.02] }[event.key]; if (!delta || !draft || saving) return; event.preventDefault(); draft.crop=policy.crop({...draft.crop,x:draft.crop.x+delta[0],y:draft.crop.y+delta[1]}); paint(); };
    root.addEventListener('resize', paint);
    const ready = (async () => {
      try { const value = await call('load'); if (value) { saved = policy.validate(value); controller.setCustom(saved); } else if (controller.mode() === 'custom') controller.setMode('theme'); }
      catch (error) { if (controller.mode() === 'custom') controller.setMode('theme'); message('无法恢复自定义背景：' + error.message); }
      finally { busy = false; sync(); }
    })();
    document.getElementById('cover-background').addEventListener('background-failed', () => { sync(); message('自定义图片无法显示，已恢复默认主题。可更换或删除已保存图片。'); });
    sync();
    return { ready, back() { if (!editing) return false; close(); return true; } };
  }
  root.mixTunesBackgroundSettings = { mount };
})(globalThis);
