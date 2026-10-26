export function currentUserId(): number | undefined {
  const dropdown = document.querySelector('#user-dropdown');
  const profile = dropdown?.querySelector<HTMLAnchorElement>('a[href^="/user/"]');
  const raw =
    dropdown?.getAttribute('data-user_id') ||
    dropdown?.getAttribute('data-user-id') ||
    profile?.getAttribute('href')?.match(/^\/user\/(\d+)(?:\/|$)/)?.[1];
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
