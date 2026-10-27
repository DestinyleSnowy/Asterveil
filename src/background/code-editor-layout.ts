import { appearancePage } from '../site/appearance';
import { isSettingsSender } from './settings-sender';

export function codeEditorLayoutTarget(
  sender: Parameters<typeof isSettingsSender>[0] & { documentId?: string | undefined },
  extensionId: string,
) {
  const tabId = sender.tab?.id;
  if (
    tabId === undefined ||
    !isSettingsSender(sender, extensionId) ||
    !sender.documentId ||
    appearancePage(new URL(sender.url ?? '')) !== 'problem'
  )
    return;
  return { tabId, documentIds: [sender.documentId] };
}

// Serialized into the page's MAIN world. Keep this function independent of extension state.
export function refreshNativeCodeEditorLayout(fonts: boolean): boolean {
  const root = document.querySelector('#submit_code #editor');
  if (!root?.querySelector('.monaco-editor')) return false;
  const page = window as Window & {
    monaco?: { editor?: { remeasureFonts?: () => void } };
    editor?: { getDomNode?: () => HTMLElement | null; layout?: () => void };
  };
  const editor = page.editor;
  const node = editor?.getDomNode?.();
  if (!node || !root.contains(node) || typeof editor?.layout !== 'function') return false;
  if (fonts) page.monaco?.editor?.remeasureFonts?.();
  editor.layout();
  return true;
}
