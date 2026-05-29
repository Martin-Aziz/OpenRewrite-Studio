"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RewriteMode, RewriteProvider, RewriteTone } from "@/lib/contracts";

interface StudioState {
  // Persisted fields
  mode: RewriteMode;
  tone: RewriteTone;
  provider: RewriteProvider;
  strength: number;
  meaningLock: boolean;

  // Session-only fields
  isStreaming: boolean;
  streamingChunks: string[];
  historyFilter: "all" | "accepted" | "rejected";
  sortOrder: "newest" | "oldest";

  // Setters for persisted fields
  setMode: (mode: RewriteMode) => void;
  setTone: (tone: RewriteTone) => void;
  setProvider: (provider: RewriteProvider) => void;
  setStrength: (strength: number) => void;
  setMeaningLock: (meaningLock: boolean) => void;

  // Setters for session-only fields
  setHistoryFilter: (f: "all" | "accepted" | "rejected") => void;
  setSortOrder: (o: "newest" | "oldest") => void;
  appendStreamChunk: (chunk: string) => void;
  setStreaming: (v: boolean) => void;
  clearStreamChunks: () => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set) => ({
      // Persisted defaults
      mode: "humanize",
      tone: "warm",
      provider: "ollama",
      strength: 58,
      meaningLock: true,

      // Session-only defaults
      isStreaming: false,
      streamingChunks: [],
      historyFilter: "all",
      sortOrder: "newest",

      // Setters for persisted fields
      setMode: (mode) => set({ mode }),
      setTone: (tone) => set({ tone }),
      setProvider: (provider) => set({ provider }),
      setStrength: (strength) => set({ strength }),
      setMeaningLock: (meaningLock) => set({ meaningLock }),

      // Setters for session-only fields
      setHistoryFilter: (historyFilter) => set({ historyFilter }),
      setSortOrder: (sortOrder) => set({ sortOrder }),
      appendStreamChunk: (chunk) =>
        set((state) => ({ streamingChunks: [...state.streamingChunks, chunk] })),
      setStreaming: (isStreaming) => set({ isStreaming }),
      clearStreamChunks: () => set({ streamingChunks: [] }),
    }),
    {
      name: "openrewrite-studio-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        tone: state.tone,
        strength: state.strength,
        provider: state.provider,
        meaningLock: state.meaningLock,
      }),
    }
  )
);
