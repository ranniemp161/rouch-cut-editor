import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "@/store/useEditorStore";

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

  // Cut-aware time update: jump over any segment marked as a cut.
  const handleTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    setCurrentTime(t);
    const activeCut = segments.find((s) => s.isCut && t >= s.startS && t < s.endS);
    if (activeCut && videoRef.current) {
      videoRef.current.currentTime = activeCut.endS;
    }
  }, [segments]);

  const handleLoadedMetadata = useCallback(() => {
    setDuration(videoRef.current?.duration ?? 0);
  }, []);

  const handleEnded = useCallback(() => setIsPlaying(false), []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
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
  }, []);

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
