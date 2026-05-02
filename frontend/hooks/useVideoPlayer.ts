import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore, type TranscriptSegment } from "@/store/useEditorStore";
import { buildEditMap } from "@/lib/editMap";

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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const seekTime = useEditorStore((s) => s.seekTime);
  const setSeekTime = useEditorStore((s) => s.setSeekTime);
  const setStoreCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const transcript = useEditorStore((s) => s.transcript);
  const deletedWordIds = useEditorStore((s) => s.deletedWordIds);

  // Single source of truth for cut-skipping: the same edit map the timeline
  // uses to render the ripple view. Re-derived whenever deletions change.
  const editMap = useMemo(
    () => buildEditMap(transcript, deletedWordIds, segments, duration),
    [transcript, deletedWordIds, segments, duration],
  );
  const deletedRuns = editMap.deletedRegions;

  // Object URL lifecycle — created on file change, revoked on cleanup.
  useEffect(() => {
    if (!mediaFile) {
      setVideoUrl(null);
      setDuration(0);
      setCurrentTime(0);
      return;
    }
    const url = URL.createObjectURL(mediaFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  // Native `timeupdate` only fires ~4Hz, which lets up to 250ms of a deleted
  // word leak through before we can skip. We instead drive cut-skipping from
  // an rAF loop while the video is playing (see useEffect below). The native
  // handler stays as a cheap fallback to keep state in sync during seeks /
  // pauses where the rAF loop isn't running.
  const handleTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setCurrentTime(t);
    setStoreCurrentTime(t);
  }, [setStoreCurrentTime]);

  // Ref so the rAF loop reads the latest cut data without restarting.
  const deletedRunsRef = useRef(deletedRuns);
  useEffect(() => { deletedRunsRef.current = deletedRuns; }, [deletedRuns]);

  // 60Hz cut-skip loop. Only runs while the video is actually playing —
  // when paused, the native `timeupdate` is enough.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) {
        const t = v.currentTime;
        const deleted = deletedRunsRef.current.find((r) => t >= r.start && t < r.end);
        if (deleted) v.currentTime = deleted.end;
        setCurrentTime(v.currentTime);
        setStoreCurrentTime(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, setStoreCurrentTime]);

  const handleLoadedMetadata = useCallback(() => {
    setDuration(videoRef.current?.duration ?? 0);
  }, []);

  const handleEnded = useCallback(() => setIsPlaying(false), []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setIsPlaying(true);
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.catch((error: any) => {
          if (error?.name !== "AbortError") {
            console.error("Video play failed:", error);
            setIsPlaying(false);
          }
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

  const seekTo = useCallback((t: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = t;
    setCurrentTime(t);
    setStoreCurrentTime(t);
  }, [setStoreCurrentTime]);

  // Drive playback from the store's seekTime: any caller that does
  // setSeekTime(t) — the transcript, the timeline scrubber, etc. — moves
  // the video here. We consume it back to null so the same time can be
  // re-issued (e.g. clicking the same word twice still seeks).
  useEffect(() => {
    if (seekTime === null) return;
    if (videoRef.current) {
      videoRef.current.currentTime = seekTime;
      setCurrentTime(seekTime);
      setStoreCurrentTime(seekTime);
    }
    setSeekTime(null);
  }, [seekTime, setSeekTime, setStoreCurrentTime]);

  const skipBack = useCallback(() => seekTo(0), [seekTo]);
  const skipForward = useCallback(() => seekTo(duration), [seekTo, duration]);
  const stepBack = useCallback(
    (fps: number) => seekTo(Math.max(0, currentTime - 1 / fps)),
    [seekTo, currentTime]
  );
  const stepForward = useCallback(
    (fps: number) => seekTo(Math.min(duration, currentTime + 1 / fps)),
    [seekTo, currentTime, duration]
  );

  return {
    videoRef,
    videoUrl,
    isPlaying,
    currentTime,
    duration,
    volume,
    setVolume,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleEnded,
    togglePlay,
    pause,
    seekTo,
    skipBack,
    skipForward,
    stepBack,
    stepForward,
  };
}
