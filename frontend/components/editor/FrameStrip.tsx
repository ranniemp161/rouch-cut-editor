"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFrame, THUMB_W } from "@/lib/frameCache";

interface Props {
  mediaFile: File | null;
  // Source-time window for the clip. Frames are sampled at the midpoint of
  // each visible slot, then snapped to the cache's 2-second bucket so
  // adjacent clips share decode cost.
  sourceStart: number;
  sourceEnd: number;
  width: number;
  height: number;
}

interface Slot {
  left: number;
  width: number;
  bucket: number;
}

// One thumbnail per ~`THUMB_W` of clip width — denser sampling looks busy
// and burns decode time without adding information at typical zoom levels.
function buildSlots(width: number, sourceStart: number, sourceEnd: number): Slot[] {
  const dur = sourceEnd - sourceStart;
  if (dur <= 0 || width <= 0) return [];
  const count = Math.max(1, Math.floor(width / THUMB_W));
  const slotW = width / count;
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const t = sourceStart + (dur * (i + 0.5)) / count;
    slots.push({ left: i * slotW, width: slotW, bucket: t });
  }
  return slots;
}

export function FrameStrip({ mediaFile, sourceStart, sourceEnd, width, height }: Props) {
  // Slots derive purely from props — useMemo keeps them out of the effect
  // body so we don't trigger the cascading-render lint.
  const slots = useMemo(
    () => buildSlots(width, sourceStart, sourceEnd),
    [width, sourceStart, sourceEnd],
  );

  // Resolved dataURLs keyed by bucket. The async getFrame() callback writes
  // here; the synchronous render reads. New requests skip buckets we've
  // already fulfilled or have in-flight.
  const [srcs, setSrcs] = useState<Record<number, string | null>>({});
  const inflightRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!mediaFile || height <= 0) return;
    let cancelled = false;

    for (const slot of slots) {
      const bucket = slot.bucket;
      if (inflightRef.current.has(bucket)) continue;
      // Reading from `srcs` here would force the effect to depend on it and
      // re-run after each fetch settles — instead, we let getFrame()'s own
      // cache absorb dupes and skip set-state when the value matches.
      inflightRef.current.add(bucket);
      getFrame(mediaFile, bucket).then((src) => {
        inflightRef.current.delete(bucket);
        if (cancelled) return;
        setSrcs((prev) => (prev[bucket] === src ? prev : { ...prev, [bucket]: src }));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [mediaFile, slots, height]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {slots.map((s, i) => {
        const src = srcs[s.bucket];
        return (
          <div
            key={`${i}-${s.bucket}`}
            className="absolute top-0 bottom-0"
            style={{ left: s.left, width: s.width }}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                draggable={false}
                className="block w-full h-full object-cover select-none"
              />
            ) : (
              <div className="w-full h-full bg-purple-700/40" />
            )}
          </div>
        );
      })}
    </div>
  );
}
