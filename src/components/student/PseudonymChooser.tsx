"use client";

import { useEffect, useState } from "react";

import { fetchPseudonymSuggestions } from "@/lib/student-client";
import { PSEUDONYM_MAX_LENGTH } from "@/lib/student-pseudonym";

type PseudonymChooserProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  suggestions?: string[];
  seriesId?: string;
};

export function PseudonymChooser({
  value,
  onChange,
  disabled = false,
  label = "Pseudonym",
  suggestions,
  seriesId
}: PseudonymChooserProps) {
  const [localSuggestions, setLocalSuggestions] = useState<string[]>(suggestions ?? []);
  const [loading, setLoading] = useState(!suggestions);

  useEffect(() => {
    if (suggestions && suggestions.length > 0) {
      setLocalSuggestions(suggestions);
      setLoading(false);
    }
  }, [suggestions]);

  useEffect(() => {
    if (suggestions) return;
    let active = true;
    setLoading(true);
    fetchPseudonymSuggestions(seriesId).then((names) => {
      if (!active) return;
      setLocalSuggestions(names);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [suggestions, seriesId]);

  useEffect(() => {
    if (value.trim() || localSuggestions.length === 0) return;
    onChange(localSuggestions[0]!);
  }, [localSuggestions, onChange, value]);

  async function reshuffle() {
    if (disabled || loading) return;
    setLoading(true);
    try {
      const names = await fetchPseudonymSuggestions(seriesId);
      setLocalSuggestions(names);
      if (!value.trim() && names[0]) onChange(names[0]);
    } catch {
      // keep current suggestions; input stays as typed
    } finally {
      setLoading(false);
    }
  }

  const shown = localSuggestions.length > 0 ? localSuggestions : ["…", "…", "…"];

  return (
    <div className="pseudonym-choice">
      <div className="pseudonym-choice-head">
        <span>{label}</span>
        <button className="pseudonym-refresh" type="button" onClick={reshuffle} disabled={disabled || loading}>
          Neue Vorschläge
        </button>
      </div>
      <div className="pseudonym-suggestions" aria-label="Pseudonym-Vorschläge">
        {shown.map((suggestion, index) => (
          <button
            key={`${suggestion}-${index}`}
            className="pseudonym-suggestion"
            type="button"
            aria-pressed={value === suggestion}
            disabled={disabled || loading || suggestion === "…"}
            onClick={() => onChange(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <label className="pseudonym-custom">
        Eigenes Pseudonym
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="z. B. Lagerstern-42"
          autoComplete="off"
          maxLength={PSEUDONYM_MAX_LENGTH}
          disabled={disabled}
          suppressHydrationWarning
        />
      </label>
      <p className="pseudonym-unique-hint">Der Anzeigename muss in dieser Vorlesung frei sein.</p>
    </div>
  );
}
