"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  mediaFile: File | null;
  // Source-time window for the visible region (start/end in seconds). The
  // canvas renders peaks for this slice only — passing the full edited-time
  // window via the kept-range mapping keeps the visual aligned with the
  // ripple view.
  sourceStart: number;
  sourceEnd: number;
  width: number;
  height: number;
  color?: string;
}

// Decoded peak buffer is keyed by File.name+size+lastModified — same file
// handed to two lanes shouldn't decode twice. Decoding a 30-min mov can take
// 1–3s; we don't want to pay that cost per ClipBlock.
type PeakCache = { peaks: Float32Array; sampleRate: number; duration: number };
const peakCache = new Map<string, Promise<PeakCache>>();

function fileKey(f: File): string {
  return `${f.name}__${f.size}__${f.lastModified}`;
}

// Decode the audio track to a peak map. We downsample to a fixed bucket count
// at decode time so per-frame redraws are cheap — picking a bucket count that
// comfortably exceeds the widest possible canvas avoids visible aliasing on
// zoom-in.
const PEAK_BUCKETS = 8000;

async function decodePeaks(file: File): Promise<PeakCache> {
  const arrayBuffer = await file.arrayBuffer();
  // Webkit prefix is gone in modern browsers; cast handles older tooling.
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const ch = buf.numberOfChannels > 0 ? buf.getChannelData(0) : new Float32Array(0);
    const buckets = Math.min(PEAK_BUCKETS, ch.length);
    const peaks = new Float32Array(buckets);
    if (buckets > 0) {
      const step = ch.length / buckets;
      for (let i = 0; i < buckets; i++) {
        const s = Math.floor(i * step);
        const e = Math.min(ch.length, Math.floor((i + 1) * step));
        let max = 0;
        for (let j = s; j < e; j++) {
          const v = Math.abs(ch[j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
    }
    return { peaks, sampleRate: buf.sampleRate, duration: buf.duration };
  } finally {
    // Free the GPU-adjacent decoder context.
    if (typeof ctx.close === "function") void ctx.close();
  }
}

function getPeaks(file: File): Promise<PeakCache> {
  const k = fileKey(file);
  let p = peakCache.get(k);
  if (!p) {
    p = decodePeaks(file).catch((e) => {
      // Decode failure (e.g. video container without an audio track decodable
      // by AudioContext) — return an empty buffer so the lane just stays flat.
      console.warn("Waveform decode failed:", e);
      return { peaks: new Float32Array(0), sampleRate: 0, duration: 0 };
    });
    peakCache.set(k, p);
  }
  return p;
}

export function WaveformCanvas({
  mediaFile,
  sourceStart,
  sourceEnd,
  width,
  height,
  color = "rgba(167, 243, 208, 0.85)",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [data, setData] = useState<PeakCache | null>(null);

  useEffect(() => {
    if (!mediaFile) {
      setData(null);
      return;
    }
    let cancelled = false;
    getPeaks(mediaFile).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaFile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!data || data.peaks.length === 0 || data.duration <= 0 || sourceEnd <= sourceStart) {
      // Flat baseline so the lane still reads as audio when decoding fails.
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, h / 2 - 0.5, w, 1);
      return;
    }

    const startBucket = Math.max(0, Math.floor((sourceStart / data.duration) * data.peaks.length));
    const endBucket = Math.min(data.peaks.length, Math.ceil((sourceEnd / data.duration) * data.peaks.length));
    const span = Math.max(1, endBucket - startBucket);
    const mid = h / 2;
    ctx.fillStyle = color;

    // One vertical bar per output pixel — pick the max peak inside the bucket
    // span that maps to that pixel. Subpixel-perfect is not the goal; visible
    // amplitude variation is.
    for (let x = 0; x < w; x++) {
      const bs = startBucket + Math.floor((x / w) * span);
      const be = startBucket + Math.floor(((x + 1) / w) * span);
      let peak = 0;
      for (let i = bs; i < be && i < data.peaks.length; i++) {
        if (data.peaks[i] > peak) peak = data.peaks[i];
      }
      const half = Math.max(0.5, peak * (h / 2 - 1));
      ctx.fillRect(x, mid - half, 1, half * 2);
    }
  }, [data, sourceStart, sourceEnd, width, height, color]);

  return <canvas ref={canvasRef} className="block" />;
}
