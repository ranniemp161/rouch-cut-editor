import { buildEditMap, EMPTY_EDIT_MAP } from '../lib/editMap';

self.onmessage = (e: MessageEvent) => {
  try {
    const { transcript, deletedWordIds, segments, sourceDuration, clipTrims } = e.data;
    if (!transcript || !deletedWordIds) {
      self.postMessage(EMPTY_EDIT_MAP);
      return;
    }
    const deletedSet = new Set<string>(deletedWordIds);
    const result = buildEditMap(transcript, deletedSet, segments, sourceDuration, clipTrims);
    self.postMessage(result);
  } catch (error) {
    console.error("EditMap Worker error:", error);
  }
};
