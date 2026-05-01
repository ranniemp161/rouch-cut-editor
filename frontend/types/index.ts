/**
 * A single word produced by the speech-to-text layer.
 * `id` is a stable, application-generated identifier so we can use it as a
 * React key and as the deletion-set member without depending on the word
 * text (which may repeat) or its index (which is not stable across edits).
 */
export interface WordTimestamp {
  id: string;
  word: string;
  start: number;
  end: number;
}
