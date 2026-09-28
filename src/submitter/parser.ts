// Adapted from the user-provided 7FA4 submitter 0.1.13 popup.js.
// Parse an inert DOM only; never attach source HTML to the extension page.
import { isSubmission, type Oj, type Submission } from './model';

const routes: [Oj, RegExp][] = [
  ['luogu', /^https:\/\/(?:www\.)?luogu\.com\.cn\/record\/(\d+)\/?$/],
  ['uoj', /^https:\/\/(?:www\.)?uoj\.ac\/submission\/(\d+)\/?$/],
  ['qoj', /^https:\/\/(?:www\.)?qoj\.ac\/submission\/(\d+)\/?$/],
  [
    'cf',
    /^https:\/\/(?:www\.)?codeforces\.com\/(?:contest\/\d+\/submission|problemset\/submission\/\d+)\/(\d+)\/?$/,
  ],
  ['cfgym', /^https:\/\/(?:www\.)?codeforces\.com\/gym\/\d+\/submission\/(\d+)\/?$/],
  ['atc', /^https:\/\/(?:www\.)?atcoder\.jp\/contests\/[^/]+\/submissions\/(\d+)\/?$/],
  ['vj', /^https:\/\/(?:www\.)?vjudge\.net\/solution\/(\d+)\/?$/],
  ['cc', /^https:\/\/(?:www\.)?codechef\.com\/viewsolution\/(\d+)\/?$/],
  ['csa', /^https:\/\/(?:www\.)?csacademy\.com\/contest\/archive\/task\/([^/]+)\/.+$/],
  ['zr', /^https?:\/\/(?:www\.)?zhengruioi\.com\/submission\/(\d+)\/?$/],
  ['xyd', /^https:\/\/(?:www\.)?xinyoudui\.com\/ac\/contest\/[^/]+\/problem\/(\d+)\/?$/],
  ['oifha', /^https:\/\/(?:www\.)?oifha\.com\/d\/[^/]+\/record\/(\w+)\/?$/],
  ['mx', /^https:\/\/(?:www\.)?mna\.wang\/contest\/submission\/(\d+)\/?$/],
  ['7fa4', /^https?:\/\/(?:jx|in)\.7fa4\.cn:8888\/submission\/(\d+)\/?$/],
];

export function submissionRoute(value: string): { oj: Oj; rid: string } {
  const url = new URL(value);
  for (const [oj, pattern] of routes) {
    const rid = pattern.exec(url.origin + url.pathname)?.[1];
    if (rid && !url.username && !url.password) return { oj, rid };
  }
  throw new Error('请打开支持的 OJ 提交记录详情页。');
}

const text = (node: Element | null | undefined) => node?.textContent?.trim() ?? '';
function numeric(value: string): number {
  const number = Number(value.trim());
  if (!value.trim() || !Number.isFinite(number))
    throw new Error('未能读取评测分数，请等待评测完成并刷新页面。');
  return number;
}
function href(node: Element | null | undefined): string {
  const value = node?.getAttribute('href');
  if (!value) throw new Error('未能读取题号，请确认已打开提交详情。');
  return value;
}
function finished(status: string): string {
  if (
    !status ||
    /waiting|judging|pending|running|queue|compiling|\b(?:WJ|WR)\b|评测中|等待/i.test(status)
  ) {
    throw new Error('评测结果尚未显示，请等待完成并刷新页面。');
  }
  return status;
}

export function parseSubmission(
  html: string,
  url: string,
  useOriginalProblem: boolean,
): Submission {
  const route = submissionRoute(url);
  const template = globalThis.document.createElement('template');
  template.innerHTML = html;
  const document = template.content;
  const all = (selector: string, root: ParentNode = document) =>
    Array.from(root.querySelectorAll(selector));
  // Read one source block; other matches may be duplicate views or compiler output.
  const raw = (selector: string) => document.querySelector(selector)?.textContent ?? '';
  const td = all('tbody td');
  const ace = () =>
    all('.ace_layer.ace_text-layer .ace_line')
      .map((node) => node.textContent ?? '')
      .join('\n');
  const state: Submission = {
    ...route,
    code: '',
    pid: '',
    language: 'cpp17',
    status: 'Wrong Answer',
    total_time: 0,
    max_memory: 0,
    score: 0,
    in_contest: false,
  };
  const scored = (score: number) => {
    state.score = score;
    state.status = score >= 100 - 1e-5 ? 'Accepted' : 'Wrong Answer';
  };
  const verdict = (status: string) => {
    state.status = finished(status);
    if (['AC', 'Correct Answer', 'Happy New Year!'].includes(status)) state.status = 'Accepted';
    state.score = state.status === 'Accepted' ? 100 : 0;
  };
  switch (route.oj) {
    case 'luogu': {
      state.code = raw('pre');
      if (!state.code) throw new Error('请切换到“源代码”标签，然后再发送。');
      const rows = all('div.info-rows').find((node) => text(node).includes('评测状态'));
      if (!rows) throw new Error('未能读取洛谷评测信息，请刷新页面。');
      const value = (label: string, index: number) => {
        const row = all('div', rows).find((node) => text(node).includes(label));
        return row ? text(all('span', row)[index]) : '';
      };
      const status = finished(value('评测状态', 3));
      const score = value('评测分数', 3);
      scored(score ? numeric(score) : status === 'Accepted' ? 100 : 0);
      state.pid = value('所属题目', 4);
      break;
    }
    case 'uoj':
    case 'zr':
    case 'qoj': {
      const cells = route.oj === 'qoj' ? td : all('.uoj-content tbody td');
      state.code = raw('code');
      state.pid = text(cells[1]).split('.')[0]?.slice(1).trim() ?? '';
      const status = finished(text(cells[3]));
      if (route.oj === 'qoj') {
        const first = status.split(/\s+/)[0] ?? '';
        const score = Number(first);
        if (Number.isFinite(score) && first) {
          state.score = score;
          state.status = status.includes('✓') ? 'Accepted' : 'Wrong Answer';
        } else verdict(first);
      } else scored(numeric(status));
      break;
    }
    case 'cf':
    case 'cfgym': {
      const row =
        document.querySelector('.submission-details tr[data-submission-id]') ?? all('tbody tr')[1];
      const cells = row ? all('td', row) : [];
      state.pid = text(cells[2]?.querySelector('a'));
      const pre = document.querySelector('#program-source-text') ?? document.querySelector('pre');
      const lines = pre ? all('li', pre) : [];
      state.code = lines.length
        ? lines.map((node) => node.textContent ?? '').join('\n')
        : (pre?.textContent ?? '');
      const status = finished(text(cells[4]));
      const points = /^(Perfect|Partial) result: (\d+) points$/.exec(status);
      if (points) {
        state.score = numeric(points[2] ?? '');
        state.status = points[1] === 'Perfect' ? 'Accepted' : 'Partially Correct';
      } else {
        verdict(status);
        if (state.status !== 'Accepted') state.status = 'Wrong Answer';
      }
      break;
    }
    case 'atc': {
      const table = document.querySelector('table');
      const rows = table ? all('tr', table) : [];
      const parts = href(rows[1]?.querySelector('td a')).split('/');
      const task = parts.at(-1) ?? '';
      const contest = parts.at(-3) ?? '';
      const split = task.lastIndexOf('_');
      if (split < 0) throw new Error('未能读取 AtCoder 题号。');
      state.pid = (task.slice(0, split) + task.slice(split + 1)).toUpperCase();
      if (task.startsWith('-')) {
        state.oj = 'at';
        state.pid = `${contest}/${task}`.toUpperCase();
      }
      state.code = raw('.source-code-for-copy') || raw('#submission-code');
      verdict(text(rows[6]?.querySelector('td span')));
      break;
    }
    case 'vj': {
      const parts = href(all('h5 a')[2]).split('/');
      state.pid = parts.at(-1) ?? '';
      verdict(text(td[0]));
      if (state.status !== 'Accepted') state.status = 'Wrong Answer';
      state.code = raw('code');
      const mappings: [string, Oj][] = [
        ['洛谷-', 'luogu'],
        ['AtCoder-', 'atc'],
        ['CodeForces-', 'cf'],
        ['UniversalOJ-', 'uoj'],
        ['QOJ-', 'qoj'],
        ['Gym-', 'gym'],
        ['CodeChef-', 'cc'],
        ['CSAcademy-', 'csa'],
      ];
      if (useOriginalProblem) {
        const mapping = mappings.find(([prefix]) => state.pid.startsWith(prefix));
        if (mapping) {
          state.oj = mapping[1];
          state.pid = state.pid.slice(mapping[0].length);
          state.rid = text(document.querySelector('td.remote-run-id > a'));
          if (!state.rid)
            throw new Error('未显示远端提交编号，请刷新后重试，或使用 vjudge 题号发送。');
          if (state.oj === 'atc') state.pid = state.pid.replace(/_([^_]*)$/, '$1');
        }
      }
      break;
    }
    case 'cc':
      state.code = ace();
      state.pid = text(
        document.querySelector("[class^='_submissionDetailContainer'] [class^='_link']"),
      );
      verdict(text(document.querySelector("[class^='_status_container'] span")));
      break;
    case 'csa': {
      const score = /Score: (.*)\/100 \(.+\)/.exec(
        text(document.querySelector("[class^=' ProgressBar-container'] span")),
      );
      if (!score) throw new Error('请完成评测并切换到 Submission 标签。');
      state.code = ace();
      state.pid = route.rid;
      let hash = 0;
      for (const character of state.code) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
      state.rid = String(hash);
      scored(numeric(score[1] ?? ''));
      break;
    }
    case 'mx': {
      state.code = raw('pre');
      const parts = href(document.querySelector('tbody tr td a')).split('/');
      if (!parts[2] || !parts[4]) throw new Error('未能读取比赛题号。');
      state.pid = `${parts[2]}_${parts[4]}`;
      scored(numeric(text(td[3])));
      break;
    }
    case 'xyd': {
      const problem = document.querySelector(
        '#rc-tabs-0-panel-submissions > div > div.ac-ant-space.ac-ant-space-vertical > div > div > div > div > span:nth-child(1)',
      );
      const cells = all('tr.ac-ant-table-row-selected td');
      if (!problem || !cells.length) throw new Error('请在提交记录中点击代码详情的眼睛图标。');
      const pid = text(problem).slice(5);
      state.pid = /^\d+$/.test(pid) ? pid : route.rid;
      state.rid = text(cells[0]);
      state.code = all('.CodeMirror-code .CodeMirror-line')
        .map((node) => node.textContent ?? '')
        .join('\n');
      verdict(text(cells[2]));
      if (state.status === 'Acceptable Answer') state.status = 'Partially Correct';
      state.score = numeric(text(cells[3]));
      break;
    }
    case 'oifha': {
      state.code = raw('code');
      const parts = href(all('.large.horizontal dd')[1]?.querySelector('a')).split('/');
      if (!parts[2] || !parts[4]) throw new Error('未能读取题目链接。');
      state.pid = `${parts[2]}/${parts[4].split('?')[0]}`;
      verdict(text(document.querySelector('.section__title .record-status--text')));
      state.score = numeric(text(all('.section__title span')[1]));
      break;
    }
    case '7fa4': {
      state.code = raw('pre code.language-cpp');
      const parts = href(td[1]?.querySelector('a')).split('/');
      state.pid = parts.at(-1) ?? '';
      verdict(text(td[2]));
      state.score = numeric(text(td[3]));
      state.total_time = numeric(text(td[4]).split(/\s+/)[0] ?? '');
      state.max_memory = numeric(text(td[5]).split(/\s+/)[0] ?? '');
      break;
    }
  }
  if (!isSubmission(state))
    throw new Error('提交信息不完整，请确保题号、评测结果和完整源代码已经显示。');
  return state;
}
