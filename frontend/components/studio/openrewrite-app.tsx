"use client";

import React, { Component, useCallback, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  Clipboard,
  Download,
  FileClock,
  Filter,
  Gauge,
  History,
  KeyRound,
  Loader2,
  Lock,
  Moon,
  PanelRight,
  PenLine,
  Plus,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Wand2
} from "lucide-react";
import {
  acceptSession,
  createApiKey,
  createPreset,
  getUsageSummary,
  listPresets,
  listSessions,
  rewriteText
} from "@/lib/api";
import {
  type RewriteMode,
  type RewritePreset,
  type RewriteResponse,
  type RewriteTone,
  rewriteModes,
  rewriteProviders,
  rewriteTones
} from "@/lib/contracts";
import { useStudioStore } from "@/lib/studio-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "An unexpected error occurred."
    };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error("[OpenRewrite ErrorBoundary]", error, info);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md rounded-md border border-destructive/30 bg-destructive/10 p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden />
            <p className="mb-2 font-semibold text-destructive">Something went wrong</p>
            <p className="text-sm text-muted-foreground">{this.state.message}</p>
            <button
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => this.setState({ hasError: false, message: "" })}
              type="button"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const queryClient = new QueryClient();

const sampleText =
  "It is important to note that our organization will utilize this new writing workflow in order to improve communication. The current draft is somewhat generic and may not fully represent our team's practical, privacy-first approach.";

const wordAlternatives: Record<string, string[]> = {
  // Original entries
  important: ["useful", "worthwhile", "meaningful"],
  note: ["say", "mention", "point out"],
  organization: ["team", "company", "group"],
  utilize: ["use", "apply", "work with"],
  workflow: ["process", "routine", "way of working"],
  improve: ["strengthen", "sharpen", "make better"],
  communication: ["message", "writing", "conversation"],
  communicate: ["explain", "connect", "speak"],
  customers: ["clients", "readers", "audience"],
  current: ["existing", "latest", "present"],
  draft: ["version", "text", "copy"],
  generic: ["broad", "plain", "unspecific"],
  represent: ["reflect", "capture", "show"],
  practical: ["useful", "hands-on", "real-world"],
  approach: ["method", "way", "style"],
  share: ["say", "explain", "show"],
  implementing: ["using", "rolling out", "adopting"],
  enhance: ["improve", "strengthen", "sharpen"],
  capture: ["reflect", "show", "express"],
  commitment: ["focus", "promise", "priority"],
  privacy: ["data care", "privacy", "user trust"],
  clear: ["plain", "direct", "easy to follow"],
  clearly: ["plainly", "directly", "simply"],
  natural: ["relaxed", "human", "smooth"],
  process: ["workflow", "method", "way of working"],
  strong: ["solid", "clear", "confident"],

  // Common AI artifacts
  leverage: ["use", "apply", "draw on"],
  robust: ["solid", "reliable", "dependable"],
  paradigm: ["model", "approach", "framework"],
  synergy: ["teamwork", "combined effect", "alignment"],
  facilitate: ["help", "support", "enable"],
  streamline: ["simplify", "tighten", "trim"],
  implement: ["apply", "roll out", "put in place"],
  execute: ["carry out", "do", "run"],
  deploy: ["roll out", "launch", "release"],
  harness: ["use", "tap into", "make use of"],
  optimize: ["tune", "improve", "refine"],
  empower: ["help", "give people the tools", "support"],
  enable: ["allow", "let", "make possible"],

  // Overused adjectives
  amazing: ["impressive", "great", "notable"],
  incredible: ["remarkable", "impressive", "striking"],
  crucial: ["key", "critical", "essential"],
  essential: ["key", "needed", "core"],
  significant: ["notable", "meaningful", "real"],
  comprehensive: ["thorough", "complete", "full"],
  innovative: ["new", "fresh", "inventive"],
  seamless: ["smooth", "frictionless", "easy"],
  cutting: ["leading", "modern", "advanced"],
  state: ["current", "modern", "leading"],

  // Hedging words
  somewhat: ["a bit", "slightly", "partly"],
  rather: ["quite", "fairly", "pretty"],
  quite: ["very", "fairly", "reasonably"],
  fairly: ["reasonably", "pretty", "moderately"],
  relatively: ["comparatively", "by comparison", "somewhat"],
  arguably: ["possibly", "one could say", "perhaps"],
  presumably: ["probably", "likely", "most likely"],

  // Business jargon
  stakeholders: ["team members", "people involved", "key players"],
  deliverables: ["outputs", "results", "work products"],
  bandwidth: ["time", "capacity", "availability"],
  pivot: ["shift", "change course", "adapt"],
  ecosystem: ["environment", "network", "community"],
  disruptive: ["game-changing", "transformative", "new"],
  scalable: ["flexible", "growth-ready", "expandable"],
  actionable: ["practical", "concrete", "specific"],
  holistic: ["whole-picture", "broad", "end-to-end"],
  granular: ["detailed", "specific", "fine-grained"],

  // More common rewrites
  utilize2: ["use", "apply", "employ"],
  leverage2: ["use", "apply", "build on"],
  impact: ["effect", "result", "outcome"],
  solution: ["answer", "fix", "approach"],
  challenge: ["problem", "issue", "difficulty"],
  opportunity: ["chance", "opening", "possibility"],
  strategy: ["plan", "approach", "game plan"],
  initiative: ["project", "effort", "program"],
  framework: ["structure", "system", "approach"],
  methodology: ["method", "process", "approach"],
  utilize3: ["use", "apply", "put to work"],
  leverage3: ["use", "rely on", "make use of"],
  interface: ["connection", "link", "bridge"],
  utilize4: ["use", "apply", "employ"],
  proactive: ["forward-thinking", "ahead of the curve", "prepared"],
  robust2: ["solid", "strong", "reliable"],
  synergize: ["work together", "combine efforts", "collaborate"],
  utilize5: ["use", "apply", "work with"],
  leverage4: ["use", "draw on", "capitalize on"],
  impactful: ["meaningful", "powerful", "effective"]
};

type ActiveView = "studio" | "history" | "presets" | "settings" | "api" | "admin";

const navItems: Array<{ id: ActiveView; label: string; icon: typeof PenLine }> = [
  { id: "studio", label: "Studio", icon: PenLine },
  { id: "history", label: "History", icon: History },
  { id: "presets", label: "Presets", icon: Wand2 },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "api", label: "API Keys", icon: KeyRound },
  { id: "admin", label: "Usage", icon: Activity }
];

// ---------------------------------------------------------------------------
// Inline word-level diff helper (no external import required)
// ---------------------------------------------------------------------------

interface WordDiffToken {
  value: string;
  type: "added" | "removed" | "unchanged";
}

function computeWordDiff(original: string, rewritten: string): WordDiffToken[] {
  const origWords = original.split(/(\s+)/);
  const rewrWords = rewritten.split(/(\s+)/);

  // Simple LCS-based diff
  const m = origWords.length;
  const n = rewrWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origWords[i - 1] === rewrWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const tokens: WordDiffToken[] = [];
  let i = m;
  let j = n;
  const stack: WordDiffToken[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origWords[i - 1] === rewrWords[j - 1]) {
      stack.push({ value: origWords[i - 1], type: "unchanged" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ value: rewrWords[j - 1], type: "added" });
      j--;
    } else {
      stack.push({ value: origWords[i - 1], type: "removed" });
      i--;
    }
  }

  stack.reverse();
  for (const token of stack) {
    tokens.push(token);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Grade-level mapping helpers
// ---------------------------------------------------------------------------

function readabilityGradeLabel(score: number): string {
  // score is 0-1 where 1 = most readable (simple). Map to US grade levels.
  const grade = Math.round((1 - score) * 12 + 1);
  const clamped = Math.max(1, Math.min(16, grade));
  if (clamped <= 6) return `Grade ${clamped} (Elementary)`;
  if (clamped <= 8) return `Grade ${clamped} (Middle school)`;
  if (clamped <= 12) return `Grade ${clamped} (High school)`;
  return `Grade ${clamped} (College+)`;
}

function qualityTier(score: number): { label: string; className: string } {
  if (score >= 0.85) return { label: "Excellent", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" };
  if (score >= 0.7) return { label: "Good", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" };
  if (score >= 0.5) return { label: "Fair", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200" };
  return { label: "Poor", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" };
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

export function OpenRewriteApp() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StudioShell />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// StudioShell
// ---------------------------------------------------------------------------

function StudioShell() {
  const [activeView, setActiveView] = useState<ActiveView>("studio");
  const [isDark, setIsDark] = useState<boolean>(
    () => (typeof window !== "undefined" ? localStorage.getItem("theme") === "dark" : false)
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const toggleDark = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  const handleNavClick = useCallback((id: ActiveView) => {
    setActiveView(id);
  }, []);

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-4">
        <header className="flex flex-col gap-3 rounded-md border border-border bg-background/92 px-4 py-3 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">OpenRewrite Studio</p>
              <p className="truncate text-sm text-muted-foreground">Rewrite with clarity. Keep your voice. Own your data.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">
              <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden />
              Meaning Lock
            </Badge>
            <Badge variant="muted">Self-hostable</Badge>
            <Button
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              size="icon"
              variant="outline"
              onClick={toggleDark}
            >
              {isDark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Primary navigation" className="rounded-md border border-border bg-background/88 p-2 shadow-sm backdrop-blur lg:min-h-[calc(100vh-112px)]">
            <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    aria-current={activeView === item.id ? "page" : undefined}
                    aria-label={`Go to ${item.label}`}
                    className={cn(
                      "flex h-10 items-center justify-start gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      activeView === item.id && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                    )}
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    type="button"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {activeView === "studio" && <RewriteStudio />}
          {activeView === "history" && <HistoryView />}
          {activeView === "presets" && <PresetsView />}
          {activeView === "settings" && <SettingsView />}
          {activeView === "api" && <ApiKeysView />}
          {activeView === "admin" && <AdminUsageView />}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// RewriteStudio
// ---------------------------------------------------------------------------

function RewriteStudio() {
  const queryClient = useQueryClient();
  const { mode, tone, provider, strength, meaningLock, setMode, setTone, setProvider, setStrength, setMeaningLock } =
    useStudioStore();
  const [originalText, setOriginalText] = useState(sampleText);
  const [currentResult, setCurrentResult] = useState<RewriteResponse | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const wordCount = useMemo(
    () => originalText.trim().split(/\s+/).filter(Boolean).length,
    [originalText]
  );
  const charCount = originalText.length;

  const rewriteMutation = useMutation({
    mutationFn: () => rewriteText({ text: originalText, mode, tone, provider, strength, meaningLock }),
    onSuccess: (result) => {
      setCurrentResult(result);
      setEditableOutput(result.rewrittenText);
      setNotice("Rewrite complete. Review the diff before accepting.");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    }
  });

  const handleRewrite = useCallback(() => {
    rewriteMutation.mutate();
  }, [rewriteMutation]);

  const handleCopy = useCallback(() => {
    void copyText(editableOutput, setNotice);
  }, [editableOutput]);

  const handleDownload = useCallback(() => {
    downloadMarkdown(currentResult, editableOutput);
  }, [currentResult, editableOutput]);

  const handleAcceptCurrent = useCallback(() => {
    if (!currentResult) return;
    // Accept from the studio via the acceptSession API
    void acceptSession(currentResult.sessionId).then(() => {
      setNotice("Session accepted.");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    });
  }, [currentResult, queryClient]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        handleAcceptCurrent();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        handleRewrite();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [handleRewrite, handleAcceptCurrent]);

  const confidenceLabel = useMemo(() => {
    if (!currentResult) return "Waiting";
    return `${Math.round(currentResult.evaluation.confidenceScore * 100)}% confidence`;
  }, [currentResult]);

  const handleModeChange = useCallback((value: string) => setMode(value as RewriteMode), [setMode]);
  const handleToneChange = useCallback((value: string) => setTone(value as RewriteTone), [setTone]);
  const handleProviderChange = useCallback((value: string) => setProvider(value as typeof provider), [setProvider]);
  const handleStrengthChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setStrength(Number(event.target.value)),
    [setStrength]
  );
  const handleMeaningLockChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setMeaningLock(event.target.checked),
    [setMeaningLock]
  );

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <EditorPanel
            label="Original"
            meta={`${wordCount} words · ${charCount.toLocaleString()} chars`}
            value={originalText}
            onChange={setOriginalText}
          />
          <OutputPanel
            editableText={editableOutput}
            isLoading={rewriteMutation.isPending}
            key={currentResult?.sessionId ?? "empty-output"}
            onEditableTextChange={setEditableOutput}
            result={currentResult}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        </div>
        <TrustPanel
          result={currentResult}
          notice={notice}
          error={rewriteMutation.error instanceof Error ? rewriteMutation.error.message : null}
          originalText={originalText}
        />
        <DiffPanel result={currentResult} isPending={rewriteMutation.isPending} />
      </div>

      <aside className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Rewrite Controls</h2>
            <p className="text-xs text-muted-foreground">Tune the result before generation.</p>
          </div>
          <PanelRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <ControlSelect
          aria-label="Rewrite mode"
          label="Mode"
          value={mode}
          options={rewriteModes}
          labels={{ humanize: "humanize / natural voice" }}
          onChange={handleModeChange}
        />
        <ControlSelect
          aria-label="Rewrite tone"
          label="Tone"
          value={tone}
          options={rewriteTones}
          onChange={handleToneChange}
        />
        <ControlSelect
          aria-label="AI provider"
          label="Provider"
          value={provider}
          options={rewriteProviders}
          onChange={handleProviderChange}
        />
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="strength">Rewrite Strength</Label>
            <span className="text-xs font-medium">{strength}%</span>
          </div>
          <input
            aria-label="Rewrite strength percentage"
            className="h-2 w-full accent-[hsl(var(--primary))]"
            id="strength"
            max={100}
            min={0}
            onChange={handleStrengthChange}
            type="range"
            value={strength}
          />
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/40 p-3">
          <input
            aria-label="Enable meaning lock to warn when facts or meaning drift"
            checked={meaningLock}
            className="mt-1 accent-[hsl(var(--primary))]"
            onChange={handleMeaningLockChange}
            type="checkbox"
          />
          <span>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4" aria-hidden />
              Meaning Lock
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Warn when facts, numbers, citations, or meaning appear to drift.
            </span>
          </span>
        </label>
        <Button
          aria-label="Run rewrite (Cmd or Ctrl + Enter)"
          className="mt-4 w-full"
          disabled={rewriteMutation.isPending}
          onClick={handleRewrite}
        >
          {rewriteMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          Rewrite
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Rewrite: Cmd/Ctrl + Enter &nbsp;|&nbsp; Accept: Cmd/Ctrl + Shift + Enter
        </p>
        <div className="mt-5 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Trust Signal</span>
            <Badge variant={currentResult ? "success" : "muted"}>{confidenceLabel}</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Every rewrite keeps the original next to the output and requires review before reuse.
          </p>
        </div>
      </aside>
    </section>
  );
}

// ---------------------------------------------------------------------------
// EditorPanel
// ---------------------------------------------------------------------------

interface EditorPanelProps {
  label: string;
  meta: string;
  value: string;
  onChange: (value: string) => void;
}

const EditorPanel = React.memo(function EditorPanel({ label, meta, value, onChange }: EditorPanelProps) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    [onChange]
  );

  return (
    <section className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
        <PenLine className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      <Textarea
        aria-label="Input text to rewrite"
        className="writing-surface min-h-[420px] font-serif text-base leading-7"
        onChange={handleChange}
        value={value}
      />
    </section>
  );
});

// ---------------------------------------------------------------------------
// OutputPanel
// ---------------------------------------------------------------------------

interface OutputPanelProps {
  editableText: string;
  isLoading: boolean;
  onEditableTextChange: (value: string) => void;
  result: RewriteResponse | null;
  onCopy: () => void;
  onDownload: () => void;
}

interface SelectedWord {
  end: number;
  text: string;
  start: number;
}

const OutputPanel = React.memo(function OutputPanel({
  editableText,
  isLoading,
  onEditableTextChange,
  result,
  onCopy,
  onDownload
}: OutputPanelProps) {
  const [selectedWord, setSelectedWord] = useState<SelectedWord | null>(null);
  const [copied, setCopied] = useState(false);

  const alternatives = useMemo(
    () => (selectedWord ? getWordAlternatives(selectedWord.text) : []),
    [selectedWord]
  );

  const handleCopyClick = useCallback(async () => {
    if (!editableText) return;
    await navigator.clipboard.writeText(editableText);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  }, [editableText, onCopy]);

  const replaceSelectedWord = useCallback(
    (replacement: string): void => {
      if (!selectedWord) return;
      const nextText = `${editableText.slice(0, selectedWord.start)}${matchWordCase(selectedWord.text, replacement)}${editableText.slice(selectedWord.end)}`;
      onEditableTextChange(nextText);
      setSelectedWord(null);
    },
    [editableText, onEditableTextChange, selectedWord]
  );

  const handleCloseWord = useCallback(() => setSelectedWord(null), []);

  return (
    <section className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Rewritten Output</h2>
          <p className="text-xs text-muted-foreground">
            {result ? `${result.mode} · ${result.tone}` : "Review changes before replacing text"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label={copied ? "Text copied to clipboard" : "Copy rewritten text to clipboard"}
            disabled={!result}
            onClick={() => void handleCopyClick()}
            size="sm"
            variant="outline"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" aria-hidden />
                Copied!
              </>
            ) : (
              <>
                <Clipboard className="h-4 w-4" aria-hidden />
                Copy
              </>
            )}
          </Button>
          <Button
            aria-label="Download rewritten text as Markdown file"
            disabled={!result}
            onClick={onDownload}
            size="icon"
            variant="outline"
          >
            <Download className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="writing-surface min-h-[420px] rounded-md border border-input bg-background px-4 py-4 font-serif text-base leading-7 shadow-sm">
        {isLoading && (
          <div className="space-y-3" aria-label="Generating rewrite, please wait">
            <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-4 w-10/12 animate-pulse rounded bg-muted" />
            <div className="h-4 w-8/12 animate-pulse rounded bg-muted" />
          </div>
        )}
        {!isLoading && result && (
          <div>
            <InteractiveText text={editableText} selectedWord={selectedWord} onSelectWord={setSelectedWord} />
            <div className="mt-4 rounded-md border border-border bg-background/95 p-3 font-sans text-sm leading-6">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium">Word Alternatives</span>
                {selectedWord && (
                  <button
                    aria-label="Close word alternatives panel"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleCloseWord}
                    type="button"
                  >
                    Close
                  </button>
                )}
              </div>
              {!selectedWord && (
                <p className="text-muted-foreground">Click any rewritten word to tune it.</p>
              )}
              {selectedWord && alternatives.length === 0 && (
                <p className="text-muted-foreground">
                  No curated alternatives yet for &quot;{selectedWord.text}&quot;.
                </p>
              )}
              {selectedWord && alternatives.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {alternatives.map((alternative) => (
                    <button
                      aria-label={`Replace with "${alternative}"`}
                      className="rounded-md border border-border bg-muted px-2.5 py-1 text-sm transition-colors hover:bg-secondary"
                      key={alternative}
                      onClick={() => replaceSelectedWord(alternative)}
                      type="button"
                    >
                      {alternative}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {!isLoading && !result && (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-muted-foreground">
            <Wand2 className="mb-3 h-8 w-8" aria-hidden />
            <p className="max-w-sm text-sm leading-6">
              Choose a mode and rewrite. The output will appear here with a sentence-level diff and risk warnings.
            </p>
          </div>
        )}
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------
// InteractiveText
// ---------------------------------------------------------------------------

function InteractiveText({
  text,
  selectedWord,
  onSelectWord
}: {
  text: string;
  selectedWord: SelectedWord | null;
  onSelectWord: (word: SelectedWord) => void;
}) {
  const segments = useMemo(() => segmentText(text), [text]);

  return (
    <p className="whitespace-pre-wrap" aria-label="Rewritten text, click words to see alternatives">
      {segments.map((segment, index) => {
        if (segment.kind === "space") {
          return <span key={`${segment.start}-${index}`}>{segment.value}</span>;
        }

        const isSelected = selectedWord?.start === segment.start && selectedWord.end === segment.end;
        return (
          <button
            aria-label={`Word: ${segment.value}. Click to see alternatives.`}
            aria-pressed={isSelected}
            className={cn(
              "rounded-[4px] px-0.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected && "bg-secondary text-secondary-foreground"
            )}
            key={`${segment.start}-${index}`}
            onClick={() => onSelectWord({ start: segment.start, end: segment.end, text: segment.value })}
            title="Show word alternatives"
            type="button"
          >
            {segment.value}
          </button>
        );
      })}
    </p>
  );
}

// ---------------------------------------------------------------------------
// TrustPanel
// ---------------------------------------------------------------------------

interface TrustPanelProps {
  result: RewriteResponse | null;
  notice: string | null;
  error: string | null;
  originalText: string;
}

const TrustPanel = React.memo(function TrustPanel({ result, notice, error, originalText }: TrustPanelProps) {
  const meaningScore = result ? Math.round(result.evaluation.meaningScore * 100) : 0;
  const confidenceScore = result ? Math.round(result.evaluation.confidenceScore * 100) : 0;
  const humanizerScore = result ? Math.round((result.evaluation.humanizerScore ?? 0) * 100) : 0;
  const naturalnessScore = result ? Math.round((result.evaluation.naturalnessScore ?? 0) * 100) : 0;

  // Extended metrics
  const readabilityScore: number | undefined = (result?.evaluation as Record<string, unknown> | undefined)?.readabilityScore as number | undefined;
  const aiSignaturesRemoved: number | undefined = (result?.evaluation as Record<string, unknown> | undefined)?.aiSignaturesRemoved as number | undefined;

  const originalWordCount = useMemo(
    () => originalText.trim().split(/\s+/).filter(Boolean).length,
    [originalText]
  );
  const rewrittenWordCount = useMemo(
    () => (result ? result.rewrittenText.trim().split(/\s+/).filter(Boolean).length : 0),
    [result]
  );
  const wordDelta = result ? rewrittenWordCount - originalWordCount : null;

  const overallScore = result
    ? (meaningScore + humanizerScore + naturalnessScore + confidenceScore) / 400
    : 0;
  const tier = result ? qualityTier(overallScore) : null;

  return (
    <section
      aria-label="Rewrite quality metrics"
      className="grid gap-3 rounded-md border border-border bg-background/92 p-4 shadow-sm md:grid-cols-[repeat(5,minmax(0,1fr))]"
    >
      <MetricTile icon={Gauge} label="Meaning Score" value={result ? `${meaningScore}%` : "Pending"} />
      <MetricTile icon={Sparkles} label="Humanizer" value={result ? `${humanizerScore}%` : "Pending"} />
      <MetricTile icon={PenLine} label="Naturalness" value={result ? `${naturalnessScore}%` : "Pending"} />
      <MetricTile
        icon={ShieldCheck}
        label="Facts Preserved"
        value={result?.evaluation.factsPreserved ? "Yes" : result ? "Review" : "Pending"}
      />
      <MetricTile icon={Check} label="Confidence" value={result ? `${confidenceScore}%` : "Pending"} />

      {/* Extended metrics row */}
      {result && (
        <>
          {readabilityScore !== undefined && (
            <div className="rounded-md border border-border bg-muted/35 p-3 md:col-span-2">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                <Gauge className="h-4 w-4" aria-hidden />
                Readability
              </div>
              <p className="text-sm font-semibold">{readabilityGradeLabel(readabilityScore)}</p>
            </div>
          )}

          {aiSignaturesRemoved !== undefined && aiSignaturesRemoved > 0 && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-200">
                <Check className="mr-1 h-3 w-3" aria-hidden />
                {aiSignaturesRemoved} AI signature{aiSignaturesRemoved !== 1 ? "s" : ""} removed
              </span>
            </div>
          )}

          {wordDelta !== null && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                  wordDelta > 0
                    ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
                    : wordDelta < 0
                      ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {wordDelta > 0 ? `+${wordDelta}` : wordDelta} words
              </span>
            </div>
          )}

          {tier && (
            <div className="flex items-center gap-2">
              <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", tier.className)}>
                {tier.label}
              </span>
            </div>
          )}
        </>
      )}

      {(notice || error) && (
        <div className="md:col-span-5">
          <p
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              error
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-primary/20 bg-primary/10 text-primary"
            )}
            role={error ? "alert" : "status"}
          >
            {error ?? notice}
          </p>
        </div>
      )}
      {(result?.evaluation.styleNotes ?? []).map((note) => (
        <div className="md:col-span-5" key={note}>
          <p className="rounded-md border border-secondary bg-secondary/35 px-3 py-2 text-sm text-secondary-foreground">
            {note}
          </p>
        </div>
      ))}
      {result?.evaluation.warnings.map((warning) => (
        <div
          className="md:col-span-5"
          key={`${warning.code}-${warning.sentenceIndex ?? "global"}`}
        >
          <p
            className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{warning.message}</span>
          </p>
        </div>
      ))}
    </section>
  );
});

// ---------------------------------------------------------------------------
// MetricTile
// ---------------------------------------------------------------------------

interface MetricTileProps {
  icon: typeof Gauge;
  label: string;
  value: string;
}

function MetricTile({ icon: Icon, label, value }: MetricTileProps) {
  return (
    <div className="rounded-md border border-border bg-muted/35 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </div>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffPanel
// ---------------------------------------------------------------------------

interface DiffPanelProps {
  result: RewriteResponse | null;
  isPending: boolean;
}

const DiffPanel = React.memo(function DiffPanel({ result, isPending }: DiffPanelProps) {
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);

  const toggleShowOnlyChanged = useCallback(() => setShowOnlyChanged((prev) => !prev), []);

  const renderedDiffs = useMemo(() => {
    if (!result) return [];
    const diffs = showOnlyChanged
      ? result.diffs.filter((d) => d.status !== "unchanged")
      : result.diffs;
    return diffs;
  }, [result, showOnlyChanged]);

  return (
    <section className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Sentence Diff</h2>
          <p className="text-xs text-muted-foreground">
            Heavy changes and meaning risks are visible before export.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button
              aria-label={showOnlyChanged ? "Show all sentences" : "Show only changed sentences"}
              aria-pressed={showOnlyChanged}
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors",
                showOnlyChanged
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
              onClick={toggleShowOnlyChanged}
              type="button"
            >
              <Filter className="h-3 w-3" aria-hidden />
              Collapse unchanged
            </button>
          )}
          <Braces className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </div>

      {isPending && (
        <div className="space-y-3" aria-label="Loading sentence diffs">
          <div className="h-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      )}

      {!isPending && !result && (
        <EmptyState text="Run a rewrite to inspect sentence-level changes." />
      )}

      {!isPending && result && renderedDiffs.length === 0 && (
        <EmptyState text="No changed sentences to show. Toggle off the filter to see all." />
      )}

      {!isPending && result && renderedDiffs.length > 0 && (
        <div className="space-y-3">
          {renderedDiffs.map((diff) => {
            const wordTokens = computeWordDiff(diff.original ?? "", diff.rewritten ?? "");
            return (
              <motion.article
                animate={{ opacity: 1, y: 0 }}
                className="rounded-md border border-border bg-muted/25 p-3"
                initial={{ opacity: 0, y: 8 }}
                key={diff.index}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Sentence {diff.index + 1}
                  </span>
                  <Badge
                    variant={
                      diff.status === "high-risk"
                        ? "warning"
                        : diff.status === "unchanged"
                          ? "muted"
                          : "default"
                    }
                  >
                    {diff.status.replace("-", " ")} · {Math.round(diff.changeRatio * 100)}%
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <p className="rounded-md bg-background p-3 text-sm leading-6 text-muted-foreground">
                    {diff.original || "No original sentence"}
                  </p>
                  <div className="rounded-md bg-background p-3 text-sm leading-6">
                    {wordTokens.length > 0 ? (
                      <span className="whitespace-pre-wrap">
                        {wordTokens.map((token, idx) => {
                          if (token.type === "added") {
                            return (
                              <mark
                                className="rounded-sm bg-green-100 px-0.5 dark:bg-green-900/30"
                                key={idx}
                              >
                                {token.value}
                              </mark>
                            );
                          }
                          if (token.type === "removed") {
                            return (
                              <del
                                className="rounded-sm bg-red-100 px-0.5 line-through dark:bg-red-900/30"
                                key={idx}
                              >
                                {token.value}
                              </del>
                            );
                          }
                          return <span key={idx}>{token.value}</span>;
                        })}
                      </span>
                    ) : (
                      diff.rewritten || "No rewritten sentence"
                    )}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </section>
  );
});

// ---------------------------------------------------------------------------
// HistoryView
// ---------------------------------------------------------------------------

const HistoryView = React.memo(function HistoryView() {
  const query = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
  const acceptMutation = useMutation({ mutationFn: acceptSession });

  const handleAccept = useCallback(
    (sessionId: string) => {
      acceptMutation.mutate(sessionId);
    },
    [acceptMutation]
  );

  return (
    <Panel title="History" subtitle="Saved rewrite sessions from this API instance." icon={FileClock}>
      {query.isLoading && <EmptyState text="Loading rewrite history..." />}
      {query.data?.length === 0 && <EmptyState text="No history yet. Your next rewrite will appear here." />}
      <div className="space-y-3">
        {query.data?.map((session) => (
          <article className="rounded-md border border-border bg-muted/25 p-4" key={session.sessionId}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{session.mode}</Badge>
                <Badge variant="muted">{session.tone}</Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(session.createdAt).toLocaleString()}
                </span>
              </div>
              <Button
                aria-label={`Accept session from ${new Date(session.createdAt).toLocaleString()}`}
                disabled={acceptMutation.isPending}
                onClick={() => handleAccept(session.sessionId)}
                size="sm"
                variant="outline"
              >
                <Check className="h-4 w-4" aria-hidden />
                Accept
              </Button>
            </div>
            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{session.originalText}</p>
            <ChevronRight className="my-2 h-4 w-4 text-muted-foreground" aria-hidden />
            <p className="line-clamp-2 text-sm leading-6">{session.rewrittenText}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
});

// ---------------------------------------------------------------------------
// PresetsView
// ---------------------------------------------------------------------------

const PresetsView = React.memo(function PresetsView() {
  const queryClient = useQueryClient();
  const { mode, tone, strength, meaningLock } = useStudioStore();
  const [name, setName] = useState("My natural voice");
  const presetsQuery = useQuery({ queryKey: ["presets"], queryFn: listPresets });
  const createPresetMutation = useMutation({
    mutationFn: () => createPreset({ name, mode, tone, strength, meaningLock }),
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["presets"] });
    }
  });

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    []
  );

  const handleSave = useCallback(() => {
    createPresetMutation.mutate();
  }, [createPresetMutation]);

  return (
    <Panel title="Presets" subtitle="Reusable rewrite modes for personal and team voice." icon={Wand2}>
      <div className="mb-4 grid gap-3 rounded-md border border-border bg-muted/25 p-4 md:grid-cols-[1fr_auto]">
        <Input
          aria-label="New preset name"
          onChange={handleNameChange}
          placeholder="Preset name"
          value={name}
        />
        <Button
          aria-label="Save current settings as a new preset"
          disabled={!name.trim() || createPresetMutation.isPending}
          onClick={handleSave}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Save Current
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {presetsQuery.data?.map((preset) => (
          <PresetTile key={preset.id} preset={preset} />
        ))}
      </div>
    </Panel>
  );
});

// ---------------------------------------------------------------------------
// PresetTile
// ---------------------------------------------------------------------------

function PresetTile({ preset }: { preset: RewritePreset }) {
  return (
    <article className="rounded-md border border-border bg-muted/25 p-4">
      <p className="font-semibold">{preset.name}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge>{preset.mode}</Badge>
        <Badge variant="muted">{preset.tone}</Badge>
        <Badge variant={preset.meaningLock ? "success" : "muted"}>{preset.strength}%</Badge>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// SettingsView
// ---------------------------------------------------------------------------

function SettingsView() {
  return (
    <Panel
      title="Settings"
      subtitle="Provider and privacy controls for the self-hosted workspace."
      icon={Settings}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <InfoTile
          title="Default Provider"
          value="Local deterministic provider unless AI_PROVIDER is configured."
        />
        <InfoTile
          title="Data Retention"
          value="Anonymous rewrite data is designed for short-lived storage; hosted policy lives in deployment config."
        />
        <InfoTile
          title="Disclosure"
          value="The product improves writing transparently and does not claim detector bypass."
        />
        <InfoTile
          title="Self-hosting"
          value="Docker Compose includes frontend, API, AI service, PostgreSQL, Redis, and nginx."
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// ApiKeysView
// ---------------------------------------------------------------------------

function ApiKeysView() {
  const [name, setName] = useState("Local integration");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => createApiKey(name),
    onSuccess: (result) => setCreatedKey(result.tokenPreview)
  });

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    []
  );

  const handleCreate = useCallback(() => mutation.mutate(), [mutation]);

  return (
    <Panel title="API Keys" subtitle="Create integration keys for developer workflows." icon={KeyRound}>
      <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-4 md:grid-cols-[1fr_auto]">
        <Input
          aria-label="Name for the new API key"
          onChange={handleNameChange}
          value={name}
        />
        <Button
          aria-label="Create a new API key with the given name"
          disabled={!name.trim() || mutation.isPending}
          onClick={handleCreate}
        >
          <KeyRound className="h-4 w-4" aria-hidden />
          Create Key
        </Button>
      </div>
      {createdKey && (
        <p
          className="mt-4 rounded-md border border-primary/20 bg-primary/10 p-3 text-sm text-primary"
          role="status"
        >
          Created key preview: {createdKey}
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// AdminUsageView
// ---------------------------------------------------------------------------

function AdminUsageView() {
  const usageQuery = useQuery({ queryKey: ["usage"], queryFn: getUsageSummary });
  const usage = usageQuery.data;

  return (
    <Panel title="Usage" subtitle="Local admin summary for rewrite quality and adoption." icon={Activity}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={RefreshCcw} label="Rewrites" value={String(usage?.rewriteCount ?? 0)} />
        <MetricTile icon={Check} label="Accepted" value={String(usage?.acceptedCount ?? 0)} />
        <MetricTile
          icon={Gauge}
          label="Mean Score"
          value={`${Math.round((usage?.averageMeaningScore ?? 0) * 100)}%`}
        />
        <MetricTile
          icon={Activity}
          label="Latency"
          value={`${Math.round(usage?.averageLatencyMs ?? 0)}ms`}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface PanelProps {
  title: string;
  subtitle: string;
  icon: typeof PenLine;
  children: React.ReactNode;
}

function Panel({ title, subtitle, icon: Icon, children }: PanelProps) {
  return (
    <section className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// InfoTile
// ---------------------------------------------------------------------------

function InfoTile({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-md border border-border bg-muted/25 p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{value}</p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// ControlSelect
// ---------------------------------------------------------------------------

function ControlSelect({
  label,
  labels = {},
  value,
  options,
  onChange,
  "aria-label": ariaLabel
}: {
  label: string;
  labels?: Record<string, string>;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  "aria-label"?: string;
}) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
    [onChange]
  );

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor={label}>{label}</Label>
      <select
        aria-label={ariaLabel ?? label}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        id={label}
        onChange={handleChange}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/25 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

interface TextSegment {
  end: number;
  kind: "word" | "space";
  start: number;
  value: string;
}

function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const matcher = /[A-Za-z][A-Za-z'-]*|\s+|[^A-Za-z\s]+/g;
  for (const match of text.matchAll(matcher)) {
    const value = match[0];
    const start = match.index ?? 0;
    segments.push({
      start,
      end: start + value.length,
      kind: /^[A-Za-z]/.test(value) ? "word" : "space",
      value
    });
  }
  return segments;
}

function getWordAlternatives(word: string): string[] {
  return wordAlternatives[normalizeWord(word)] ?? [];
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
}

function matchWordCase(source: string, replacement: string): string {
  if (source.toUpperCase() === source) {
    return replacement.toUpperCase();
  }
  if (source[0] === source[0]?.toUpperCase()) {
    return `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`;
  }
  return replacement;
}

async function copyText(text: string, setNotice: (notice: string) => void): Promise<void> {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setNotice("Copied rewritten text.");
}

function downloadMarkdown(result: RewriteResponse | null, rewrittenText: string): void {
  if (!result) return;
  const content = `# OpenRewrite Export\n\n## Original\n\n${result.originalText}\n\n## Rewritten\n\n${rewrittenText}\n`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `openrewrite-${result.sessionId}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
