export interface CodeEditorLayoutRequest {
  readonly channel: 'asterveil';
  readonly type: 'code-editor.layout';
  readonly fonts: boolean;
}

export function isCodeEditorLayoutRequest(value: unknown): value is CodeEditorLayoutRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    request.channel === 'asterveil' &&
    request.type === 'code-editor.layout' &&
    typeof request.fonts === 'boolean'
  );
}
