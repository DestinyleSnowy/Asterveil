export const targetSites = [
  { label: '外网入口', origin: 'https://jx.7fa4.cn:8888' },
  { label: '内网入口', origin: 'https://in.7fa4.cn:8888' },
] as const;

// Host-only patterns keep the manifest portable. Runtime checks enforce the port.
export const contentMatches = targetSites.map(
  ({ origin }) => `https://${new URL(origin).hostname}/*`,
);

export type TargetSite = (typeof targetSites)[number];

export function resolveSite(url: URL): TargetSite | undefined {
  return targetSites.find((site) => site.origin === url.origin);
}
