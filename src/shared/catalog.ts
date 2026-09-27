// Metadata is safe to import in the popup, worker, and content script.
export const moduleCatalog = [
  {
    id: 'keyboard-focus',
    title: '键盘焦点',
    description: '为键盘选中的链接、按钮与输入框显示清晰轮廓。',
    defaultEnabled: false,
  },
] as const;

export type ModuleId = (typeof moduleCatalog)[number]['id'];

export function isModuleId(value: unknown): value is ModuleId {
  return moduleCatalog.some((module) => module.id === value);
}
