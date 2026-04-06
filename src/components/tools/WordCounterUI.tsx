"use client";

import { useMemo, useState } from "react";

interface Stats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  readingTime: string;
}

function computeStats(text: string): Stats {
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, "").length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sentences = text.trim() ? (text.match(/[.!?]+\s|[.!?]+$/g) || []).length || (words > 0 ? 1 : 0) : 0;
  const paragraphs = text.trim() ? text.split(/\n\s*\n/).filter((p) => p.trim()).length || (words > 0 ? 1 : 0) : 0;

  const mins = Math.ceil(words / 225);
  const readingTime = mins < 1 ? "< 1 min" : `${mins} min`;

  return { characters, charactersNoSpaces, words, sentences, paragraphs, readingTime };
}

export function WordCounterUI() {
  const [input, setInput] = useState("");
  const stats = useMemo(() => computeStats(input), [input]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Enter or paste your text</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Start typing or paste your text here..."
          rows={10}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary resize-y placeholder:text-text-muted"
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Characters", value: stats.characters },
          { label: "Characters (no spaces)", value: stats.charactersNoSpaces },
          { label: "Words", value: stats.words },
          { label: "Sentences", value: stats.sentences },
          { label: "Paragraphs", value: stats.paragraphs },
          { label: "Reading Time", value: stats.readingTime },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border bg-bg-secondary p-4 text-center"
          >
            <p className="text-2xl font-bold text-text-primary font-mono">{stat.value}</p>
            <p className="text-xs text-text-muted mt-1">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
