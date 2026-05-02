"use client";

import { useCallback, useEffect, useState } from "react";

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
}

const CLOSED: ContextMenuState = { isOpen: false, x: 0, y: 0 };

export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState>(CLOSED);

  const open = useCallback((x: number, y: number) => {
    setState({ isOpen: true, x, y });
  }, []);

  const close = useCallback(() => {
    setState((prev) => (prev.isOpen ? CLOSED : prev));
  }, []);

  useEffect(() => {
    if (!state.isOpen) return;

    const handlePointerDown = () => close();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const handleScroll = () => close();

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("contextmenu", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("contextmenu", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [state.isOpen, close]);

  return { ...state, open, close };
}
