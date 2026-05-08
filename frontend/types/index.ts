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
  /**
   * Action Marker — a placeholder phrase from the raw recording such as
   * "play clip 2 here" or "include the substack call to action". Not a
   * deletion: the transcript / timeline render markers in a distinct colour
   * so the editor knows where to drop the external asset.
   */
  isMarker?: boolean;
}
