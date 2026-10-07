import { fontCss, layoutCss } from 'virtual:homework-katex';
import { browser } from 'wxt/browser';
import type { FeatureModule } from '../../core/module';
import { preventUpdateWhile } from '../../platform/update-guard';
import { editorName, pdfEnabled } from '../../shared/edition';
import { isRecord } from '../../shared/settings';
import { findHomework, submitHomework } from '../../site/homework';
import { canvasBlob, captureAnswer, downloadBlob } from './export';
import { formatToolbar, icon } from './icons';
import { renderMarkdown } from './markdown';
import style from './style.css?inline';

export default {
  async mount({ scope, url }) {
    const homework = findHomework(document, url);
    if (!homework) return;
    const key = `asterveil:homework:${homework.key}`;
    let draft = '';
    let hidden = false;
    let storageError = false;
    try {
      const saved = (await browser.storage.local.get(key))[key];
      if (isRecord(saved)) {
        if (typeof saved.markdown === 'string') draft = saved.markdown.slice(0, 200000);
        hidden = saved.hidden === true;
      }
    } catch {
      storageError = true;
    }
    if (scope.signal.aborted) return;
    const host = document.createElement('section');
    host.dataset.asterveilHomework = '';
    const root = host.attachShadow({ mode: 'open' });
    const fonts = document.createElement('style');
    fonts.dataset.asterveil = 'homework-fonts';
    fonts.textContent = fontCss;
    document.head.append(fonts);
    scope.defer(() => fonts.remove());
    root.innerHTML = `<style>${layoutCss}\n${style}</style>
      <section class="editor" aria-label="${editorName}">
        <div class="toolbar" role="toolbar" aria-label="Markdown 格式">
          <div class="format-tools">${formatToolbar()}</div>
          ${
            pdfEnabled
              ? `<div class="extra-tools">
            <label class="icon-button file-button" title="上传 PDF">${icon('upload')}<input type="file" accept="application/pdf,.pdf" aria-label="上传 PDF"></label>
          </div>`
              : ''
          }
        </div>
        <div class="panes">
          <div class="pane"><textarea aria-label="Markdown" spellcheck="false" maxlength="200000" placeholder="在此输入 Markdown…"></textarea></div>
          <div class="pane preview-pane"><div class="pane-title">${icon('eye')}<span>实时预览</span><button type="button" class="scroll-sync" data-action="scroll-sync" aria-pressed="false">同步滚动</button></div><div class="preview-scroll"><article class="paper" aria-label="答案预览"></article></div></div>
        </div>
        <footer>
          <span class="character-count">0 字符</span>
          <div class="actions">
            <div class="export-buttons">
              <button type="button" data-action="png">${icon('download')}<span>导出图片</span></button>
              <details class="export-options"><summary title="更多导出选项" aria-label="更多导出选项">${icon('chevron')}</summary><div class="export-menu">${pdfEnabled ? '<button type="button" data-action="pdf">导出 PDF</button>' : ''}<button type="button" data-action="markdown">保存 Markdown</button></div></details>
            </div>
            <button type="button" data-action="submit" class="primary">${icon('send')}<span>提交答案</span></button>
          </div>
        </footer>
        <p class="status" role="status" aria-live="polite"></p>
      </section>
      <dialog aria-labelledby="submission-title">
        <h2 id="submission-title">确认提交</h2>
        <div class="submission-preview"><img alt="待提交的答案图片"></div>
        <div class="dialog-actions"><button type="button" data-action="cancel">返回编辑</button><button type="button" class="primary" data-action="confirm">确认提交</button></div>
      </dialog>`;
    const get = <T extends Element>(selector: string) => root.querySelector<T>(selector) as T;
    const editor = get<HTMLTextAreaElement>('textarea');
    const preview = get<HTMLElement>('.paper');
    const previewScroll = get<HTMLElement>('.preview-scroll');
    const scrollSyncButton = get<HTMLButtonElement>('[data-action="scroll-sync"]');
    let scrollSync = false;
    const syncPreviewScroll = () => {
      if (!scrollSync) return;
      const editorRange = editor.scrollHeight - editor.clientHeight;
      const progress =
        editorRange > 0 ? Math.min(1, Math.max(0, editor.scrollTop / editorRange)) : 0;
      previewScroll.scrollTop =
        progress * (previewScroll.scrollHeight - previewScroll.clientHeight);
    };
    editor.addEventListener('scroll', syncPreviewScroll, { passive: true, signal: scope.signal });
    const scrollResizeObserver = new ResizeObserver(syncPreviewScroll);
    scrollResizeObserver.observe(editor);
    scrollResizeObserver.observe(preview);
    scrollResizeObserver.observe(previewScroll);
    scope.defer(() => scrollResizeObserver.disconnect());
    const status = get<HTMLElement>('.status');
    const visibilityHost = document.createElement('span');
    visibilityHost.dataset.asterveilAnswerToggle = '';
    const visibilityRoot = visibilityHost.attachShadow({ mode: 'open' });
    visibilityRoot.innerHTML = `<style>:host { float: right; margin-left: 12px; } button { border: 1px solid var(--av-border, #d8e1ec); border-radius: 6px; padding: 4px 10px; background: var(--av-paper, #fff); color: var(--av-accent, #3b82c4); font: 12px/1.5 system-ui, sans-serif; cursor: pointer; } button:hover { background: var(--av-hover, #f1f5fa); } button:focus-visible { outline: 2px solid var(--av-accent, #3b82c4); outline-offset: 2px; }</style><button type="button"></button>`;
    const hide = visibilityRoot.querySelector('button') as HTMLButtonElement;
    const upload = root.querySelector<HTMLInputElement>('input[type="file"]');
    const dialog = get<HTMLDialogElement>('dialog');
    const confirm = get<HTMLButtonElement>('[data-action="confirm"]');
    const exportOptions = get<HTMLDetailsElement>('.export-options');
    const characterCount = get<HTMLElement>('.character-count');
    editor.value = draft;
    const updateCount = () => {
      characterCount.textContent = `${Array.from(editor.value).length} 字符`;
    };
    updateCount();
    let saveTimer = 0;
    let renderTimer = 0;
    let busy = false;
    let submitted = false;
    let prepared: File | undefined;
    let previewUrl: string | undefined;
    let saveQueue = Promise.resolve();
    let dirty = false;
    let saving = 0;
    preventUpdateWhile(scope, () => busy || submitted || dirty || saving > 0 || dialog.open);
    const originalStyles = homework.submittedBlocks
      .flatMap(({ heading, body }) => [heading, body])
      .map((element) => ({
        element,
        style: element.getAttribute('style'),
      }));

    const report = (message: string, error = false) => {
      status.textContent = message;
      status.toggleAttribute('data-error', error);
    };
    const save = () => {
      clearTimeout(saveTimer);
      if (!dirty) return;
      dirty = false;
      const value = { markdown: editor.value, hidden };
      saving++;
      saveQueue = saveQueue
        .then(() => browser.storage.local.set({ [key]: value }))
        .catch(() => {
          dirty = true;
          if (!scope.signal.aborted) report('草稿保存失败，请先保存 Markdown 文件。', true);
        })
        .finally(() => {
          saving--;
        });
    };
    const render = () => {
      clearTimeout(renderTimer);
      try {
        renderMarkdown(editor.value, preview);
        syncPreviewScroll();
      } catch {
        report('预览失败，请检查 Markdown 内容。', true);
      }
    };
    const updateHidden = () => {
      for (const { element, style } of originalStyles) {
        if (style === null) element.removeAttribute('style');
        else element.setAttribute('style', style);
      }
      for (const { heading, body } of homework.submittedBlocks) {
        for (const element of [heading, body]) {
          element.style.margin = '0';
          element.style.width = '100%';
          element.style.boxSizing = 'border-box';
        }
        heading.style.borderRadius = hidden ? '12px' : '12px 12px 0 0';
        body.style.borderRadius = '0 0 12px 12px';
        body.style.borderTopWidth = '0';
        if (hidden) body.style.setProperty('display', 'none', 'important');
      }
      const label = hidden ? '展开' : '收起';
      hide.textContent = label;
      hide.title = label;
      hide.setAttribute('aria-label', label);
      hide.setAttribute('aria-expanded', String(!hidden));
    };
    const closePreview = () => {
      if (dialog.open) dialog.close();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      prepared = undefined;
      get<HTMLImageElement>('.submission-preview img').removeAttribute('src');
    };
    const openPreview = (file: File) => {
      closePreview();
      prepared = file;
      previewUrl = URL.createObjectURL(file);
      get<HTMLImageElement>('.submission-preview img').src = previewUrl;
      dialog.showModal();
    };
    const run = async (action: () => Promise<void>) => {
      if (busy || submitted || scope.signal.aborted) return;
      busy = true;
      exportOptions.open = false;
      for (const button of root.querySelectorAll<HTMLButtonElement>('.actions button'))
        button.disabled = true;
      if (upload) upload.disabled = true;
      editor.readOnly = true;
      report('正在生成，请稍候…');
      try {
        await action();
        if (!scope.signal.aborted) report('');
      } catch (error) {
        if (!scope.signal.aborted)
          report(error instanceof Error ? error.message : '生成失败，请重试。', true);
      } finally {
        busy = false;
        for (const button of root.querySelectorAll<HTMLButtonElement>('.actions button'))
          button.disabled = submitted;
        if (upload) upload.disabled = submitted;
        editor.readOnly = false;
      }
    };
    const filename = () => homework.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').slice(0, 100);
    const generate = async (action: string) => {
      if (!editor.value.trim()) throw new Error('请先编写解答。');
      if (action === 'markdown') {
        downloadBlob(
          new Blob([editor.value], { type: 'text/markdown;charset=utf-8' }),
          `${filename()}.md`,
        );
        return;
      }
      const stage = document.createElement('div');
      stage.className = 'export-stage';
      stage.setAttribute('aria-hidden', 'true');
      const paper = document.createElement('article');
      paper.className = 'paper';
      renderMarkdown(editor.value, paper);
      stage.append(paper);
      root.append(stage);
      try {
        const canvas = await captureAnswer(paper, scope.signal);
        try {
          const blob =
            pdfEnabled && action === 'pdf'
              ? await (await import('./pdf-export')).createPdf(canvas)
              : await canvasBlob(canvas);
          scope.signal.throwIfAborted();
          if (action === 'submit')
            openPreview(new File([blob], `${filename()}.png`, { type: 'image/png' }));
          else downloadBlob(blob, `${filename()}.${action}`);
        } finally {
          canvas.width = canvas.height = 0;
        }
      } finally {
        stage.remove();
      }
    };
    editor.addEventListener(
      'input',
      () => {
        updateCount();
        dirty = true;
        clearTimeout(saveTimer);
        clearTimeout(renderTimer);
        saveTimer = window.setTimeout(save, 400);
        renderTimer = window.setTimeout(render, 160);
      },
      { signal: scope.signal },
    );
    root.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('button');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'scroll-sync') {
          scrollSync = !scrollSync;
          scrollSyncButton.setAttribute('aria-pressed', String(scrollSync));
          syncPreviewScroll();
        } else if (action === 'cancel') closePreview();
        else if (action === 'confirm' && prepared && !submitted) {
          submitted = true;
          confirm.disabled = true;
          confirm.textContent = '正在提交…';
          save();
          try {
            submitHomework(homework.form, prepared);
          } catch {
            submitted = false;
            confirm.disabled = false;
            confirm.textContent = '确认提交';
            closePreview();
            report('提交未完成，请检查页面后重试。', true);
          }
        } else if (action && ['png', 'pdf', 'markdown', 'submit'].includes(action))
          void run(() => generate(action));
        else if (button.dataset.format && !busy) {
          const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
          const formats: Record<string, string> = {
            heading: `## ${selected || '标题'}\n`,
            bold: `**${selected || '文字'}**`,
            italic: `*${selected || '文字'}*`,
            strike: `~~${selected || '文字'}~~`,
            rule: '\n\n---\n\n',
            quote: `> ${selected || '引用'}\n`,
            math: `\n$$\n${selected || '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}'}\n$$\n`,
            code: `\n\`\`\`cpp\n${selected || '// 代码'}\n\`\`\`\n`,
            list: `- ${selected || '列表项'}\n`,
            ordered: `1. ${selected || '列表项'}\n`,
            task: `- [ ] ${selected || '任务'}\n`,
            link: `[${selected || '链接文字'}](https://)`,
            image: `![${selected || '图片描述'}](https://)`,
            table: `\n| ${selected || '标题'} | 标题 |\n| --- | --- |\n| 内容 | 内容 |\n`,
          };
          editor.setRangeText(
            formats[button.dataset.format] ?? '',
            editor.selectionStart,
            editor.selectionEnd,
            'end',
          );
          editor.dispatchEvent(new Event('input'));
          editor.focus();
        }
      },
      { signal: scope.signal },
    );
    if (pdfEnabled && upload)
      upload.addEventListener(
        'change',
        () => {
          const file = upload.files?.[0];
          upload.value = '';
          if (file)
            void run(async () => {
              const { pdfToImage } = await import('./pdf');
              const image = await pdfToImage(file, scope.signal);
              scope.signal.throwIfAborted();
              openPreview(image);
            });
        },
        { signal: scope.signal },
      );
    dialog.addEventListener('cancel', closePreview, { signal: scope.signal });
    hide.addEventListener(
      'click',
      () => {
        dirty = true;
        hidden = !hidden;
        updateHidden();
        save();
      },
      { signal: scope.signal },
    );
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!event.composedPath().includes(exportOptions)) exportOptions.open = false;
      },
      { signal: scope.signal },
    );
    root.addEventListener(
      'keydown',
      (event) => {
        if ((event as KeyboardEvent).key === 'Escape' && exportOptions.open) {
          exportOptions.open = false;
          get<HTMLElement>('summary').focus();
        }
      },
      { signal: scope.signal },
    );
    window.addEventListener('pagehide', save, { signal: scope.signal });
    scope.defer(() => {
      clearTimeout(renderTimer);
      save();
      closePreview();
      for (const { element, style } of originalStyles) {
        if (style === null) element.removeAttribute('style');
        else element.setAttribute('style', style);
      }
      host.remove();
      visibilityHost.remove();
    });
    homework.uploadSection.before(host);
    homework.submittedBlocks[0]?.heading.append(visibilityHost);
    updateHidden();
    render();
    if (storageError) report('无法读取草稿，编辑后请保存 Markdown 文件。', true);
  },
} satisfies FeatureModule;
