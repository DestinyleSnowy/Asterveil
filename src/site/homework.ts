import { appearancePage } from './appearance';

export function matchesHomeworkPage(url: URL): boolean {
  return appearancePage(url) === 'problem';
}

export function findHomework(document: Document, url: URL) {
  if (!matchesHomeworkPage(url)) return;
  const heading = document.querySelector('.ui.main.container h1');
  const title = heading?.textContent?.trim() ?? '';
  if (!/^H/.test(title)) return;
  const form = document.querySelector<HTMLFormElement>('form#submit_code');
  const input = form?.querySelector<HTMLInputElement>('input[type="file"][name="answer"]');
  if (!form || !input || form.method.toLowerCase() !== 'post') return;
  const action = new URL(form.action, url);
  const problemId = url.pathname.match(/\/problem\/(\d+)/)?.[1];
  if (action.origin !== url.origin || action.pathname !== `/problem/${problemId}/submit`) return;
  const userId = document
    .querySelector<HTMLAnchorElement>('#user-dropdown a[href^="/user/"]')
    ?.getAttribute('href')
    ?.match(/^\/user\/(\d+)$/)?.[1];
  const images = [...form.querySelectorAll<HTMLImageElement>('.ten.wide.column > img')].filter(
    (image) => {
      const source = new URL(image.src, url);
      return (
        source.origin === url.origin &&
        new RegExp(`^/problem/${problemId}/answer/\\d+/?$`).test(source.pathname)
      );
    },
  );
  const submittedBlocks = [
    ...new Set(
      images.map((image) => image.closest<HTMLElement>('.ui.bottom.attached.segment.font-content')),
    ),
  ].flatMap((body) => {
    const heading = body?.previousElementSibling;
    return body && heading instanceof HTMLElement && heading.matches('h4.ui.top.attached.header')
      ? [{ heading, body }]
      : [];
  });
  let uploadSection: Element = input;
  while (uploadSection.parentElement && uploadSection.parentElement !== form) {
    uploadSection = uploadSection.parentElement;
  }
  return {
    form,
    input,
    uploadSection,
    title,
    submittedBlocks,
    key: `${userId ?? 'anonymous'}:${url.pathname}`,
  };
}

// Use the observed multipart form contract, including any hidden CSRF/context fields.
// A separate form avoids the site's code-editor handler on paper-only homework.
export function submitHomework(form: HTMLFormElement, file: File): void {
  const submission = document.createElement('form');
  submission.action = form.action;
  submission.method = 'post';
  submission.enctype = 'multipart/form-data';
  submission.hidden = true;
  for (const field of form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')) {
    if (field.name !== 'answer') submission.append(field.cloneNode(true));
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'answer';
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  submission.append(input);
  document.body.append(submission);
  try {
    HTMLFormElement.prototype.submit.call(submission);
  } finally {
    submission.remove();
  }
}
