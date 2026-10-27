export const problemCopyOptions = ['source', 'description', 'hideOriginal'] as const;
export type ProblemCopyOption = (typeof problemCopyOptions)[number];
export type ProblemCopySettings = Readonly<Record<ProblemCopyOption, boolean>>;

export const isProblemCopyOption = (value: unknown): value is ProblemCopyOption =>
  typeof value === 'string' && problemCopyOptions.some((option) => option === value);

export const defaultProblemCopySettings = (): ProblemCopySettings => ({
  source: true,
  description: true,
  hideOriginal: false,
});

export function decodeProblemCopySettings(value: unknown): ProblemCopySettings {
  const defaults = defaultProblemCopySettings();
  if (value === undefined) return defaults;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('复制题面设置无效。');
  const settings = { ...defaults };
  for (const option of problemCopyOptions) {
    const enabled = (value as Record<string, unknown>)[option];
    if (enabled !== undefined && typeof enabled !== 'boolean')
      throw new Error('复制题面设置无效。');
    if (enabled !== undefined) settings[option] = enabled;
  }
  return settings;
}
