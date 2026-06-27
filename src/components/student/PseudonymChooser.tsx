"use client";

import { useMemo } from "react";

import { suggestPseudonyms } from "@/lib/student-pseudonym";

type PseudonymChooserProps = {
  value: string;
  onChange: (value: string) => void;
  seed: string;
  disabled?: boolean;
  label?: string;
};

export function PseudonymChooser({
  value,
  onChange,
  seed,
  disabled = false,
  label = "Pseudonym"
}: PseudonymChooserProps) {
  const suggestions = useMemo(() => suggestPseudonyms(seed), [seed]);

  return (
    <div className="pseudonym-choice">
      <div className="pseudonym-choice-head">
        <span>{label}</span>
        <small>kein Klarname</small>
      </div>
      <div className="pseudonym-suggestions" aria-label="Pseudonym-Vorschläge">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            className="pseudonym-suggestion"
            type="button"
            aria-pressed={value === suggestion}
            disabled={disabled}
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
          maxLength={80}
          disabled={disabled}
          suppressHydrationWarning
        />
      </label>
    </div>
  );
}
