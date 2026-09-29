import { editorName, pdfEnabled } from './edition';

// Metadata is safe to import in the popup, worker, and content script.
export const moduleCatalog = [
  {
    id: 'homework',
    title: editorName,
    description: pdfEnabled
      ? '在线作答、导出图片和 PDF、提交 PDF，以及折叠已提交作业。'
      : '在线作答、导出和提交图片，以及折叠已提交作业。',
    defaultEnabled: true,
  },
  {
    id: 'ui-polish',
    title: '界面微调',
    description: '调整导航、面板和表格的配色与间距。',
    defaultEnabled: true,
  },
  {
    id: 'local-avatars',
    title: '本地头像',
    description: '',
    defaultEnabled: true,
  },
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
