import type { Scope } from '../../core/scope';
import type { MarkdownAnchor } from './markdown';

// Measure source positions with the textarea's actual wrapping, then match them
// to rendered blocks/rows instead of comparing unrelated total scroll heights.
export function createScrollSync(
  editor: HTMLTextAreaElement,
  preview: HTMLElement,
  paper: HTMLElement,
  scope: Scope,
) {
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.cssText =
    'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;box-sizing:border-box;';
  editor.getRootNode().appendChild(mirror);
  let enabled = false;
  let source = '';
  let anchors: MarkdownAnchor[] = [];
  let points: { source: number; preview: number }[] = [];
  let dirty = true;
  let frame = 0;

  const measure = () => {
    const style = getComputedStyle(editor);
    for (const property of [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'font-stretch',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'text-indent',
      'text-transform',
      'tab-size',
      'white-space',
      'overflow-wrap',
      'word-break',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ])
      mirror.style.setProperty(property, style.getPropertyValue(property));
    mirror.style.width = `${editor.clientWidth}px`;
    mirror.textContent = `${source}\n`;
    const text = mirror.firstChild as Text;
    const origin = mirror.getBoundingClientRect().top;
    const previewOrigin = preview.getBoundingClientRect().top - preview.scrollTop;
    const range = document.createRange();
    points = [{ source: 0, preview: 0 }];
    for (const anchor of anchors) {
      const offset = Math.min(source.length, Math.max(0, anchor.offset - (anchor.bottom ? 1 : 0)));
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      const sourceRect = range.getBoundingClientRect();
      const previewRect = anchor.element.getBoundingClientRect();
      points.push({
        source: (anchor.bottom ? sourceRect.bottom : sourceRect.top) - origin,
        preview: (anchor.bottom ? previewRect.bottom : previewRect.top) - previewOrigin,
      });
    }
    points.sort((a, b) => a.source - b.source);
    dirty = false;
  };

  const sync = () => {
    frame = 0;
    if (!enabled || editor.value !== source) return;
    if (dirty) measure();
    const top = editor.scrollTop;
    const editorRange = editor.scrollHeight - editor.clientHeight;
    const previewRange = Math.max(0, preview.scrollHeight - preview.clientHeight);
    if (top <= 0 || editorRange <= 0) {
      preview.scrollTop = 0;
      return;
    }
    if (top >= editorRange - 1) {
      preview.scrollTop = previewRange;
      return;
    }
    let before = points[0];
    let after = points[points.length - 1];
    if (!before || !after) return;
    for (const point of points) {
      if (point.source > top) {
        after = point;
        break;
      }
      before = point;
    }
    const distance = after.source - before.source;
    const progress = distance > 0 ? Math.min(1, (top - before.source) / distance) : 0;
    preview.scrollTop = Math.max(
      0,
      Math.min(previewRange, before.preview + progress * (after.preview - before.preview)),
    );
  };
  const schedule = () => {
    if (enabled && !frame) frame = requestAnimationFrame(sync);
  };
  const resize = new ResizeObserver(() => {
    dirty = true;
    schedule();
  });
  resize.observe(editor);
  resize.observe(preview);
  resize.observe(paper);
  editor.addEventListener('scroll', schedule, { passive: true, signal: scope.signal });
  const fontsChanged = () => {
    dirty = true;
    schedule();
  };
  document.fonts.addEventListener('loadingdone', fontsChanged, { signal: scope.signal });
  scope.defer(() => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    mirror.remove();
  });
  return {
    update(value: string, nextAnchors: MarkdownAnchor[]) {
      source = value;
      anchors = nextAnchors;
      dirty = true;
      schedule();
    },
    setEnabled(value: boolean) {
      enabled = value;
      dirty = true;
      schedule();
    },
  };
}
