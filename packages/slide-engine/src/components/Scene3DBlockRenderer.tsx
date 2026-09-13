"use client";

import { useEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

import type { ModellSceneHost } from "../scenes/modell-host";
import {
  createModellSceneState,
  formatModellNumber,
  modellConcepts,
  modellFallbackDataUri,
  modellFitEquation,
  modellLanguageContexts,
  modellLoss,
  modellPredict,
  modellTransferSteps,
  modellTransferText,
  resetModellLearning,
  trainModellStep
} from "../scenes/modell-state";
import type { ModellSceneKey, ModellSceneState } from "../scenes/modell-types";
import { modellTheme } from "../scenes/modell-theme";
import { scene3dSceneKey } from "../scenes/scene-ids";
import type { Scene3DBlock } from "./types";

// Unterhalb dieser Breite (Studio-Miniaturen, Uebersichten) bleibt die Szene eine
// 2D-Ersatzansicht, damit nicht jede Miniatur einen WebGL-Kontext belegt.
const MIN_INTERACTIVE_WIDTH = 280;

type SceneMode = "fallback" | "live";

export function Scene3DBlockRenderer({ block }: { block: Scene3DBlock }) {
  const sceneKey = scene3dSceneKey(block.sceneId);
  const [dark, setDark] = useState(false);
  const palette = modellTheme(dark);
  const accent = palette.accent;
  const rootRef = useRef<HTMLElement | null>(null);
  const portRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<ModellSceneHost | null>(null);
  // Animationen starten bei "Bewegung reduzieren" pausiert, wie in der Vorlage.
  const [state] = useState<ModellSceneState>(() => createModellSceneState(!prefersReducedMotion()));
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [inView, setInView] = useState(false);
  const [wide, setWide] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<SceneMode>("fallback");
  const interactive = inView && wide && !failed;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const explicit = document.documentElement.dataset.theme;
      setDark(explicit ? explicit === "dark" : media.matches);
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", sync);
    sync();
    return () => { observer.disconnect(); media.removeEventListener("change", sync); };
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const intersection = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "160px" }
    );
    const resize = new ResizeObserver(() => setWide(element.clientWidth >= MIN_INTERACTIVE_WIDTH));
    intersection.observe(element);
    resize.observe(element);
    return () => {
      intersection.disconnect();
      resize.disconnect();
    };
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    // Nativ am Element, weil React seine Listener am document registriert und dort
    // die Folien-Tastenkuerzel nicht mehr aufhalten kann. Nur Tasten, die das
    // fokussierte Bedienelement selbst verbraucht, bleiben in der Szene.
    const rangeKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
    const keepControlKeys = (event: KeyboardEvent) => {
      const target = event.target;
      const isRange = target instanceof HTMLInputElement && target.type === "range";
      const isButton = target instanceof HTMLButtonElement;
      if ((isRange && rangeKeys.has(event.key)) || (isButton && (event.key === " " || event.key === "Enter"))) {
        event.stopPropagation();
      }
    };
    element.addEventListener("keydown", keepControlKeys);
    return () => element.removeEventListener("keydown", keepControlKeys);
  }, []);

  useEffect(() => {
    if (!interactive) return;
    let cancelled = false;
    let frameId = 0;
    let host: ModellSceneHost | null = null;

    Promise.all([import("three"), import("../scenes/modell-host")])
      .then(([three, { ModellSceneHost: Host }]) => {
        const port = portRef.current;
        const labels = labelsRef.current;
        if (cancelled || !port || !labels) return;
        host = new Host(three, {
          port,
          labels,
          state,
          theme: modellTheme(dark),
          ariaLabel: block.altText,
          onFail: () => setFailed(true)
        });
        if (host.failed) return;
        host.set(sceneKey);
        host.render(state.sceneTime, 0);
        hostRef.current = host;
        setMode("live");

        let lastFrame = 0;
        let lastUi = 0;
        const frame = (now: number) => {
          frameId = requestAnimationFrame(frame);
          if (document.hidden) {
            lastFrame = now;
            return;
          }
          if (now - lastFrame < 31) return;
          let dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.065) : 0.033;
          lastFrame = now;
          if (!state.playing) dt = 0;
          state.sceneTime += dt;
          if (sceneKey === "learning") trainModellStep(state, dt);
          if (sceneKey === "language" && !state.tokenAdded && state.playing) {
            state.langStep = Math.floor(state.sceneTime * 0.65) % 5;
          }
          host?.render(state.sceneTime, dt);
          if ((sceneKey === "learning" || sceneKey === "language") && now - lastUi > 120) {
            lastUi = now;
            rerender();
          }
        };
        frameId = requestAnimationFrame(frame);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      host?.destroy();
      hostRef.current = null;
      setMode("fallback");
    };
  }, [block.altText, dark, interactive, sceneKey, state]);

  const update = (mutate: (next: ModellSceneState) => void) => {
    mutate(state);
    rerender();
  };

  // Nach Mausbedienung geht der Fokus zurueck an die Folie, damit Leertaste (Quiz)
  // und Pfeiltasten (Navigation) sofort wieder greifen. Tastaturnutzer behalten den Fokus.
  const releasePointerFocus = (event: PointerEvent<HTMLDivElement>) => {
    const control = (event.target as HTMLElement).closest("button, input");
    if (control instanceof HTMLElement) requestAnimationFrame(() => control.blur());
  };

  const rootStyle = {
    "--lb-scene-ground": palette.paper,
    "--lb-scene-panel": palette.panel,
    "--lb-scene-ink": palette.ink,
    "--lb-scene-muted": palette.muted,
    "--lb-scene-line": palette.line,
    "--lb-scene-fill": palette.fill,
    "--lb-scene-secondary": palette.secondary,
    "--lb-scene-accent": accent,
    "--lb-scene-rgb": hexToRgb(accent)
  } as CSSProperties;

  return (
    <figure
      className="lb-scene3d"
      data-block-id={block.id}
      data-block-type={block.type}
      data-scene-id={block.sceneId}
      data-scene-mode={failed ? "no-webgl" : mode}
      data-scene-theme={dark ? "dark" : "light"}
      ref={rootRef}
      style={rootStyle}
    >
      <div className="lb-scene3d-stage">
        {mode === "live" ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- lokal erzeugte SVG-Ersatzansicht als data-URI
          <img
            alt={block.altText}
            className="lb-scene3d-fallback"
            src={modellFallbackDataUri(sceneKey, state, accent, block.altText, dark, true)}
          />
        )}
        <div className="lb-scene3d-port" hidden={mode !== "live"} ref={portRef}>
          <div aria-hidden="true" className="lb-scene3d-labels" ref={labelsRef} />
        </div>
        {mode === "live" ? (
          <div className="lb-scene3d-tools" onPointerUp={releasePointerFocus}>
            <button
              aria-label={state.playing ? "Animation pausieren" : "Animation fortsetzen"}
              aria-pressed={!state.playing}
              className="lb-scene3d-tool"
              type="button"
              onClick={() => update((next) => {
                next.playing = !next.playing;
              })}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={state.playing ? "M8 5v14M16 5v14" : "m7 4 13 8-13 8Z"} /></svg>
            </button>
            <button
              aria-label="3D-Blick zurücksetzen"
              className="lb-scene3d-tool"
              type="button"
              onClick={() => hostRef.current?.reset()}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></svg>
            </button>
          </div>
        ) : null}
        {failed ? <span className="lb-scene3d-note">WebGL ist nicht verfügbar. Die Inhalte bleiben als 2D-Ersatzansicht zugänglich.</span> : null}
      </div>
      {wide ? (
        <div aria-label="Steuerung der Demonstration" className="lb-scene3d-controls" role="group" onPointerUp={releasePointerFocus}>
          <SceneControls sceneKey={sceneKey} state={state} update={update} />
        </div>
      ) : null}
      {block.caption ? <figcaption className="lb-scene3d-caption lb-scene3d-accessible-description">{block.caption}</figcaption> : null}
    </figure>
  );
}

type ControlsProps = {
  sceneKey: ModellSceneKey;
  state: ModellSceneState;
  update: (mutate: (next: ModellSceneState) => void) => void;
};

function SceneControls({ sceneKey, state, update }: ControlsProps) {
  switch (sceneKey) {
    case "morph":
      return (
        <>
          <RangeRow
            id="morph"
            label="Begriff"
            max={4}
            min={0}
            output={modellConcepts[Math.round(state.morph)]}
            step={0.01}
            value={state.morph}
            onChange={(value) => update((next) => { next.morph = value; })}
          />
          <div className="lb-scene3d-stops">
            {modellConcepts.map((concept, index) => (
              <span data-active={index === Math.round(state.morph) ? "true" : undefined} key={concept}>{concept}</span>
            ))}
          </div>
        </>
      );
    case "miniature":
      return (
        <RangeRow
          id="abstraction"
          label="Abstraktion"
          max={1}
          min={0}
          output={`${Math.round(state.abstraction * 100)} %`}
          step={0.01}
          value={state.abstraction}
          onChange={(value) => update((next) => { next.abstraction = value; })}
        />
      );
    case "law":
      return (
        <>
        <RangeRow
          id="stiffness"
          label="Steifigkeit k"
          max={9}
          min={1}
          output={`${formatModellNumber(state.stiffness, 1)} N/m`}
          step={0.1}
          value={state.stiffness}
          onChange={(value) => update((next) => { next.stiffness = value; })}
        />
        <output aria-label="Kreisfrequenz" className="lb-scene3d-math">ω = {formatModellNumber(Math.sqrt(state.stiffness))} rad/s</output>
        <span className="lb-scene3d-math">m = 1 kg</span>
        <p className="lb-scene3d-accessible-description">Ideale hängende Feder ohne Dämpfung. Die Verlängerung wird ab der unbelasteten Lage nach unten gemessen. Die Ruhelage liegt bei mg/k. Eine Änderung der Steifigkeit führt Arbeit zu oder ab; Position und Geschwindigkeit bleiben dabei stetig.</p>
        </>
      );
    case "limits":
      return (
        <>
          <div className="lb-scene3d-row">
            <Segmented
              label="Mathematische Beschreibung"
              options={[["force", "Kraftbilanz"], ["energy", "Energie"]]}
              value={state.description}
              onChange={(value) => update((next) => { next.description = value; })}
            />
            <span className="lb-scene3d-math">{state.description === "energy" ? "E = ½mv² + ½kx²" : "F = −k · x"}</span>
          </div>
          <p className="lb-scene3d-explain">{state.description === "energy" ? "Die Energie wechselt ihre Form; die Summe bleibt konstant." : "Die Rückstellkraft wirkt der Auslenkung entgegen."}</p>
          {state.description === "energy" && <div className="lb-scene3d-row" aria-label="Energielegende"><span><span style={{ color: "var(--lb-scene-secondary)" }} aria-hidden="true">●</span> Bewegungsenergie</span><span><span style={{ color: "var(--lb-scene-accent)" }} aria-hidden="true">●</span> Federenergie</span></div>}
        </>
      );
    case "runtime":
      return (
        <>
          <RangeRow
            id="inputX"
            label="Eingang x"
            max={1}
            min={-1}
            output={formatModellNumber(state.inputX)}
            step={0.01}
            value={state.inputX}
            onChange={(value) => update((next) => {
              next.inputX = value;
              if (next.executing) next.outputAngle = value * 60;
            })}
          />
          <div className="lb-scene3d-row">
            <button
              aria-pressed={state.executing}
              className="lb-scene3d-button"
              data-primary="true"
              type="button"
              onClick={() => update((next) => {
                next.executing = !next.executing;
                if (next.executing) next.outputAngle = next.inputX * 60;
              })}
            >
              {state.executing ? "Ausführung anhalten" : "Ausführung starten"}
            </button>
            <Stats items={[["Ausgang", `${formatModellNumber(state.outputAngle, 1)}°`], ["Status", state.executing ? "aktiv" : "halten"]]} />
          </div>
        </>
      );
    case "learning":
      return (
        <>
          <div className="lb-scene3d-row" aria-label="Diagrammlegende"><span><span style={{ color: "var(--lb-scene-ink)" }} aria-hidden="true">●</span> Beispieldaten</span><span><span style={{ color: "var(--lb-scene-secondary)" }} aria-hidden="true">━</span> Modell</span><span><span style={{ color: "var(--lb-scene-accent)" }} aria-hidden="true">●</span> Auswertung</span></div>
          <div className="lb-scene3d-row">
            <button
              className="lb-scene3d-button"
              data-primary="true"
              type="button"
              onClick={() => update((next) => {
                if (next.trainingRunning) {
                  next.trainingRunning = false;
                } else {
                  if (next.steps >= next.trainingLimit) next.trainingLimit += 400;
                  next.trainingRunning = true;
                  next.playing = true;
                }
              })}
            >
              {state.trainingRunning ? "Lernen anhalten" : state.steps ? "Weiterlernen" : "Lernen starten"}
            </button>
            <button className="lb-scene3d-button" type="button" onClick={() => update(resetModellLearning)}>
              Zurücksetzen
            </button>
            <Stats items={[["Schritte", String(state.steps)], ["Fehler", formatModellNumber(modellLoss(state), 4)]]} />
          </div>
          <RangeRow
            id="inferX"
            label="Eingabe x"
            max={1}
            min={-1}
            output={formatModellNumber(state.inferX)}
            step={0.01}
            value={state.inferX}
            onChange={(value) => update((next) => { next.inferX = value; })}
          />
          <div className="lb-scene3d-row">
            <span className="lb-scene3d-math">{modellFitEquation(state)}</span>
            <Stats items={[["Auswertung", formatModellNumber(modellPredict(state, state.inferX), 3)]]} />
          </div>
        </>
      );
    case "language": {
      const context = modellLanguageContexts[state.context];
      return (
        <>
          <div className="lb-scene3d-row">
            <Segmented
              label="Beispielkontext"
              options={[[0, modellLanguageContexts[0].label], [1, modellLanguageContexts[1].label]]}
              value={state.context}
              onChange={(value) => update((next) => {
                next.context = value;
                next.tokenAdded = false;
                next.langStep = 0;
              })}
            />
            <button
              className="lb-scene3d-button"
              data-primary="true"
              type="button"
              onClick={() => update((next) => {
                next.tokenAdded = !next.tokenAdded;
                next.langStep = next.tokenAdded ? 4 : 0;
              })}
            >
              {state.tokenAdded ? "Neu beginnen" : "Token ergänzen"}
            </button>
          </div>
          <div className="lb-scene3d-row lb-scene3d-tokens">
            {context.words.map((word) => <span key={word}>{word}</span>)}
            {state.tokenAdded
              ? <span data-token="new">{context.candidates[0][0]}</span>
              : <span data-token="cursor">…</span>}
          </div>
          <div className="lb-scene3d-row lb-scene3d-candidates">
            {context.candidates.map(([word, share]) => (
              <span key={word}>{word} <b>{share} %</b></span>
            ))}
          </div>
        </>
      );
    }
    case "transfer":
      return (
        <>
          <div aria-label="Gestaltungsaufgaben" className="lb-scene3d-steps" role="group">
            {modellTransferSteps.map((step, index) => (
              <button
                aria-pressed={state.transferStep === index}
                key={step}
                type="button"
                onClick={() => update((next) => { next.transferStep = index; })}
              >
                {step}
              </button>
            ))}
          </div>
          <p key={state.transferStep} className="lb-scene3d-explain">{modellTransferText[state.transferStep]}</p>
        </>
      );
  }
}

function RangeRow({
  id,
  label,
  min,
  max,
  step,
  value,
  output,
  onChange
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  output: ReactNode;
  onChange: (value: number) => void;
}) {
  return (
    <label className="lb-scene3d-row lb-scene3d-range" data-control={id}>
      <span className="lb-scene3d-range-label">{label}</span>
      <input
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output className="lb-scene3d-range-value">{output}</output>
    </label>
  );
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: Array<[T, string]>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="lb-scene3d-segmented" role="group">
      {options.map(([optionValue, optionLabel]) => (
        <button
          aria-pressed={optionValue === value}
          key={String(optionValue)}
          type="button"
          onClick={() => onChange(optionValue)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

function Stats({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="lb-scene3d-stats">
      {items.map(([label, value]) => (
        <span key={label}>
          {label}
          <b>{value}</b>
        </span>
      ))}
    </div>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function hexToRgb(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g) ?? ["e5", "c4", "8c"];
  return channels.map((channel) => parseInt(channel, 16)).join(",");
}
