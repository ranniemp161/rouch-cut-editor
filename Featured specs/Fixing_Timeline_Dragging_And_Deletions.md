# Spec: Fixing Timeline Drag Interaction — Segment Adjustment vs. Accidental Deletion

---

## Objective

Resolve the critical UX regression in `Timeline.tsx` (`ClipBlock` / `handleEdgePointerDown`) where:
- Dragging a segment **edge handle** to adjust a clip's in/out point **accidentally deletes the entire clip** instead of adjusting its boundary.
- The interaction model does not distinguish between a deliberate **Delete** action (keyboard shortcut / right-click menu) and a casual **trim drag** (grabbing a clip edge to adjust).

The goal is to make edge-handle dragging a **safe, non-destructive trim operation** that can only reduce a clip to a minimum visible width, never zero.

---

## Background — Root Cause Analysis

The current `handleEdgePointerDown → onMove` loop modifies `deletedWordIds` live on every `pointermove`. When the user drags an edge **inward** past word boundaries, words are added to `deletedWordIds`. If the drag overshoots and covers ALL words inside the clip:

1. `nextDeleted` ends up containing every word in the kept range.
2. `buildEditMap` sees no kept words, so the kept range collapses to zero duration.
3. The clip **vanishes from the timeline** — visually identical to pressing Backspace.

The user experiences this as "I tried to adjust a segment and it disappeared."

Additional contributing factors:
1. **Component remounting mid-drag**: `ClipBlock` keys are derived from the first kept word ID (`clip.keptWordIds[0]`). When an inward drag deletes that word, the key changes → React unmounts the old component and mounts a fresh one → `isDragging` state resets → the 220ms CSS transition fires → the clip "snaps" and lags rather than tracking the cursor.
2. **No visual feedback** distinguishing "trim (safe)" from "delete (destructive)": both look the same until the clip disappears.
3. **Anchor word vulnerability**: if the clip's anchor word (the first kept word, used by `buildEditMap` to look up the `clipTrims` record) is swept into the deleted zone, the trim entry becomes orphaned and the clip's position is recalculated incorrectly on the next render.

---

## Issues Summary

| # | Issue | Severity | Affected Code |
|---|-------|----------|---------------|
| 1 | Inward drag deletes the clip when all words are swept | 🔴 Critical | `handleEdgePointerDown → onMove` (line ~1346–1352) |
| 2 | Component remounts on word-ID key change during drag | 🔴 Critical | `TrackLane` clip key (line ~1112) |
| 3 | No minimum clip width enforced on the shrink path | 🔴 Critical | `inwardFloor` clamping logic (line ~1304–1311) |
| 4 | CSS transition fires mid-drag causing rubbery lag | 🟡 High | `ClipBlock` style `transitionDuration` (line ~1485) |
| 5 | Anchor word swept into deletion orphans the trim record | 🟡 High | `onMove` → `nextTrim` computation (line ~1387–1390) |
| 6 | No visual cue for "restore vs. shrink" during drag | 🟠 Medium | `ClipBlock` render, no `restoring` prop passed down |

---

## Step-by-Step Implementation Instructions

### Step 1 — Stabilize `ClipBlock` Keys (Prevent Mid-Drag Remounting)

**File:** `frontend/components/editor/Timeline.tsx`
**Location:** `TrackLane` component, the `clips.map(...)` block (~line 1110–1125)

**Current code (problem):**
```tsx
<ClipBlock
  key={`${tone}-${clip.keptWordIds[0] ?? clip.range.sourceStart}-${i}`}
  ...
/>
```

**Fix:** Key on `clip.range.sourceStart` + the lane tone. Source-start is immutable for the lifetime of a trim drag (only edges move, the identity of the clip does not change).

```tsx
<ClipBlock
  key={`${tone}-${clip.range.sourceStart.toFixed(4)}-${i}`}
  ...
/>
```

**Why:** React's reconciler uses the key to decide whether to reuse or remount a component. Keying on a word ID that gets toggled during the drag causes unmount/mount cycles, which reset the `isDragging` local state and trigger the full 220ms CSS transition on every word-boundary crossing.

---

### Step 2 — Enforce a Hard Minimum Clip Width on the Inward Drag

**File:** `frontend/components/editor/Timeline.tsx`
**Location:** `handleEdgePointerDown → onMove`, the inward-floor clamping block (~lines 1303–1320)

**Current code (problem):**
```tsx
const MIN_DRAG_CLIP = 0.05;

const inwardFloorRight =
  anchorId === null
    ? clipMinSrc + MIN_DRAG_CLIP
    : Math.max(clipMinSrc + MIN_DRAG_CLIP, anchorStart + EPS);
const inwardFloorLeft =
  anchorId === null
    ? clipMaxSrc - MIN_DRAG_CLIP
    : Math.min(clipMaxSrc - MIN_DRAG_CLIP, anchorEnd - EPS);
```

The `anchorStart + EPS` / `anchorEnd - EPS` floor is correct in principle but is only 1ms past the anchor word. If the anchor word is the *only* remaining word and it's very short (e.g. 60ms), the floor allows the drag to sweep all other words while the anchor itself gets deleted in the next frame because `w.end <= hi` passes.

**Fix — raise the floor and anchor it to the clip's absolute extremes:**

```tsx
// Minimum kept duration: 100ms is large enough to be visible at any zoom
// level and small enough not to prevent legitimate tight trims.
const MIN_DRAG_CLIP = 0.10; // raised from 0.05 → 0.10

// The inward floor must guarantee the clip NEVER collapses to zero.
// We compute it from the clip's absolute source boundaries (clipMinSrc /
// clipMaxSrc), not from the anchor word — the anchor can itself be near
// the edge, making an EPS-based floor too tight.
const inwardFloorRight = clipMinSrc + MIN_DRAG_CLIP;
const inwardFloorLeft  = clipMaxSrc - MIN_DRAG_CLIP;

if (side === "right") {
  target = target > initSrc
    ? Math.min(target, limits.rightLimit)          // outward: bounded by neighbour
    : Math.max(target, inwardFloorRight);           // inward: hard floor
} else {
  target = target < initSrc
    ? Math.max(target, limits.leftLimit)            // outward: bounded by neighbour
    : Math.min(target, inwardFloorLeft);            // inward: hard floor
}
```

**Why:** This is the single most important fix. It makes it **physically impossible** for a trim drag to collapse the clip to zero duration, regardless of where word boundaries fall.

---

### Step 3 — Protect the Anchor Word from Being Swept

**File:** `frontend/components/editor/Timeline.tsx`
**Location:** `handleEdgePointerDown → onMove`, the `nextDeleted` loop (~lines 1345–1352)

**Current code (problem):**
```tsx
for (const w of transcriptSnap) {
  if (w.start >= lo && w.end <= hi) {
    if (restoring) nextDeleted.delete(w.id);
    else nextDeleted.add(w.id);
  }
}
```

When shrinking, every word fully inside `[lo, hi]` is added to `nextDeleted` — including the anchor word if it happens to be fully inside the dragged range.

**Fix — skip the anchor word on the shrink path:**

```tsx
for (const w of transcriptSnap) {
  if (w.start >= lo && w.end <= hi) {
    if (restoring) {
      nextDeleted.delete(w.id);
    } else {
      // Never mark the anchor as deleted during a trim drag.
      // The anchor is the word buildEditMap uses to look up the
      // clipTrims record. If it gets deleted, the trim entry
      // becomes orphaned and the clip's boundary is recalculated
      // incorrectly on the next render.
      if (w.id !== anchorId) nextDeleted.add(w.id);
    }
  }
}
```

**Why:** The anchor word is the stable identity of the clip for `buildEditMap`. Protecting it during a drag ensures the trim record always lands inside a valid kept range.

---

### Step 4 — Fix `isDragging` Not Surviving Component Remounts

After Step 1 stabilizes the key, this is a belt-and-suspenders fix for the rare case where a remount still occurs.

**File:** `frontend/components/editor/Timeline.tsx`
**Location:** `ClipBlock` function (~line 1470)

**Action:** Move `isDragging` from `useState` to a `useRef` so it survives React's StrictMode double-invocation and any edge-case remounts. Read the ref in the style object.

```tsx
// Replace:
const [isDragging, setIsDragging] = useState(false);

// With:
const isDraggingRef = useRef(false);
const [isDraggingRender, setIsDraggingRender] = useState(false);

// In handleEdgePointerDown:
isDraggingRef.current = true;
setIsDraggingRender(true);   // only to trigger a re-render for the style

// In onUp:
isDraggingRef.current = false;
setIsDraggingRender(false);
```

Then in the style object use `isDraggingRender` (the state mirror) for the transition toggle.

---

### Step 5 — Suppress CSS Transitions During Active Drag

**File:** `frontend/components/editor/Timeline.tsx`
**Location:** `ClipBlock` return JSX, the `style` prop of the outer `<div>` (~line 1484–1486)

**Current code:**
```tsx
transitionDuration: isDragging ? "0ms" : "220ms, 220ms, 75ms, 75ms",
```

This is already correct in intent. After Step 1 & 4 ensure `isDragging` is `true` throughout the gesture without a reset, this will work as intended. Verify this is firing correctly by logging to the console during a drag.

---

### Step 6 — Add Visual Feedback: "Restoring" vs. "Shrinking"

**File:** `frontend/components/editor/Timeline.tsx`
**Location:** `ClipBlockProps` interface + `ClipBlock` render

**Action:** Thread a `isDragRestoring: boolean | null` prop (null = not dragging, true = expanding, false = shrinking) into `ClipBlock` so it can show a colored overlay.

**In `handleEdgePointerDown → onMove`:**
```tsx
// After computing `restoring`:
// Pass up to parent via a callback, e.g.:
onDragStateChange({ id: clip.range.sourceStart, restoring });
```

**In `ClipBlock` render, add an overlay div:**
```tsx
{isDragRestoring !== null && (
  <div
    className="absolute inset-0 pointer-events-none rounded-[2px]"
    style={{
      background: isDragRestoring
        ? "rgba(52, 211, 153, 0.25)"   // green tint = restoring content
        : "rgba(239, 68, 68, 0.20)",   // red tint = removing content
    }}
  />
)}
```

**Why:** This gives the user an immediate, clear signal about what their drag will do — critical for building trust that the tool won't accidentally delete content.

---

### Step 7 — Verification Checklist

After implementing the above changes, test all of the following scenarios:

| Test | Expected Result | Pass/Fail |
|------|----------------|-----------|
| Drag right edge inward to the far left | Clip shrinks to minimum (≥100ms), does NOT disappear | |
| Drag left edge inward to the far right | Same as above | |
| Drag right edge outward into cut zone | Clip expands and words are restored (green tint) | |
| Drag left edge outward into cut zone | Same as above | |
| Drag any edge rapidly back and forth | No "rubber band" lag, no component remount flash | |
| Drag to snap point (outward to neighbour edge) | Cyan snap guide line appears | |
| Click (no drag) on clip body | Clip is selected, NOT accidentally trimmed | |
| Click (no drag) on edge handle | Handle activates but does not delete anything | |
| Undo after a trim drag | Clip returns to pre-drag state | |
| Zoom in to 10× and try trimming | Handles remain functional and responsive | |

---

## Files to Modify

| File | Section | Change Type |
|------|---------|-------------|
| `frontend/components/editor/Timeline.tsx` | `TrackLane` → `clips.map` key | Key stabilization |
| `frontend/components/editor/Timeline.tsx` | `handleEdgePointerDown` → `MIN_DRAG_CLIP` + clamping | Bug fix (critical) |
| `frontend/components/editor/Timeline.tsx` | `handleEdgePointerDown` → `nextDeleted` loop | Bug fix (anchor protection) |
| `frontend/components/editor/Timeline.tsx` | `ClipBlock` `isDragging` state | Refactor to ref + state mirror |
| `frontend/components/editor/Timeline.tsx` | `ClipBlock` return JSX overlay | UX enhancement (visual feedback) |
