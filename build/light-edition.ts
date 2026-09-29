import type { Plugin } from 'vite';

// Catch accidental PDF imports even if their buttons are hidden in the light UI.
export function lightEdition(): Plugin {
  const disabled = '\0light-pdf-disabled';
  return {
    name: 'verify-light-edition',
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        importer?.replaceAll('\\', '/').endsWith('/features/homework/index.ts') &&
        (source === './pdf' || source === './pdf-export')
      )
        return disabled;
    },
    load(id) {
      if (id === disabled)
        return 'export function createPdf() { throw new Error("PDF requires Markdown Editor Pro"); } export const pdfToImage = createPdf;';
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          if (/node_modules[/\\](?:pdfjs-dist|pdf-lib|@pdf-lib)[/\\]/.test(id))
            this.error(`PDF dependency included in light edition: ${id}`);
        }
      }
    },
  };
}
