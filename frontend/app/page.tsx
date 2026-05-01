"use client";

import { useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import MainEditor from "@/components/MainEditor";
import { useEditorStore, rehydrateAuth } from "@/store/useEditorStore";

export default function Page() {
  // Block render until after the first client-side paint so the store's
  // localStorage rehydration never causes a server/client HTML mismatch.
  const [mounted, setMounted] = useState(false);
  const isAuthenticated = useEditorStore((s) => s.isAuthenticated);

  useEffect(() => {
    rehydrateAuth();
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return isAuthenticated ? <MainEditor /> : <AuthGate />;
}
