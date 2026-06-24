"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  DeckRenderer,
  applySlideDocumentEdits,
  slideLayoutIdValues,
  type SlideBlock,
  type SlideBlockPatch,
  type SlideBlockSelection,
  type SlideDocument,
  type SlideDocumentEditOperation,
  type SlideLayoutId
} from "@learnordie/slide-engine";

export function SlideEngineEditorFixture({
  document,
  initialSlideId
}: {
  document: SlideDocument;
  initialSlideId?: string;
}) {
  const [draft, setDraft] = useState<SlideDocument>(() => cloneDocument(document));
  const initialIndex = useMemo(() => {
    const index = document.slides.findIndex((slide) => slide.id === initialSlideId);
    return index >= 0 ? index : 0;
  }, [document.slides, initialSlideId]);
  const [current, setCurrent] = useState(initialIndex);
  const currentSlide = draft.slides[current] ?? draft.slides[0];
  const firstEditableBlock = currentSlide?.blocks.find((block) => block.type !== "spacer") ?? currentSlide?.blocks[0];
  const [selectedBlockId, setSelectedBlockId] = useState(firstEditableBlock?.id ?? "");
  const selectedBlock = currentSlide?.blocks.find((block) => block.id === selectedBlockId) ?? firstEditableBlock;
  const selectedField = selectedBlock ? editableField(selectedBlock) : null;
  const selectedTable = selectedBlock?.type === "table" ? selectedBlock : null;
  const [editorValue, setEditorValue] = useState(selectedField?.value ?? "");
  const [tableRowIndex, setTableRowIndex] = useState(0);
  const [tableColumnIndex, setTableColumnIndex] = useState(0);
  const [tableCellValue, setTableCellValue] = useState("");
  const [status, setStatus] = useState("Bereit.");
  const [issue, setIssue] = useState("");

  useEffect(() => {
    const nextBlock = draft.slides[current]?.blocks.find((block) => block.type !== "spacer") ?? draft.slides[current]?.blocks[0];
    setSelectedBlockId((blockId) => {
      if (draft.slides[current]?.blocks.some((block) => block.id === blockId)) return blockId;
      return nextBlock?.id ?? "";
    });
  }, [current, draft.slides]);

  useEffect(() => {
    setEditorValue(selectedField?.value ?? "");
  }, [selectedField?.key, selectedField?.value, selectedBlock?.id]);

  useEffect(() => {
    if (!selectedTable) {
      setTableCellValue("");
      return;
    }

    const nextRowIndex = clampIndex(tableRowIndex, selectedTable.rows.length - 1);
    const nextColumnIndex = clampIndex(tableColumnIndex, selectedTable.columns.length - 1);
    if (nextRowIndex !== tableRowIndex) setTableRowIndex(nextRowIndex);
    if (nextColumnIndex !== tableColumnIndex) setTableColumnIndex(nextColumnIndex);
    setTableCellValue(selectedTable.rows[nextRowIndex]?.[nextColumnIndex] ?? "");
  }, [selectedTable, tableColumnIndex, tableRowIndex]);

  const previous = useCallback(() => {
    setCurrent((index) => (index + draft.slides.length - 1) % draft.slides.length);
  }, [draft.slides.length]);

  const next = useCallback(() => {
    setCurrent((index) => (index + 1) % draft.slides.length);
  }, [draft.slides.length]);

  const selectBlock = useCallback((selection: SlideBlockSelection) => {
    const slideIndex = draft.slides.findIndex((slide) => slide.id === selection.slideId);
    if (slideIndex >= 0) setCurrent(slideIndex);
    setSelectedBlockId(selection.blockId);
    setStatus(`Block ${selection.blockId} ausgewählt.`);
    setIssue("");
  }, [draft.slides]);

  const applyOperations = useCallback((operations: SlideDocumentEditOperation[], successMessage: string) => {
    const result = applySlideDocumentEdits(draft, operations);
    if (!result.ok) {
      const firstIssue = result.issues[0];
      setIssue(firstIssue ? `${firstIssue.code}: ${firstIssue.repairHint}` : "Unbekannter Validierungsfehler.");
      setStatus("Nicht gespeichert.");
      return false;
    }

    setDraft(result.document);
    setStatus(successMessage);
    setIssue("");
    return true;
  }, [draft]);

  const saveText = () => {
    if (!currentSlide || !selectedBlock || !selectedField) return;
    const patch = selectedField.patch(editorValue);
    applyOperations([
      {
        operationId: `manual-patch-${selectedBlock.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedBlock.id,
        patch
      }
    ], "Block gespeichert und validiert.");
  };

  const updateLayout = (layout: SlideLayoutId) => {
    if (!currentSlide) return;
    applyOperations([
      {
        operationId: `manual-layout-${currentSlide.id}`,
        kind: "updateSlide",
        slideId: currentSlide.id,
        patch: { layout }
      }
    ], "Layout gespeichert und validiert.");
  };

  const replaceFigureAsset = () => {
    if (!currentSlide || selectedBlock?.type !== "figure") return;
    applyOperations([
      {
        operationId: "manual-upsert-editor-asset",
        kind: "upsertAsset",
        asset: {
          id: "asset-editor-bearing-detail",
          kind: "diagram",
          title: "Editor-Demo: Schmierfilm-Detail",
          url: editorDemoAssetUrl,
          altText: "Abstrahierte Detailgrafik eines Schmierfilms im Gleitlager.",
          source: {
            id: "source-editor-demo",
            sourceType: "manual",
            label: "Editor-QA"
          },
          quality: { needsReview: false }
        }
      },
      {
        operationId: "manual-replace-figure-asset",
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedBlock.id,
        patch: {
          assetId: "asset-editor-bearing-detail",
          caption: "Asset über den SlideDocument-Editor ersetzt"
        }
      }
    ], "Bildasset ersetzt und validiert.");
  };

  const saveTableCell = () => {
    if (!currentSlide || !selectedTable) return;
    const columnCount = selectedTable.columns.length;
    const rows = selectedTable.rows.map((row, rowIndex) => (
      normalizeTableRow(row, columnCount).map((cell, columnIndex) => (
        rowIndex === tableRowIndex && columnIndex === tableColumnIndex ? tableCellValue : cell
      ))
    ));
    applyOperations([
      {
        operationId: `manual-table-cell-${selectedTable.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedTable.id,
        patch: { rows }
      }
    ], "Tabellenzelle gespeichert und validiert.");
  };

  const addTableRow = () => {
    if (!currentSlide || !selectedTable) return;
    const nextRow = selectedTable.columns.map((_, index) => (index === 0 ? "Neue Zeile" : ""));
    const nextRowIndex = selectedTable.rows.length;
    if (applyOperations([
      {
        operationId: `manual-table-row-${selectedTable.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedTable.id,
        patch: { rows: [...selectedTable.rows, nextRow] }
      }
    ], "Tabellenzeile ergänzt und validiert.")) {
      setTableRowIndex(nextRowIndex);
      setTableColumnIndex(0);
    }
  };

  const addTableColumn = () => {
    if (!currentSlide || !selectedTable || selectedTable.columns.length >= 8) return;
    const nextColumnIndex = selectedTable.columns.length;
    const columns = [...selectedTable.columns, `Spalte ${nextColumnIndex + 1}`];
    const rows = selectedTable.rows.map((row) => [...normalizeTableRow(row, selectedTable.columns.length), ""]);
    if (applyOperations([
      {
        operationId: `manual-table-column-${selectedTable.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedTable.id,
        patch: { columns, rows }
      }
    ], "Tabellenspalte ergänzt und validiert.")) {
      setTableColumnIndex(nextColumnIndex);
    }
  };

  const upsertQuizAnchor = () => {
    if (!currentSlide || !selectedBlock) return;
    applyOperations([
      {
        operationId: "manual-upsert-quiz-anchor",
        kind: "upsertQuizAnchor",
        slideId: currentSlide.id,
        anchor: {
          id: `anchor-${selectedBlock.id}`,
          level: "2.0",
          blockId: selectedBlock.id,
          label: `Frage zu ${selectedBlock.id}`
        }
      }
    ], "Quizanker gesetzt und validiert.");
  };

  const runInvalidPatch = () => {
    if (!currentSlide || !selectedBlock) return;
    applyOperations([
      {
        operationId: "manual-invalid-html-patch",
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedBlock.id,
        patch: { unsafeHtml: "<script>alert('x')</script>" }
      }
    ], "Ungültiger Patch wurde akzeptiert.");
  };

  return (
    <main className="slide-engine-editor-screen lb-motion-root" data-slide-engine-qa="editor" style={screenStyle}>
      <section style={stageColumnStyle}>
        <article
          className="slide-engine-editor-stage lb-enter-stage"
          data-slide-engine="v1"
          data-slide-id={currentSlide?.id}
          style={stageStyle}
        >
          <DeckRenderer
            className="slide-engine-deck"
            currentSlideId={currentSlide?.id}
            document={draft}
            renderMode="current"
            selectedBlockId={selectedBlock?.id}
            onBlockSelect={selectBlock}
          />
        </article>
        <nav className="slide-engine-editor-nav lb-enter-control" aria-label="Foliennavigation" style={navStyle}>
          <button type="button" onClick={previous} aria-label="Vorherige Folie">‹</button>
          <span className="slide-count">{current + 1} / {draft.slides.length}</span>
          <button type="button" onClick={next} aria-label="Nächste Folie">›</button>
        </nav>
      </section>

      <aside
        aria-label="SlideDocument Editor"
        data-edit-status={issue ? "invalid" : "valid"}
        data-quiz-anchor-count={currentSlide?.quizAnchors?.length ?? 0}
        data-selected-block-id={selectedBlock?.id ?? ""}
        style={editorPanelStyle}
      >
        <div style={panelHeaderStyle}>
          <span style={eyebrowStyle}>SlideDocument Editor</span>
          <strong>{selectedBlock?.id ?? "Kein Block"}</strong>
          <small>{selectedBlock?.type ?? "n/a"} · {currentSlide?.layout}</small>
        </div>

        <label style={fieldStyle}>
          <span>Layout</span>
          <select
            aria-label="Layout wählen"
            value={currentSlide?.layout ?? "technical_one_column"}
            onChange={(event) => updateLayout(event.currentTarget.value as SlideLayoutId)}
          >
            {slideLayoutIdValues.map((layout) => (
              <option key={layout} value={layout}>{layout}</option>
            ))}
          </select>
        </label>

        {selectedField ? (
          <label style={fieldStyle}>
            <span>{selectedField.label}</span>
            <textarea
              aria-label="Blockinhalt bearbeiten"
              rows={6}
              value={editorValue}
              onChange={(event) => setEditorValue(event.currentTarget.value)}
            />
          </label>
        ) : null}

        {selectedTable ? (
          <div aria-label="Tabelleneditor" style={tableEditorStyle}>
            <label style={fieldStyle}>
              <span>Zeile</span>
              <select
                aria-label="Tabellenzeile"
                value={tableRowIndex}
                onChange={(event) => setTableRowIndex(Number(event.currentTarget.value))}
              >
                {selectedTable.rows.map((_, rowIndex) => (
                  <option key={rowIndex} value={rowIndex}>Zeile {rowIndex + 1}</option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span>Spalte</span>
              <select
                aria-label="Tabellenspalte"
                value={tableColumnIndex}
                onChange={(event) => setTableColumnIndex(Number(event.currentTarget.value))}
              >
                {selectedTable.columns.map((column, columnIndex) => (
                  <option key={`${column}-${columnIndex}`} value={columnIndex}>{column}</option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span>Zelle</span>
              <input
                aria-label="Tabellenzelle bearbeiten"
                value={tableCellValue}
                onChange={(event) => setTableCellValue(event.currentTarget.value)}
              />
            </label>
            <div style={buttonGridStyle}>
              <button type="button" onClick={saveTableCell}>Zelle speichern</button>
              <button type="button" onClick={addTableRow}>Zeile hinzufügen</button>
              <button type="button" disabled={selectedTable.columns.length >= 8} onClick={addTableColumn}>
                Spalte hinzufügen
              </button>
            </div>
          </div>
        ) : null}

        <div style={buttonGridStyle}>
          <button type="button" disabled={!selectedField} onClick={saveText}>Block speichern</button>
          <button type="button" disabled={selectedBlock?.type !== "figure"} onClick={replaceFigureAsset}>
            Bildasset ersetzen
          </button>
          <button type="button" onClick={upsertQuizAnchor}>Quizanker setzen</button>
          <button type="button" onClick={runInvalidPatch}>Repair-Fehler testen</button>
        </div>

        <p aria-live="polite" style={statusStyle}>{status}</p>
        {issue ? <p role="alert" style={issueStyle}>{issue}</p> : null}

        <details style={detailsStyle}>
          <summary>Agent Contract</summary>
          <code>operationId + slideId + blockId + schema validation</code>
        </details>
      </aside>
    </main>
  );
}

function editableField(block: SlideBlock): {
  key: string;
  label: string;
  value: string;
  patch: (value: string) => SlideBlockPatch;
} | null {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return { key: "text", label: "Text", value: block.text, patch: (text) => ({ text }) };
    case "callout":
      return { key: "text", label: "Callout-Text", value: block.text, patch: (text) => ({ text }) };
    case "definition":
      return {
        key: "definition",
        label: "Definition",
        value: block.definition,
        patch: (definition) => ({ definition })
      };
    case "figure":
      return {
        key: "caption",
        label: "Bildunterschrift",
        value: block.caption ?? "",
        patch: (caption) => ({ caption: caption.trim() || undefined })
      };
    case "formula":
      return {
        key: "latex",
        label: "Formel",
        value: block.latex ?? block.mathMl ?? "",
        patch: (latex) => ({ latex, mathMl: undefined })
      };
    case "code":
      return { key: "code", label: "Code", value: block.code, patch: (code) => ({ code }) };
    default:
      return null;
  }
}

function cloneDocument(document: SlideDocument): SlideDocument {
  return JSON.parse(JSON.stringify(document)) as SlideDocument;
}

function clampIndex(index: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(index, max));
}

function normalizeTableRow(row: string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

const editorDemoAssetUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" rx="30" fill="#edf6f8"/>
  <path d="M92 250c78-95 171-97 276-20 66 49 119 39 178-76" fill="none" stroke="#2b82ad" stroke-width="18" stroke-linecap="round"/>
  <path d="M160 190c82 70 201 55 270-62" fill="none" stroke="#c28516" stroke-width="22" stroke-linecap="round"/>
  <circle cx="305" cy="160" r="74" fill="#f8fbfc" stroke="#36515c" stroke-width="12"/>
  <text x="84" y="70" fill="#001926" font-family="Arial" font-size="34" font-weight="700">Schmierfilm-Detail</text>
</svg>
`)}`;

const screenStyle: CSSProperties = {
  alignItems: "stretch",
  background:
    "linear-gradient(90deg, oklch(72% 0.024 230 / 0.055) 1px, transparent 1px), linear-gradient(180deg, oklch(72% 0.024 230 / 0.055) 1px, transparent 1px), var(--slide)",
  backgroundSize: "42px 42px, 42px 42px, auto",
  display: "grid",
  gap: 18,
  minHeight: "100svh",
  overflowX: "hidden",
  padding: 18
};

const stageColumnStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  minWidth: 0
};

const stageStyle: CSSProperties = {
  display: "grid",
  minHeight: 0,
  minWidth: 0
};

const navStyle: CSSProperties = {
  alignItems: "center",
  display: "inline-flex",
  gap: 10,
  justifySelf: "center"
};

const editorPanelStyle: CSSProperties = {
  alignSelf: "start",
  display: "grid",
  gap: 14,
  minWidth: 0,
  padding: 18,
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-stage)",
  background: "var(--panel)",
  color: "var(--ink)",
  boxShadow: "var(--shadow)"
};

const panelHeaderStyle: CSSProperties = {
  display: "grid",
  gap: 5
};

const eyebrowStyle: CSSProperties = {
  color: "var(--muted)",
  fontSize: 12,
  fontWeight: 860,
  letterSpacing: 0,
  textTransform: "uppercase"
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: 7,
  fontSize: 13,
  fontWeight: 760
};

const buttonGridStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  gridTemplateColumns: "1fr 1fr"
};

const tableEditorStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 12,
  border: "1px solid var(--line)",
  borderRadius: "var(--lb-radius-panel)",
  background: "var(--panel-soft)"
};

const statusStyle: CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: 13,
  fontWeight: 760
};

const issueStyle: CSSProperties = {
  margin: 0,
  padding: 10,
  border: "1px solid var(--red)",
  borderRadius: "var(--lb-radius-panel)",
  background: "var(--red-soft)",
  color: "var(--ink)",
  fontSize: 13,
  fontWeight: 760
};

const detailsStyle: CSSProperties = {
  color: "var(--muted)",
  fontSize: 12
};
