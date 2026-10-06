import type { BackgroundSettings } from '../shared/background';

export function backgroundCss(background: BackgroundSettings): string {
  if (!background.enabled || !background.image) return '';
  // The image is a validated, bounded raster data URL; it cannot inject CSS or fetch a URL.
  return `@media screen {
    html[data-asterveil-appearance="polished"][data-asterveil-page] {
      --av-background-overlay: color-mix(in srgb, var(--av-canvas) var(--av-background-strength, ${background.overlay}%), transparent);
      background: linear-gradient(var(--av-background-overlay), var(--av-background-overlay)), url("${background.image}") center / cover no-repeat fixed;
      background-color: var(--av-canvas);
    }
    html[data-asterveil-appearance="polished"][data-asterveil-page] body,
    html[data-asterveil-appearance="polished"][data-asterveil-page] body > .pusher {
      /* Semantic UI's body.pushable uses an important gray background. */
      background: transparent !important;
    }
    html[data-asterveil-appearance="polished"][data-asterveil-page] :is(
      #show_tag,
      .ui.center.aligned.container > span:has(> a[href*="beian.miit.gov.cn"])
    ) {
      display: inline-block;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--av-paper) 94%, transparent);
      color: var(--av-text);
    }
    html[data-asterveil-appearance="polished"][data-asterveil-page] #show_tag > label {
      color: var(--av-text) !important;
    }
    html[data-asterveil-appearance="polished"][data-asterveil-page] .ui.center.aligned.container > span > a {
      color: color-mix(in srgb, var(--av-accent) 80%, var(--av-text));
    }
  }`;
}
