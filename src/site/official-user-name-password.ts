import { BetterNamesPlanError } from '../shared/better-names-plan';

function signatureText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const tag = (node as Element).tagName;
  if (tag === 'BR') return '\n';
  if (/^(?:SCRIPT|STYLE|TEMPLATE)$/.test(tag)) return '';
  const text = [...node.childNodes].map(signatureText).join('');
  return /^(?:P|DIV|LI|PRE|BLOCKQUOTE|H[1-6]|SECTION|ARTICLE|TR)$/.test(tag) ? `\n${text}\n` : text;
}

export function officialUserNamePassword(root: ParentNode): string {
  const heading = [...root.querySelectorAll('h4')].find(
    (node) => node.textContent?.trim() === '个性签名',
  );
  if (!heading) {
    const text = [...root.childNodes].map((node) => node.textContent ?? '').join('');
    if (/请.*登录|登录后/.test(text)) throw new BetterNamesPlanError('请先登录', true);
    throw new BetterNamesPlanError('未找到解锁口令', true);
  }
  const signature = heading.nextElementSibling;
  const password = signature && /^\S+/u.exec(signatureText(signature).trim())?.[0].normalize('NFC');
  if (!password || password.length > 4096) throw new BetterNamesPlanError('未找到解锁口令', true);
  return password;
}
