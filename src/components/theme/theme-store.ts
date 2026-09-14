export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "learnordie.theme";
const THEME_EVENT = "learnordie:theme-change";
const SYSTEM_THEME = "(prefers-color-scheme: dark)";
let preference: AppTheme | null = null;

function parseTheme(value: string | null): AppTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

function readPreference(): AppTheme | null {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Private/embedded contexts can deny storage. Keep this tab's choice.
    return preference;
  }
}

function systemTheme(): AppTheme {
  return window.matchMedia?.(SYSTEM_THEME).matches ? "dark" : "light";
}

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function setAppTheme(theme: AppTheme) {
  preference = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Updating the UI must not depend on storage being writable.
  }
  applyTheme(theme);
}

export function getAppTheme(): AppTheme {
  return parseTheme(document.documentElement.dataset.theme ?? null) ?? "light";
}

export function getServerTheme(): AppTheme {
  // A stable server snapshot keeps hydration independent of browser storage.
  return "light";
}

export function subscribeToTheme(onChange: () => void) {
  const media = window.matchMedia?.(SYSTEM_THEME);
  preference = readPreference();
  applyTheme(preference ?? systemTheme());

  const onSystemChange = () => {
    if (preference === null) applyTheme(systemTheme());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    preference = readPreference();
    applyTheme(preference ?? systemTheme());
  };

  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media?.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener("change", onSystemChange);
  };
}

// Static, trusted script: run in <head> before paint, without user interpolation.
// The CSS OS fallback still applies when JavaScript is disabled.
export const themeBootstrap = `(()=>{let t;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch{}if(t!=="light"&&t!=="dark")t=window.matchMedia?.("${SYSTEM_THEME}").matches?"dark":"light";document.documentElement.dataset.theme=t})()`;
