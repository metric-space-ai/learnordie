"use client";

import { useAppTheme } from "./ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useAppTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      className={`theme-toggle app-theme-toggle ${className}`.trim()}
      aria-label="Dunkles Design"
      aria-pressed={dark}
      title={dark ? "Helles Design verwenden" : "Dunkles Design verwenden"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <svg className="app-theme-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </svg>
      <svg className="app-theme-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />
      </svg>
      <span>Design</span>
    </button>
  );
}
