import { useState, useEffect, useRef } from "react";
import { type EditMap, EMPTY_EDIT_MAP } from "@/lib/editMap";
import type { WordTimestamp } from "@/types";
import type { TranscriptSegment, ClipTrim } from "@/store/useEditorStore";

export function useEditMap(
  transcript: WordTimestamp[],
  deletedWordIds: Set<string>,
  segments: TranscriptSegment[],
  sourceDuration: number,
  clipTrims: Record<string, ClipTrim>
): EditMap {
  const [editMap, setEditMap] = useState<EditMap>(EMPTY_EDIT_MAP);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/editMap.worker.ts', import.meta.url));
    workerRef.current.onmessage = (e) => setEditMap(e.data);
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    workerRef.current?.postMessage({
      transcript,
      deletedWordIds: Array.from(deletedWordIds),
      segments,
      sourceDuration,
      clipTrims
    });
  }, [transcript, deletedWordIds, segments, sourceDuration, clipTrims]);

  return editMap;
}
