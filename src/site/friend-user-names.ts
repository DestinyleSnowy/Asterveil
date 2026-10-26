import { BetterNamesPlanError, supplementalUserEntries } from '../shared/better-names-plan';
import { schoolClassUserGrade } from '../shared/user-grade-year';
import type { UserNameEntry } from '../shared/user-name-sources';
import { profileUserId } from './user-names';

export function parseFriendUserNames(document: ParentNode, url: URL): readonly UserNameEntry[] {
  const cells = (row: Element) => [...row.children].filter((cell) => cell.matches('th, td'));
  for (const table of document.querySelectorAll('table')) {
    const rows = [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table);
    // The live friend page uses ordinary td cells for its header, without a thead.
    const header = rows.find((row) => {
      const labels = cells(row).map((cell) => cell.textContent?.trim() ?? '');
      return labels.includes('用户号') && labels.includes('姓名');
    });
    if (!header) continue;
    const headings = cells(header).map((cell) => cell.textContent?.trim() ?? '');
    const idColumn = headings.indexOf('用户号');
    const nameColumn = headings.indexOf('姓名');
    const classColumn = headings.indexOf('班级');
    if (idColumn < 0 || nameColumn < 0) continue;
    if (rows.length > 10_001) throw new BetterNamesPlanError('好友数据过大');
    const users = rows
      .filter((row) => row !== header)
      .map((row) => {
        const columns = cells(row);
        const ids = new Set(
          [...(columns[idColumn]?.querySelectorAll('a[href]') ?? [])]
            .map((link) => profileUserId(link.getAttribute('href') ?? '', url))
            .filter((id) => id !== undefined),
        );
        return {
          id: ids.size === 1 ? [...ids][0] : undefined,
          name: columns[nameColumn]?.textContent ?? '',
          grade: schoolClassUserGrade(columns[classColumn]?.textContent ?? ''),
        };
      });
    return supplementalUserEntries(users);
  }
  if (document.querySelector('input[type="password"], form[action*="login"]'))
    throw new BetterNamesPlanError('请先登录', true);
  throw new BetterNamesPlanError('好友数据格式无效');
}
