import type { Scope } from '../core/scope';

// Content-script-local preview: no storage writes or page-script events during dragging.
const listeners = new Set<(value: number | undefined) => void>();

export function previewBackgroundOverlay(value: number | undefined): void {
  for (const listener of listeners) listener(value);
}

export function watchBackgroundPreview(
  scope: Scope,
  listener: (value: number | undefined) => void,
): void {
  listeners.add(listener);
  scope.defer(() => listeners.delete(listener));
}
