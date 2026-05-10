# Instruction: Fixing Timeline UX (Accidental Deletions & "Wild" Dragging)

## Objective
Fix the critical UX bugs in `Timeline.tsx` where:
1.  **Accidental Deletion**: Shrinking a clip's edge past its last/first word causes the clip to disappear (delete) instead of just becoming very small.
2.  **"Wild" Dragging**: The clip lags behind the cursor or behaves "rubbery" due to CSS transitions being active during a live drag.
3.  **Performance Stutter**: The timeline re-renders too aggressively during drags.

---

## Step 1: Disable CSS Transitions during Drag
In `ClipBlock`, the `style` object applies a 220ms transition to `left` and `width`. This is great for ripple animations but terrible for active dragging.

### Action:
1.  Add a `isDragging` state or check if the handle is active.
2.  Dynamically set `transitionDuration` to `0ms` (or `none`) when dragging.

**Code to target:**
```tsx
// Inside ClipBlock (around line 1442)
style={{
  left: `${(clip.range.editedStart / editedDuration) * 100}%`,
  width: `${((clip.range.editedEnd - clip.range.editedStart) / editedDuration) * 100}%`,
  minWidth: 3,
  transitionProperty: "left, width, background-color, box-shadow",
  transitionDuration: isDragging ? "0ms" : "220ms, 220ms, 75ms, 75ms", // FIX THIS
  transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
}}
```

---

## Step 2: Prevent Accidental Clip Deletion
The logic in `handleEdgePointerDown` (lines 1326-1333) adds words to `nextDeleted` as the user shrinks the clip. If the user drags the right edge left past the start of the first word, the `nextDeleted` set will include all words, and the `editMap` will collapse the kept range to zero.

### Action:
1.  Modify the `onMove` loop to ensure at least one word remains "kept" if the drag is an "adjustment" rather than a deliberate "delete" keypress.
2.  Alternatively, clamp the `target` time so it cannot cross the opposite boundary plus a small margin (e.g., 0.1s).

**Logic to refine:**
In `handleEdgePointerDown` -> `onMove`:
```tsx
// Around line 1293
if (side === "right") {
  // Add a small buffer so target can't equal or cross clipMinSrc
  target = target > initSrc
    ? Math.min(target, limits.rightLimit)
    : Math.max(target, clipMinSrc + 0.05); // 50ms minimum buffer
} else {
  target = target < initSrc
    ? Math.max(target, limits.leftLimit)
    : Math.min(target, clipMaxSrc - 0.05); // 50ms minimum buffer
}
```

---

## Step 3: Optimize Store Updates
Currently, `useEditorStore.setState` is called inside `onMove`. This triggers a massive re-render of the entire `Timeline` component (1500+ lines).

### Action:
1.  **Debounce or Throttling**: Use `requestAnimationFrame` to ensure we don't update the store more than once per frame.
2.  **Local Preview**: Instead of updating the global store `deletedWordIds` and `clipTrims` on every pixel, consider using a local state in `Timeline` or `ClipBlock` for the "drag preview" and only commit to the store `onUp`.
    - *Note*: This is complex because `buildEditMap` is reactive. The simplest quick fix is `requestAnimationFrame`.

---

## Step 4: Verification
1.  **Test Trimming**: Drag the right edge of a clip all the way to the left. The clip should stay visible as a tiny sliver and NOT disappear.
2.  **Test Drag Smoothness**: The clip should follow the cursor perfectly without any "rubbery" lag.
3.  **Test Performance**: Ensure the timeline doesn't stutter when dragging, even with many clips.

## Summary of Files to Modify
- `frontend/components/editor/Timeline.tsx` (Specifically `handleEdgePointerDown` and `ClipBlock`'s return style).
