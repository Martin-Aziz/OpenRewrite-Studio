"use client";

import { create } from "zustand";
import type { RewriteMode, RewriteProvider, RewriteTone } from "@/lib/contracts";

interface StudioState {
  mode: RewriteMode;
  tone: RewriteTone;
  provider: RewriteProvider;
  strength: number;
  meaningLock: boolean;
  setMode: (mode: RewriteMode) => void;
  setTone: (tone: RewriteTone) => void;
  setProvider: (provider: RewriteProvider) => void;
  setStrength: (strength: number) => void;
  setMeaningLock: (meaningLock: boolean) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  mode: "humanize",
  tone: "warm",
  provider: "ollama",
  strength: 58,
  meaningLock: true,
  setMode: (mode) => set({ mode }),
  setTone: (tone) => set({ tone }),
  setProvider: (provider) => set({ provider }),
  setStrength: (strength) => set({ strength }),
  setMeaningLock: (meaningLock) => set({ meaningLock })
}));
