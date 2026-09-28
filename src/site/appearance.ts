export function appearancePage(url: URL): string | undefined {
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path === '/') return 'home';
  if (/^\/problems(?:\/|$)/.test(path)) return 'problems';
  if (/^\/(?:contest\/\d+\/)?problem\/\d+$/.test(path)) return 'problem';
  if (/^\/problem\/\d+\/answers(?:\/(?:best|newest|uncomment))?$/.test(path)) return 'answers';
  if (/^\/problem\/\d+\/suggestion$/.test(path)) return 'suggestion';
  if (
    /^\/problem\/\d+\/statistics(?:\/(?:shortest|fastest|slowest|longest|earliest|min|max))?$/.test(
      path,
    )
  )
    return 'statistics';
  if (path === '/contests') return 'contests';
  if (/^\/contest\/\d+$/.test(path)) return 'contest';
  if (path === '/submissions') return 'submissions';
  if (/^\/submission\/\d+$/.test(path)) return 'submission';
  if (path === '/ranklist') return 'ranklist';
  if (path === '/foreign/list/html') return 'foreign';
  if (/^\/user_plans\/\d+$/.test(path)) return 'plans';
  if (/^\/user\/\d+$/.test(path)) return 'profile';
  if (/^\/user\/\d+\/squats$/.test(path)) return 'rewards';
  if (/^\/user\/\d+\/edit$/.test(path)) return 'account-edit';
  if (/^\/user\/\d+\/schedule$/.test(path)) return 'account-schedule';
  if (['/progress/quiz', '/progress/contests', '/progress/contest_table/html'].includes(path))
    return 'account-rankings';
  if (path === '/user_tag_map') return 'account-data';
  if (path === '/rpgain') return 'account-rpgain';
  if (/^\/user\/\d+\/friend$/.test(path)) return 'account';
  if (
    [
      '/user/login_tokens',
      '/user_requests',
      '/prints/html',
      '/sign_list',
      '/suggestions/html',
      '/help',
    ].includes(path)
  )
    return 'account';
  return undefined;
}

export function matchesAppearancePage(url: URL): boolean {
  return appearancePage(url) !== undefined;
}
