// Explicit routes keep editor, download and action endpoints outside the theme.
const pages = {
  home: /^\/$/,
  login: /^\/login$/,
  problems: /^\/problems(?:\/|$)/,
  problem: /^\/(?:contest\/\d+\/)?problem\/\d+$/,
  answers: /^\/problem\/\d+\/answers(?:\/(?:best|newest|uncomment))?$/,
  suggestion: /^\/problem\/\d+\/suggestion$/,
  statistics:
    /^\/problem\/\d+\/statistics(?:\/(?:shortest|fastest|slowest|longest|earliest|min|max))?$/,
  contests: /^\/contests$/,
  chat: /^\/chat$/,
  contest: /^\/contest\/\d+$/,
  submissions: /^\/submissions$/,
  submission: /^\/submission\/\d+$/,
  ranklist: /^\/ranklist$/,
  foreign: /^\/foreign\/list\/html$/,
  plans: /^\/user_plans\/\d+$/,
  profile: /^\/user\/\d+$/,
  rewards: /^\/user\/\d+\/squats$/,
  'account-edit': /^\/user\/\d+\/edit$/,
  'account-schedule': /^\/user\/\d+\/schedule$/,
  'account-rankings': /^\/progress\/(?:quiz|contests|contest_table\/html)$/,
  'account-data': /^\/user_tag_map$/,
  'account-rpgain': /^\/rpgain$/,
  account:
    /^\/(?:user\/\d+\/friend|user\/login_tokens|user_requests|prints\/html|sign_list|suggestions\/html|help)$/,
} as const;

export type AppearancePage = keyof typeof pages;
const pageNames = Object.keys(pages) as AppearancePage[];

export function appearancePage(url: URL): AppearancePage | undefined {
  const path = url.pathname.replace(/\/$/, '') || '/';
  return pageNames.find((page) => pages[page].test(path));
}

export function matchesAppearancePage(url: URL): boolean {
  return appearancePage(url) !== undefined;
}
