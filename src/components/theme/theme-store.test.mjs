import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { getAppTheme, getServerTheme, setAppTheme, subscribeToTheme, THEME_STORAGE_KEY, themeBootstrap } from "./theme-store.ts";

function browser({ stored = null, dark = false, blocked = false } = {}) {
  const media = new EventTarget();
  media.matches = dark;
  const storage = new Map(stored === null ? [] : [[THEME_STORAGE_KEY, stored]]);
  const localStorage = {
    getItem(key) { if (blocked) throw new Error("Storage denied"); return storage.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error("Storage denied"); storage.set(key, value); }
  };
  const window = new EventTarget();
  Object.assign(window, { localStorage, matchMedia: () => media });
  const document = { documentElement: { dataset: {} } };
  Object.assign(globalThis, { window, document });
  return {
    window, document, localStorage,
    system(dark) { media.matches = dark; media.dispatchEvent(new Event("change")); },
    storage(value, key = THEME_STORAGE_KEY) {
      if (value === null) storage.delete(THEME_STORAGE_KEY);
      else storage.set(THEME_STORAGE_KEY, value);
      const event = new Event("storage");
      Object.assign(event, { key, storageArea: localStorage });
      window.dispatchEvent(event);
    }
  };
}

test("server snapshot is stable without browser globals", () => {
  delete globalThis.window;
  delete globalThis.document;
  assert.equal(getServerTheme(), "light");
});

test("OS default stays live until a user explicitly selects a theme", () => {
  const env = browser({ dark: true });
  let changes = 0;
  const unsubscribe = subscribeToTheme(() => changes++);
  assert.equal(getAppTheme(), "dark");
  env.system(false);
  assert.equal(getAppTheme(), "light");
  setAppTheme("dark");
  assert.equal(env.localStorage.getItem(THEME_STORAGE_KEY), "dark");
  env.system(false);
  assert.equal(getAppTheme(), "dark");
  assert.equal(changes, 2);
  unsubscribe();
  setAppTheme("light");
  assert.equal(changes, 2, "unsubscription removes the store listener");
});

test("valid saved choice overrides OS; invalid saved choice follows OS", () => {
  browser({ stored: "light", dark: true });
  let unsubscribe = subscribeToTheme(() => {});
  assert.equal(getAppTheme(), "light");
  unsubscribe();
  browser({ stored: "not-a-theme", dark: true });
  unsubscribe = subscribeToTheme(() => {});
  assert.equal(getAppTheme(), "dark");
  unsubscribe();
});

test("another tab's selection and storage clearing are reflected in place", () => {
  const env = browser({ stored: "light", dark: true });
  const root = env.document.documentElement;
  const unsubscribe = subscribeToTheme(() => {});
  env.storage("dark");
  assert.equal(getAppTheme(), "dark");
  env.storage("light");
  assert.equal(getAppTheme(), "light");
  env.storage(null, null);
  assert.equal(getAppTheme(), "dark");
  env.system(false);
  assert.equal(getAppTheme(), "light");
  assert.equal(env.document.documentElement, root);
  unsubscribe();
});

test("storage denial does not prevent toggling or discard the tab's choice", () => {
  browser();
  const clear = subscribeToTheme(() => {});
  clear();
  const env = browser({ blocked: true, dark: true });
  const unsubscribe = subscribeToTheme(() => {});
  assert.equal(getAppTheme(), "dark");
  assert.doesNotThrow(() => setAppTheme("light"));
  assert.equal(getAppTheme(), "light");
  env.system(true);
  assert.equal(getAppTheme(), "light");
  unsubscribe();
});

test("bootstrap resolves a first-paint theme without trusting stored content", () => {
  for (const options of [
    { stored: "dark", dark: false, expected: "dark" },
    { stored: "light", dark: true, expected: "light" },
    { stored: "invalid", dark: true, expected: "dark" },
    { blocked: true, dark: true, expected: "dark" },
    { dark: false, expected: "light" }
  ]) {
    const env = browser(options);
    runInNewContext(themeBootstrap, env);
    assert.equal(env.document.documentElement.dataset.theme, options.expected);
  }
  const document = { documentElement: { dataset: {} } };
  assert.doesNotThrow(() => runInNewContext(themeBootstrap, { window: {}, document }));
  assert.equal(document.documentElement.dataset.theme, "light");
});

function contrast(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("light and dark tokens meet text and essential control contrast", () => {
  const css = readFileSync(new URL("../../app/ui-app-design.css", import.meta.url), "utf8");
  for (const selector of [":root", ':root[data-theme="dark"]']) {
    const block = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    const tokens = Object.fromEntries([...block.matchAll(/--app-([\w-]+): (#[0-9a-f]{6});/g)].map((match) => [match[1], match[2]]));
    for (const [text, background] of [
      ["text", "background"], ["text", "surface"], ["text-muted", "surface"],
      ["text-muted", "surface-hover"], ["accent-ink", "surface-muted"],
      ["success", "success-soft"], ["danger", "danger-soft"]
    ]) assert.ok(contrast(tokens[text], tokens[background]) >= 4.5, `${selector} ${text}/${background} text needs 4.5:1`);
    for (const border of ["input-border", "accent"]) {
      assert.ok(contrast(tokens[border], tokens.surface) >= 3, `${selector} ${border} needs 3:1`);
    }
  }
});
