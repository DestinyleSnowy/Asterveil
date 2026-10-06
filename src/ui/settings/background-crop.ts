import type { Scope } from '../../core/scope';
import {
  type CropHit,
  type CropPoint,
  type CropRect,
  centeredCrop,
  cropBetween,
  hitCrop,
  moveCrop,
  resizeCrop,
} from '../../shared/image-crop';

export function chooseBackgroundCrop(
  root: ParentNode,
  scope: Scope,
  bitmap: ImageBitmap,
): Promise<CropRect | null> {
  if (scope.signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'background-crop-dialog';
    dialog.setAttribute('aria-labelledby', 'background-crop-title');
    dialog.innerHTML = `<h2 id="background-crop-title">裁剪背景图片</h2>
      <div class="background-crop-toolbar"><div class="background-segments" data-crop="ratio" role="group" aria-label="裁剪比例">
        <label><input type="radio" name="crop-ratio" value="screen" checked /><span>当前屏幕</span></label>
        <label><input type="radio" name="crop-ratio" value="free" /><span>自由</span></label>
        <label><input type="radio" name="crop-ratio" value="wide" /><span>16 : 9</span></label>
        <label><input type="radio" name="crop-ratio" value="square" /><span>1 : 1</span></label>
      </div><button type="button" data-crop="reset">重置选区</button></div>
      <div class="background-crop-stage"><canvas tabindex="0" aria-label="图片裁剪选区" title="拖动边框缩放，框内移动，框外重新框选。方向键微调，Shift 加方向键缩放。"></canvas></div>
      <p class="background-crop-size" data-crop="size" role="status"></p>
      <div class="background-crop-actions"><button type="button" data-crop="cancel">取消</button><button type="button" data-crop="apply">应用选区</button></div>`;
    const canvas = dialog.querySelector('canvas');
    const ratios = dialog.querySelector('[data-crop="ratio"]');
    const size = dialog.querySelector('[data-crop="size"]');
    const apply = dialog.querySelector<HTMLButtonElement>('[data-crop="apply"]');
    if (!canvas || !ratios || !size || !apply) throw new Error('裁剪界面初始化失败。');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法显示裁剪预览。');
    const scale = Math.min(1, 1000 / bitmap.width, 600 / bitmap.height);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    let ratio = window.innerWidth / window.innerHeight;
    let crop = centeredCrop(bitmap.width, bitmap.height, ratio);
    let drag: { id: number; start: CropPoint; original: CropRect; hit: CropHit } | undefined;
    const cursors: Record<CropHit, string> = {
      n: 'ns-resize',
      s: 'ns-resize',
      e: 'ew-resize',
      w: 'ew-resize',
      nw: 'nwse-resize',
      se: 'nwse-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      move: 'grab',
      new: 'crosshair',
    };
    const events = new AbortController();
    let finished = false;
    function finish(result: CropRect | null) {
      if (finished) return;
      finished = true;
      events.abort();
      scope.signal.removeEventListener('abort', cancel);
      dialog.close();
      dialog.remove();
      resolve(result);
    }
    const cancel = () => finish(null);
    scope.signal.addEventListener('abort', cancel, { once: true });
    function draw() {
      if (!context || !canvas || !size || !apply) return;
      const sx = canvas.width / bitmap.width;
      const sy = canvas.height / bitmap.height;
      const x = crop.x * sx,
        y = crop.y * sy,
        w = crop.width * sx,
        h = crop.height * sy;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      context.fillStyle = '#0009';
      context.beginPath();
      context.rect(0, 0, canvas.width, canvas.height);
      context.rect(x, y, w, h);
      context.fill('evenodd');
      context.strokeStyle = '#fff';
      context.lineWidth = 2;
      context.strokeRect(x, y, w, h);
      context.fillStyle = '#fff';
      for (const cx of [x, x + w])
        for (const cy of [y, y + h]) context.fillRect(cx - 4, cy - 4, 8, 8);
      for (const cx of [x, x + w]) context.fillRect(cx - 3, y + h / 2 - 12, 6, 24);
      for (const cy of [y, y + h]) context.fillRect(x + w / 2 - 12, cy - 3, 24, 6);
      size.textContent = `${Math.round(crop.width)} × ${Math.round(crop.height)} 像素`;
      apply.disabled = crop.width < 1 || crop.height < 1;
    }
    function point(event: PointerEvent): CropPoint {
      if (!canvas) throw new Error('裁剪画布不可用。');
      const bounds = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - bounds.left) / bounds.width) * bitmap.width,
        y: ((event.clientY - bounds.top) / bounds.height) * bitmap.height,
      };
    }
    function hit(point: CropPoint) {
      if (!canvas) return 'new';
      return hitCrop(crop, point, (10 * bitmap.width) / canvas.getBoundingClientRect().width);
    }
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        canvas.focus();
        const p = point(event);
        drag = {
          id: event.pointerId,
          start: p,
          original: crop,
          hit: hit(p),
        };
        canvas.style.cursor = drag.hit === 'move' ? 'grabbing' : cursors[drag.hit];
        canvas.setPointerCapture(event.pointerId);
      },
      { signal: events.signal },
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        const p = point(event);
        if (!drag) {
          canvas.style.cursor = cursors[hit(p)];
          return;
        }
        if (drag.id !== event.pointerId) return;
        crop =
          drag.hit === 'new'
            ? cropBetween(drag.start, p, bitmap.width, bitmap.height, ratio)
            : drag.hit === 'move'
              ? moveCrop(
                  drag.original,
                  p.x - drag.start.x,
                  p.y - drag.start.y,
                  bitmap.width,
                  bitmap.height,
                )
              : resizeCrop(drag.original, drag.hit, p, bitmap.width, bitmap.height, ratio);
        draw();
      },
      { signal: events.signal },
    );
    const endDrag = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      if (event.type === 'pointercancel' || crop.width < 1 || crop.height < 1) crop = drag.original;
      drag = undefined;
      canvas.style.cursor = cursors[hit(point(event))];
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      draw();
    };
    canvas.addEventListener('pointerup', endDrag, { signal: events.signal });
    canvas.addEventListener('pointercancel', endDrag, { signal: events.signal });
    canvas.addEventListener(
      'keydown',
      (event) => {
        const direction = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!direction) return;
        event.preventDefault();
        const dx = (direction[0] ?? 0) * 5,
          dy = (direction[1] ?? 0) * 5;
        const nextWidth = Math.max(1, crop.width + (ratio > 0 ? dx || dy * ratio : dx));
        const nextHeight = ratio > 0 ? nextWidth / ratio : Math.max(1, crop.height + dy);
        const next = event.shiftKey
          ? cropBetween(
              crop,
              { x: crop.x + nextWidth, y: crop.y + nextHeight },
              bitmap.width,
              bitmap.height,
              ratio,
            )
          : moveCrop(crop, dx, dy, bitmap.width, bitmap.height);
        if (next.width >= 1 && next.height >= 1) crop = next;
        draw();
      },
      { signal: events.signal },
    );
    ratios.addEventListener(
      'change',
      (event) => {
        const option = event.target;
        if (!(option instanceof HTMLInputElement) || !option.checked) return;
        ratio =
          option.value === 'screen'
            ? window.innerWidth / window.innerHeight
            : option.value === 'wide'
              ? 16 / 9
              : option.value === 'square'
                ? 1
                : 0;
        crop = centeredCrop(bitmap.width, bitmap.height, ratio);
        draw();
      },
      { signal: events.signal },
    );
    dialog.querySelector('[data-crop="reset"]')?.addEventListener(
      'click',
      () => {
        crop = centeredCrop(bitmap.width, bitmap.height, ratio);
        draw();
      },
      { signal: events.signal },
    );
    dialog
      .querySelector('[data-crop="cancel"]')
      ?.addEventListener('click', cancel, { signal: events.signal });
    apply.addEventListener('click', () => finish(crop), { signal: events.signal });
    dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      },
      { signal: events.signal },
    );
    dialog.addEventListener(
      'close',
      (event) => {
        event.stopPropagation();
        cancel();
      },
      { signal: events.signal },
    );
    root.appendChild(dialog);
    draw();
    dialog.showModal();
    canvas.focus();
  });
}
