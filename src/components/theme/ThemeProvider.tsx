"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { getAppTheme, getServerTheme, setAppTheme, subscribeToTheme, type AppTheme } from "./theme-store";

export type { AppTheme } from "./theme-store";

type AppThemeContext = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
};

const ThemeContext = createContext<AppThemeContext | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, getAppTheme, getServerTheme);
  const value = useMemo(() => ({ theme, setTheme: setAppTheme }), [theme]);

  // No theme key or conditional subtree: editors, forms and sessions stay mounted.
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContext {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useAppTheme must be used inside ThemeProvider");
  return context;
}
