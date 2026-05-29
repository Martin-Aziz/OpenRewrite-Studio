"use client";

import { useEffect, useMemo, useState } from "react";
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

const queryClient = new QueryClient();

const sampleText =
  "It is important to note that our organization will utilize this new writing workflow in order to improve communication. The current draft is somewhat generic and may not fully represent our team's practical, privacy-first approach.";

const wordAlternatives: Record<string, string[]> = {
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
  strong: ["solid", "clear", "confident"]
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

export function OpenRewriteApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <StudioShell />
    </QueryClientProvider>
  );
}

function StudioShell() {
  const [activeView, setActiveView] = useState<ActiveView>("studio");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

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
            <Button aria-label="Toggle color theme" size="icon" variant="outline" onClick={() => setIsDark((value) => !value)}>
              {isDark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Primary" className="rounded-md border border-border bg-background/88 p-2 shadow-sm backdrop-blur lg:min-h-[calc(100vh-112px)]">
            <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={cn(
                      "flex h-10 items-center justify-start gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      activeView === item.id && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                    )}
                    key={item.id}
                    onClick={() => setActiveView(item.id)}
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

function RewriteStudio() {
  const queryClient = useQueryClient();
  const { mode, tone, provider, strength, meaningLock, setMode, setTone, setProvider, setStrength, setMeaningLock } =
    useStudioStore();
  const [originalText, setOriginalText] = useState(sampleText);
  const [currentResult, setCurrentResult] = useState<RewriteResponse | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        rewriteMutation.mutate();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [rewriteMutation]);

  const confidenceLabel = useMemo(() => {
    if (!currentResult) {
      return "Waiting";
    }

    return `${Math.round(currentResult.evaluation.confidenceScore * 100)}% confidence`;
  }, [currentResult]);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <EditorPanel
            label="Original"
            meta={`${originalText.length.toLocaleString()} characters`}
            value={originalText}
            onChange={setOriginalText}
          />
          <OutputPanel
            editableText={editableOutput}
            isLoading={rewriteMutation.isPending}
            key={currentResult?.sessionId ?? "empty-output"}
            onEditableTextChange={setEditableOutput}
            result={currentResult}
            onCopy={() => copyText(editableOutput, setNotice)}
            onDownload={() => downloadMarkdown(currentResult, editableOutput)}
          />
        </div>
        <TrustPanel result={currentResult} notice={notice} error={rewriteMutation.error instanceof Error ? rewriteMutation.error.message : null} />
        <DiffPanel result={currentResult} />
      </div>

      <aside className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Rewrite Controls</h2>
            <p className="text-xs text-muted-foreground">Tune the result before generation.</p>
          </div>
          <PanelRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <ControlSelect label="Mode" value={mode} options={rewriteModes} labels={{ humanize: "humanize / natural voice" }} onChange={(value) => setMode(value as RewriteMode)} />
        <ControlSelect label="Tone" value={tone} options={rewriteTones} onChange={(value) => setTone(value as RewriteTone)} />
        <ControlSelect label="Provider" value={provider} options={rewriteProviders} onChange={(value) => setProvider(value as typeof provider)} />
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="strength">Rewrite Strength</Label>
            <span className="text-xs font-medium">{strength}%</span>
          </div>
          <input
            aria-label="Rewrite strength"
            className="h-2 w-full accent-[hsl(var(--primary))]"
            id="strength"
            max={100}
            min={0}
            onChange={(event) => setStrength(Number(event.target.value))}
            type="range"
            value={strength}
          />
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-border bg-muted/40 p-3">
          <input
            checked={meaningLock}
            className="mt-1 accent-[hsl(var(--primary))]"
            onChange={(event) => setMeaningLock(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4" aria-hidden />
              Meaning Lock
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">Warn when facts, numbers, citations, or meaning appear to drift.</span>
          </span>
        </label>
        <Button className="mt-4 w-full" disabled={rewriteMutation.isPending} onClick={() => rewriteMutation.mutate()}>
          {rewriteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          Rewrite
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">Shortcut: Cmd/Ctrl + Enter</p>
        <div className="mt-5 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Trust Signal</span>
            <Badge variant={currentResult ? "success" : "muted"}>{confidenceLabel}</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Every rewrite keeps the original next to the output and requires review before reuse.</p>
        </div>
      </aside>
    </section>
  );
}

interface EditorPanelProps {
  label: string;
  meta: string;
  value: string;
  onChange: (value: string) => void;
}

function EditorPanel({ label, meta, value, onChange }: EditorPanelProps) {
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
        aria-label="Original text"
        className="writing-surface min-h-[420px] font-serif text-base leading-7"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </section>
  );
}

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

function OutputPanel({ editableText, isLoading, onEditableTextChange, result, onCopy, onDownload }: OutputPanelProps) {
  const [selectedWord, setSelectedWord] = useState<SelectedWord | null>(null);
  const alternatives = selectedWord ? getWordAlternatives(selectedWord.text) : [];

  const replaceSelectedWord = (replacement: string): void => {
    if (!selectedWord) {
      return;
    }

    const nextText = `${editableText.slice(0, selectedWord.start)}${matchWordCase(selectedWord.text, replacement)}${editableText.slice(selectedWord.end)}`;
    onEditableTextChange(nextText);
    setSelectedWord(null);
  };

  return (
    <section className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Rewritten Output</h2>
          <p className="text-xs text-muted-foreground">{result ? `${result.mode} · ${result.tone}` : "Review changes before replacing text"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button aria-label="Copy output" disabled={!result} onClick={onCopy} size="icon" variant="outline">
            <Clipboard className="h-4 w-4" aria-hidden />
          </Button>
          <Button aria-label="Download Markdown" disabled={!result} onClick={onDownload} size="icon" variant="outline">
            <Download className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="writing-surface min-h-[420px] rounded-md border border-input bg-background px-4 py-4 font-serif text-base leading-7 shadow-sm">
        {isLoading && (
          <div className="space-y-3" aria-label="Generating rewrite">
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
                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedWord(null)} type="button">
                    Close
                  </button>
                )}
              </div>
              {!selectedWord && <p className="text-muted-foreground">Click any rewritten word to tune it.</p>}
              {selectedWord && alternatives.length === 0 && (
                <p className="text-muted-foreground">No curated alternatives yet for &quot;{selectedWord.text}&quot;.</p>
              )}
              {selectedWord && alternatives.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {alternatives.map((alternative) => (
                    <button
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
            <p className="max-w-sm text-sm leading-6">Choose a mode and rewrite. The output will appear here with a sentence-level diff and risk warnings.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function InteractiveText({
  text,
  selectedWord,
  onSelectWord
}: {
  text: string;
  selectedWord: SelectedWord | null;
  onSelectWord: (word: SelectedWord) => void;
}) {
  return (
    <p className="whitespace-pre-wrap">
      {segmentText(text).map((segment, index) => {
        if (segment.kind === "space") {
          return <span key={`${segment.start}-${index}`}>{segment.value}</span>;
        }

        const isSelected = selectedWord?.start === segment.start && selectedWord.end === segment.end;
        return (
          <button
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

interface TrustPanelProps {
  result: RewriteResponse | null;
  notice: string | null;
  error: string | null;
}

function TrustPanel({ result, notice, error }: TrustPanelProps) {
  const meaningScore = result ? Math.round(result.evaluation.meaningScore * 100) : 0;
  const confidenceScore = result ? Math.round(result.evaluation.confidenceScore * 100) : 0;
  const humanizerScore = result ? Math.round((result.evaluation.humanizerScore ?? 0) * 100) : 0;
  const naturalnessScore = result ? Math.round((result.evaluation.naturalnessScore ?? 0) * 100) : 0;

  return (
    <section className="grid gap-3 rounded-md border border-border bg-background/92 p-4 shadow-sm md:grid-cols-[repeat(5,minmax(0,1fr))]">
      <MetricTile icon={Gauge} label="Meaning Score" value={result ? `${meaningScore}%` : "Pending"} />
      <MetricTile icon={Sparkles} label="Humanizer" value={result ? `${humanizerScore}%` : "Pending"} />
      <MetricTile icon={PenLine} label="Naturalness" value={result ? `${naturalnessScore}%` : "Pending"} />
      <MetricTile icon={ShieldCheck} label="Facts Preserved" value={result?.evaluation.factsPreserved ? "Yes" : result ? "Review" : "Pending"} />
      <MetricTile icon={Check} label="Confidence" value={result ? `${confidenceScore}%` : "Pending"} />
      {(notice || error) && (
        <div className="md:col-span-5">
          <p className={cn("rounded-md border px-3 py-2 text-sm", error ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/20 bg-primary/10 text-primary")}>
            {error ?? notice}
          </p>
        </div>
      )}
      {(result?.evaluation.styleNotes ?? []).map((note) => (
        <div className="md:col-span-5" key={note}>
          <p className="rounded-md border border-secondary bg-secondary/35 px-3 py-2 text-sm text-secondary-foreground">{note}</p>
        </div>
      ))}
      {result?.evaluation.warnings.map((warning) => (
        <div className="md:col-span-5" key={`${warning.code}-${warning.sentenceIndex ?? "global"}`}>
          <p className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{warning.message}</span>
          </p>
        </div>
      ))}
    </section>
  );
}

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

function DiffPanel({ result }: { result: RewriteResponse | null }) {
  return (
    <section className="rounded-md border border-border bg-background/92 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Sentence Diff</h2>
          <p className="text-xs text-muted-foreground">Heavy changes and meaning risks are visible before export.</p>
        </div>
        <Braces className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      {!result && <EmptyState text="Run a rewrite to inspect sentence-level changes." />}
      {result && (
        <div className="space-y-3">
          {result.diffs.map((diff) => (
            <motion.article
              animate={{ opacity: 1, y: 0 }}
              className="rounded-md border border-border bg-muted/25 p-3"
              initial={{ opacity: 0, y: 8 }}
              key={diff.index}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Sentence {diff.index + 1}</span>
                <Badge variant={diff.status === "high-risk" ? "warning" : diff.status === "unchanged" ? "muted" : "default"}>
                  {diff.status.replace("-", " ")} · {Math.round(diff.changeRatio * 100)}%
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <p className="rounded-md bg-background p-3 text-sm leading-6 text-muted-foreground">{diff.original || "No original sentence"}</p>
                <p className="rounded-md bg-background p-3 text-sm leading-6">{diff.rewritten || "No rewritten sentence"}</p>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryView() {
  const query = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
  const acceptMutation = useMutation({ mutationFn: acceptSession });

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
                <span className="text-xs text-muted-foreground">{new Date(session.createdAt).toLocaleString()}</span>
              </div>
              <Button disabled={acceptMutation.isPending} onClick={() => acceptMutation.mutate(session.sessionId)} size="sm" variant="outline">
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
}

function PresetsView() {
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

  return (
    <Panel title="Presets" subtitle="Reusable rewrite modes for personal and team voice." icon={Wand2}>
      <div className="mb-4 grid gap-3 rounded-md border border-border bg-muted/25 p-4 md:grid-cols-[1fr_auto]">
        <Input aria-label="Preset name" onChange={(event) => setName(event.target.value)} placeholder="Preset name" value={name} />
        <Button disabled={!name.trim() || createPresetMutation.isPending} onClick={() => createPresetMutation.mutate()}>
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
}

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

function SettingsView() {
  return (
    <Panel title="Settings" subtitle="Provider and privacy controls for the self-hosted workspace." icon={Settings}>
      <div className="grid gap-3 md:grid-cols-2">
        <InfoTile title="Default Provider" value="Local deterministic provider unless AI_PROVIDER is configured." />
        <InfoTile title="Data Retention" value="Anonymous rewrite data is designed for short-lived storage; hosted policy lives in deployment config." />
        <InfoTile title="Disclosure" value="The product improves writing transparently and does not claim detector bypass." />
        <InfoTile title="Self-hosting" value="Docker Compose includes frontend, API, AI service, PostgreSQL, Redis, and nginx." />
      </div>
    </Panel>
  );
}

function ApiKeysView() {
  const [name, setName] = useState("Local integration");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => createApiKey(name),
    onSuccess: (result) => setCreatedKey(result.tokenPreview)
  });

  return (
    <Panel title="API Keys" subtitle="Create integration keys for developer workflows." icon={KeyRound}>
      <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-4 md:grid-cols-[1fr_auto]">
        <Input aria-label="API key name" onChange={(event) => setName(event.target.value)} value={name} />
        <Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          <KeyRound className="h-4 w-4" aria-hidden />
          Create Key
        </Button>
      </div>
      {createdKey && <p className="mt-4 rounded-md border border-primary/20 bg-primary/10 p-3 text-sm text-primary">Created key preview: {createdKey}</p>}
    </Panel>
  );
}

function AdminUsageView() {
  const usageQuery = useQuery({ queryKey: ["usage"], queryFn: getUsageSummary });
  const usage = usageQuery.data;

  return (
    <Panel title="Usage" subtitle="Local admin summary for rewrite quality and adoption." icon={Activity}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={RefreshCcw} label="Rewrites" value={String(usage?.rewriteCount ?? 0)} />
        <MetricTile icon={Check} label="Accepted" value={String(usage?.acceptedCount ?? 0)} />
        <MetricTile icon={Gauge} label="Mean Score" value={`${Math.round((usage?.averageMeaningScore ?? 0) * 100)}%`} />
        <MetricTile icon={Activity} label="Latency" value={`${Math.round(usage?.averageLatencyMs ?? 0)}ms`} />
      </div>
    </Panel>
  );
}

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

function InfoTile({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-md border border-border bg-muted/25 p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{value}</p>
    </article>
  );
}

function ControlSelect({
  label,
  labels = {},
  value,
  options,
  onChange
}: {
  label: string;
  labels?: Record<string, string>;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor={label}>{label}</Label>
      <select
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        id={label}
        onChange={(event) => onChange(event.target.value)}
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/25 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

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
  if (!text) {
    return;
  }

  await navigator.clipboard.writeText(text);
  setNotice("Copied rewritten text.");
}

function downloadMarkdown(result: RewriteResponse | null, rewrittenText: string): void {
  if (!result) {
    return;
  }

  const content = `# OpenRewrite Export\n\n## Original\n\n${result.originalText}\n\n## Rewritten\n\n${rewrittenText}\n`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `openrewrite-${result.sessionId}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
