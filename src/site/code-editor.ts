import { browser } from 'wxt/browser';
import { Scope } from '../core/scope';
import type { CodeEditorLayoutRequest } from '../shared/code-editor';
import { appearancePage } from './appearance';

function watchCodeEditor(scope: Scope) {
  let editor: HTMLElement | null = null;
  let nativeEditor: Element | null = null;
  let frame = 0;
  let pending = false;
  let pendingFonts = false;
  let sending = false;

  const schedule = (fonts = false) => {
    if (scope.signal.aborted) return;
    pending = true;
    pendingFonts ||= fonts;
    if (frame || sending) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (scope.signal.aborted || !editor?.isConnected || !nativeEditor?.isConnected) return;
      const request: CodeEditorLayoutRequest = {
        channel: 'asterveil',
        type: 'code-editor.layout',
        fonts: pendingFonts,
      };
      pending = pendingFonts = false;
      sending = true;
      void browser.runtime
        .sendMessage(request)
        .catch(() => undefined)
        .finally(() => {
          sending = false;
          if (pending) schedule();
        });
    });
  };
  const resize = new ResizeObserver(() => schedule());
  const discover = () => {
    const next = document.querySelector<HTMLElement>('#submit_code #editor');
    const nextNative = next?.querySelector('.monaco-editor') ?? null;
    if (next === editor && nextNative === nativeEditor) return;
    resize.disconnect();
    editor = next;
    nativeEditor = nextNative;
    if (editor) resize.observe(editor);
    if (nativeEditor) schedule(true);
  };
  const observer = new MutationObserver(discover);
  observer.observe(document.body, { childList: true, subtree: true });
  discover();
  const fontsChanged = () => schedule(true);
  document.fonts.addEventListener('loadingdone', fontsChanged, { signal: scope.signal });
  document.fonts.addEventListener('loadingerror', fontsChanged, { signal: scope.signal });
  void document.fonts.ready.then(fontsChanged);
  window.addEventListener('resize', fontsChanged, { signal: scope.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) fontsChanged();
    },
    { signal: scope.signal },
  );
  scope.defer(() => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    observer.disconnect();
  });
}

export function createCodeEditorLayout(scope: Scope) {
  let active: Scope | undefined;
  const stop = () => {
    active?.dispose();
    active = undefined;
  };
  scope.defer(stop);
  return {
    update(url: URL, enabled: boolean) {
      if (!enabled || appearancePage(url) !== 'problem') return stop();
      if (active || scope.signal.aborted) return;
      active = new Scope();
      watchCodeEditor(active);
    },
  };
}
