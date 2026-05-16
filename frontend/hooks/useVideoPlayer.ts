import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore, type TranscriptSegment } from "@/store/useEditorStore";
import { buildEditMap, sourceToEdited, editedToSource, type EditMap } from "@/lib/editMap";

// How far before a deleted region we issue the seek. Browser seeks have
// 30–150ms of latency, so a purely reactive skip leaks that much deleted
// audio every time. 80ms of look-ahead lets the seek complete *before* the
// audio decoder reaches the cut point. The cost is at most one frame of
// kept audio chopped at the boundary — inaudible vs. hearing the cut word.
const SKIP_LOOKAHEAD_S = 0.12;

// Snap a source-time into the nearest kept range. If the time lands inside
// a deleted region, we jump to the start of the next kept range; if no
// later kept range exists, we clamp back to the previous one's end. Used
// to prevent the playhead from ever being parked inside a cut.
function snapToKept(t: number, map: EditMap): number {
  const inside = map.deletedRegions.find((r) => t >= r.start && t < r.end);
  if (!inside) return t;
  const next = map.keptRanges.find((r) => r.sourceStart >= inside.end);
  if (next) return next.sourceStart;
  const last = map.keptRanges[map.keptRanges.length - 1];
  return last ? last.sourceEnd : t;
}
/**
 * Encapsulates HTMLVideoElement state and provides cut-aware playback.
 *
 * When the playhead enters a segment with `isCut: true`, the video is
 * automatically advanced past the cut — the rough-cut preview behaviour.
 */
export function useVideoPlayer(mediaFile: File | null, segments: TranscriptSegment[]) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceTime, setSourceTime] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const seekTime = useEditorStore((s) => s.seekTime);
  const setSeekTime = useEditorStore((s) => s.setSeekTime);
  const setStoreCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const transcript = useEditorStore((s) => s.transcript);
  const deletedWordIds = useEditorStore((s) => s.deletedWordIds);
  const clipTrims = useEditorStore((s) => s.clipTrims);

  // Single source of truth for cut-skipping: the same edit map the timeline
  // uses to render the ripple view. Re-derived whenever deletions change.
  // clipTrims feeds in so the rAF skip respects sub-word edge nudges — a
  // padEnd of +0.1s lets that 100ms of "deleted" tail actually play.
  const editMap = useMemo(
    () => buildEditMap(transcript, deletedWordIds, segments, sourceDuration, clipTrims),
    [transcript, deletedWordIds, segments, sourceDuration, clipTrims],
  );

  // Object URL lifecycle — created on file change, revoked on cleanup.
  useEffect(() => {
    if (!mediaFile) {
      setVideoUrl(null);
      setSourceDuration(0);
      setSourceTime(0);
      return;
    }
    const url = URL.createObjectURL(mediaFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  const editMapRef = useRef(editMap);
  useEffect(() => { editMapRef.current = editMap; }, [editMap]);

  const editedDuration = editMap.editedDuration;
  const editedTime = useMemo(
    () => sourceToEdited(sourceTime, editMap) ?? 0,
    [sourceTime, editMap]
  );

  // Native `timeupdate` only fires ~4Hz, which lets up to 250ms of a deleted
  // word leak through before we can skip. We instead drive cut-skipping from
  // an rAF loop while the video is playing (see useEffect below). The native
  // handler stays as a cheap fallback to keep state in sync during seeks /
  // pauses where the rAF loop isn't running.
  const handleTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setSourceTime(t);
    setStoreCurrentTime(t);
  }, [setStoreCurrentTime]);

  // 60Hz cut-skip loop. Only runs while the video is actually playing —
  // when paused, the native `timeupdate` is enough.
  //
  // Predictive skip: instead of waiting until we're inside a deleted region
  // (and leaking 50–150ms of seek-latency audio), we issue the seek
  // SKIP_LOOKAHEAD_S seconds *before* the cut point. The lookahead absorbs
  // the seek latency so playback transitions cleanly across every deletion.
  //
  // Seek-storm suppression uses the native `v.seeking` flag, NOT a ref
  // pinned to the target time. With a target-pinned ref, a slow seek (large
  // .mov files seek in 200–500ms) lets `t` advance *into* the deletion
  // while we're locked out of re-issuing — the deletion audio plays through
  // until t reaches r.end. With v.seeking, we re-issue every frame the
  // browser is idle, so a slow seek either lands or gets nudged again.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) {
        const t = v.currentTime;
        const runs = editMapRef.current.deletedRegions;
        // Walk forward to the first region whose end is still ahead of us.
        // Regions are pre-sorted so this is cheap; for thousands of cuts a
        // binary search would be warranted, but we don't get near that scale.
        for (let i = 0; i < runs.length; i++) {
          const r = runs[i];
          if (r.end <= t) continue;
          if (t >= r.start - SKIP_LOOKAHEAD_S && t < r.end && !v.seeking) {
            v.currentTime = r.end;
          }
          break;
        }
        setSourceTime(v.currentTime);
        setStoreCurrentTime(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, setStoreCurrentTime]);

  const handleLoadedMetadata = useCallback(() => {
    setSourceDuration(videoRef.current?.duration ?? 0);
  }, []);

  const handleEnded = useCallback(() => setIsPlaying(false), []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setIsPlaying(true);
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.error("Video play failed:", error);
          setIsPlaying(false);
        });
      }
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const seekToEdited = useCallback((et: number) => {
    if (!videoRef.current) return;
    // editedToSource always lands in a kept range by construction, but pass
    // through snapToKept anyway for symmetry with the seekTime path.
    const st = snapToKept(editedToSource(et, editMapRef.current), editMapRef.current);
    videoRef.current.currentTime = st;
    setSourceTime(st);
    setStoreCurrentTime(st);
  }, [setStoreCurrentTime]);

  // Drive playback from the store's seekTime: any caller that does
  // setSeekTime(t) — the transcript, the timeline scrubber, etc. — moves
  // the video here. We consume it back to null so the same time can be
  // re-issued (e.g. clicking the same word twice still seeks).
  //
  // STRICT DELETION: if the requested time falls inside a deleted region
  // (e.g. user clicked a struck-through word in the transcript), snap to
  // the start of the next kept range instead. The playhead must never park
  // inside a cut — otherwise pressing play would briefly leak the deleted
  // audio before the rAF skip fires.
  useEffect(() => {
    if (seekTime === null) return;
    if (videoRef.current) {
      const target = snapToKept(seekTime, editMapRef.current);
      videoRef.current.currentTime = target;
      setSourceTime(target);
      setStoreCurrentTime(target);
    }
    setSeekTime(null);
  }, [seekTime, setSeekTime, setStoreCurrentTime]);

  const skipBack = useCallback(() => seekToEdited(0), [seekToEdited]);
  const skipForward = useCallback(() => seekToEdited(editedDuration), [seekToEdited, editedDuration]);
  const stepBack = useCallback(
    (fps: number) => seekToEdited(Math.max(0, editedTime - 1 / fps)),
    [seekToEdited, editedTime]
  );
  const stepForward = useCallback(
    (fps: number) => seekToEdited(Math.min(editedDuration, editedTime + 1 / fps)),
    [seekToEdited, editedTime, editedDuration]
  );

  return {
    videoRef,
    videoUrl,
    isPlaying,
    currentTime: editedTime,
    duration: editedDuration,
    volume,
    setVolume,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleEnded,
    togglePlay,
    pause,
    seekTo: seekToEdited,
    skipBack,
    skipForward,
    stepBack,
    stepForward,
  };
}
