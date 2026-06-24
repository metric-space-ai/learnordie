"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Slide } from "@/lib/types";
import {
  DeckRenderer,
  applySlideDocumentEdits,
  legacyDiagramAssetId,
  questionLevelValues,
  slideLayoutIdValues,
  legacySlidesToSlideDocument,
  slideDocumentToLegacySlides,
  type QuestionLevel,
  type SlideAssetKind,
  type SlideBlock,
  type SlideBlockPatch,
  type SlideBlockSelection,
  type SlideDocument,
  type SlideDocumentEditOperation,
  type SlideLayoutId
} from "@learnordie/slide-engine";
import type { SlideAsset } from "@learnordie/slide-engine/components";
import { Diagram } from "../Diagram";

type StudioSlideDocumentEditorProps = {
  currentIndex: number;
  seriesTitle: string;
  slides: Slide[];
  slideDocument?: SlideDocument;
  onSlideDocumentChange: (document: SlideDocument, slides: Slide[]) => void;
};

export function StudioSlideDocumentEditor({
  currentIndex,
  seriesTitle,
  slides,
  slideDocument,
  onSlideDocumentChange
}: StudioSlideDocumentEditorProps) {
  const document = useMemo(() => slideDocument ?? legacySlidesToSlideDocument(slides, {
    id: "studio-legacy-slide-document",
    title: seriesTitle,
    language: "de",
    theme: "learnordie-technical"
  }), [seriesTitle, slideDocument, slides]);
  const currentSlide = document.slides[currentIndex] ?? document.slides[0];
  const firstEditableBlock = currentSlide?.blocks.find((block) => block.type !== "spacer") ?? currentSlide?.blocks[0];
  const [selectedBlockId, setSelectedBlockId] = useState(firstEditableBlock?.id ?? "");
  const selectedBlock = currentSlide?.blocks.find((block) => block.id === selectedBlockId) ?? firstEditableBlock;
  const selectedField = selectedBlock ? editableField(selectedBlock, currentSlide?.id ?? "") : null;
  const selectedTable = selectedBlock?.type === "table" ? selectedBlock : null;
  const selectedQuizAnchor = currentSlide?.quizAnchors?.find((anchor) => anchor.blockId === selectedBlock?.id);
  const figureAssets = useMemo(() => document.assets.filter((asset) => figureCompatibleAssetKinds.has(asset.kind)), [document.assets]);
  const [editorValue, setEditorValue] = useState(selectedField?.value ?? "");
  const [tableRowIndex, setTableRowIndex] = useState(0);
  const [tableColumnIndex, setTableColumnIndex] = useState(0);
  const [tableCellValue, setTableCellValue] = useState("");
  const [quizLevel, setQuizLevel] = useState<QuestionLevel>(selectedQuizAnchor?.level ?? "2.0");
  const [status, setStatus] = useState("SlideDocument bereit.");
  const [issue, setIssue] = useState("");

  useEffect(() => {
    const nextBlock = currentSlide?.blocks.find((block) => block.id === selectedBlockId)
      ?? currentSlide?.blocks.find((block) => block.type !== "spacer")
      ?? currentSlide?.blocks[0];
    setSelectedBlockId(nextBlock?.id ?? "");
  }, [currentSlide, selectedBlockId]);

  useEffect(() => {
    setEditorValue(selectedField?.value ?? "");
  }, [selectedBlock?.id, selectedField?.key, selectedField?.value]);

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

  useEffect(() => {
    setQuizLevel(selectedQuizAnchor?.level ?? "2.0");
  }, [selectedBlock?.id, selectedQuizAnchor?.level]);

  function selectBlock(selection: SlideBlockSelection) {
    setSelectedBlockId(selection.blockId);
    setStatus(`Block ${selection.blockId} ausgewählt.`);
    setIssue("");
  }

  function applyOperations(operations: SlideDocumentEditOperation[], message: string) {
    const result = applySlideDocumentEdits(document, operations);
    if (!result.ok) {
      const firstIssue = result.issues[0];
      setIssue(firstIssue ? `${firstIssue.code}: ${firstIssue.repairHint}` : "Unbekannter Validierungsfehler.");
      setStatus("Nicht gespeichert.");
      return false;
    }

    onSlideDocumentChange(result.document, slideDocumentToLegacySlides(result.document, slides));
    setStatus(message);
    setIssue("");
    return true;
  }

  function updateLayout(layout: SlideLayoutId) {
    if (!currentSlide) return;
    applyOperations([
      {
        operationId: `studio-engine-layout-${currentSlide.id}`,
        kind: "updateSlide",
        slideId: currentSlide.id,
        patch: { layout }
      }
    ], "Engine-Layout gespeichert. Bitte Lecture speichern.");
  }

  function saveSelectedBlock() {
    if (!currentSlide || !selectedBlock || !selectedField) return;
    applyOperations(selectedField.operations(editorValue), "Engine-Block gespeichert. Bitte Lecture speichern.");
  }

  function updateFigureAsset(assetId: string) {
    if (!currentSlide || selectedBlock?.type !== "figure") return;
    const asset = document.assets.find((candidate) => candidate.id === assetId);
    if (!asset) return;
    applyOperations([
      {
        operationId: `studio-engine-asset-${selectedBlock.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedBlock.id,
        patch: {
          assetId: asset.id,
          altText: asset.altText ?? selectedBlock.altText
        }
      }
    ], "Engine-Asset gespeichert. Bitte Lecture speichern.");
  }

  function saveTableCell() {
    if (!currentSlide || !selectedTable) return;
    const columnCount = selectedTable.columns.length;
    const rows = selectedTable.rows.map((row, rowIndex) => (
      normalizeTableRow(row, columnCount).map((cell, columnIndex) => (
        rowIndex === tableRowIndex && columnIndex === tableColumnIndex ? tableCellValue : cell
      ))
    ));
    applyOperations([
      {
        operationId: `studio-engine-table-cell-${selectedTable.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedTable.id,
        patch: { rows }
      }
    ], "Engine-Tabellenzelle gespeichert. Bitte Lecture speichern.");
  }

  function addTableRow() {
    if (!currentSlide || !selectedTable) return;
    const nextRowIndex = selectedTable.rows.length;
    const nextRow = selectedTable.columns.map((_, index) => (index === 0 ? "Neue Zeile" : ""));
    const saved = applyOperations([
      {
        operationId: `studio-engine-table-row-${selectedTable.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedTable.id,
        patch: { rows: [...selectedTable.rows, nextRow] }
      }
    ], "Engine-Tabellenzeile ergänzt. Bitte Lecture speichern.");
    if (saved) {
      setTableRowIndex(nextRowIndex);
      setTableColumnIndex(0);
    }
  }

  function addTableColumn() {
    if (!currentSlide || !selectedTable || selectedTable.columns.length >= 8) return;
    const nextColumnIndex = selectedTable.columns.length;
    const columns = [...selectedTable.columns, `Spalte ${nextColumnIndex + 1}`];
    const rows = selectedTable.rows.map((row) => [...normalizeTableRow(row, selectedTable.columns.length), ""]);
    const saved = applyOperations([
      {
        operationId: `studio-engine-table-column-${selectedTable.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedTable.id,
        patch: { columns, rows }
      }
    ], "Engine-Tabellenspalte ergänzt. Bitte Lecture speichern.");
    if (saved) setTableColumnIndex(nextColumnIndex);
  }

  function upsertQuizAnchor() {
    if (!currentSlide || !selectedBlock) return;
    applyOperations([
      {
        operationId: `studio-engine-quiz-anchor-${selectedBlock.id}`,
        kind: "upsertQuizAnchor",
        slideId: currentSlide.id,
        anchor: {
          id: selectedQuizAnchor?.id ?? `anchor-${selectedBlock.id}`,
          level: quizLevel,
          blockId: selectedBlock.id,
          label: quizAnchorLabel(selectedBlock)
        }
      }
    ], "Engine-Quizanker gespeichert. Bitte Lecture speichern.");
  }

  if (!currentSlide) {
    return null;
  }

  return (
    <aside
      aria-label="SlideDocument Studio Editor"
      className="studio-engine-editor"
      data-selected-block-id={selectedBlock?.id ?? ""}
      data-studio-engine-editor="true"
    >
      <div className="studio-engine-editor-preview">
        <DeckRenderer
          currentSlideId={currentSlide.id}
          document={document}
          renderAsset={renderLegacyDiagramAsset}
          renderMode="current"
          selectedBlockId={selectedBlock?.id}
          onBlockSelect={selectBlock}
        />
      </div>
      <div className="studio-engine-editor-panel">
        <div className="studio-engine-editor-heading">
          <span>SlideDocument</span>
          <strong>{selectedBlock?.id ?? "Kein Block"}</strong>
          <small>{selectedBlock?.type ?? "n/a"} · native Engine</small>
        </div>

        <label>
          <span>Engine Layout</span>
          <select
            aria-label="Engine Layout"
            value={currentSlide.layout}
            onChange={(event) => updateLayout(event.currentTarget.value as SlideLayoutId)}
          >
            {slideLayoutIdValues.map((layout) => (
              <option key={layout} value={layout}>{formatLayoutLabel(layout)}</option>
            ))}
          </select>
        </label>

        {selectedField ? (
          <label>
            <span>{selectedField.label}</span>
            <textarea
              aria-label={selectedField.label}
              rows={4}
              value={editorValue}
              onChange={(event) => setEditorValue(event.currentTarget.value)}
            />
          </label>
        ) : null}

        {selectedBlock?.type === "figure" ? (
          <label>
            <span>Engine Asset</span>
            <select
              aria-label="Engine Asset"
              value={selectedBlock.assetId}
              onChange={(event) => updateFigureAsset(event.currentTarget.value)}
            >
              {figureAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.title} · {asset.kind}</option>
              ))}
            </select>
          </label>
        ) : null}

        {selectedTable ? (
          <div className="studio-engine-editor-group" aria-label="Engine Tabelleneditor">
            <label>
              <span>Zeile</span>
              <select
                aria-label="Engine Tabellenzeile"
                value={tableRowIndex}
                onChange={(event) => setTableRowIndex(Number(event.currentTarget.value))}
              >
                {selectedTable.rows.map((_, rowIndex) => (
                  <option key={rowIndex} value={rowIndex}>Zeile {rowIndex + 1}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Spalte</span>
              <select
                aria-label="Engine Tabellenspalte"
                value={tableColumnIndex}
                onChange={(event) => setTableColumnIndex(Number(event.currentTarget.value))}
              >
                {selectedTable.columns.map((column, columnIndex) => (
                  <option key={`${column}-${columnIndex}`} value={columnIndex}>{column}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Zelle</span>
              <input
                aria-label="Engine Tabellenzelle"
                value={tableCellValue}
                onChange={(event) => setTableCellValue(event.currentTarget.value)}
              />
            </label>
            <div className="studio-engine-editor-actions split">
              <button type="button" onClick={saveTableCell}>Zelle speichern</button>
              <button type="button" onClick={addTableRow}>Zeile hinzufügen</button>
              <button type="button" disabled={selectedTable.columns.length >= 8} onClick={addTableColumn}>
                Spalte hinzufügen
              </button>
            </div>
          </div>
        ) : null}

        {selectedBlock ? (
          <div className="studio-engine-editor-group" aria-label="Engine Quizanker Editor">
            <label>
              <span>Quizanker Niveau</span>
              <select
                aria-label="Engine Quizanker Niveau"
                value={quizLevel}
                onChange={(event) => setQuizLevel(event.currentTarget.value as QuestionLevel)}
              >
                {questionLevelValues.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={upsertQuizAnchor}>
              {selectedQuizAnchor ? "Quizanker aktualisieren" : "Quizanker setzen"}
            </button>
          </div>
        ) : null}

        <div className="studio-engine-editor-actions">
          <button type="button" disabled={!selectedField} onClick={saveSelectedBlock}>
            Engine-Block speichern
          </button>
        </div>
        <p aria-live="polite">{status}</p>
        {issue ? <p role="alert" className="form-error">{issue}</p> : null}
      </div>
    </aside>
  );
}

function editableField(block: SlideBlock, slideId: string): {
  key: string;
  label: string;
  value: string;
  operations: (value: string) => SlideDocumentEditOperation[];
} | null {
  switch (block.type) {
    case "heading":
      return {
        key: "heading",
        label: "Engine Folientitel",
        value: block.text,
        operations: (text) => [
          {
            operationId: `studio-engine-title-${slideId}`,
            kind: "updateSlide",
            slideId,
            patch: { title: text }
          },
          {
            operationId: `studio-engine-heading-${block.id}`,
            kind: "patchBlock",
            slideId,
            blockId: block.id,
            patch: { text }
          }
        ]
      };
    case "paragraph":
      return {
        key: "text",
        label: "Engine Folientext",
        value: block.text,
        operations: (text) => [patchBlockOperation(slideId, block.id, { text })]
      };
    case "figure":
      return {
        key: "caption",
        label: "Engine Folienthema",
        value: block.caption ?? "",
        operations: (caption) => [patchBlockOperation(slideId, block.id, { caption })]
      };
    case "formula":
      return {
        key: "latex",
        label: "Engine Formel",
        value: block.latex ?? block.mathMl ?? "",
        operations: (latex) => [patchBlockOperation(slideId, block.id, { latex, mathMl: undefined })]
      };
    case "callout":
      return {
        key: "callout",
        label: "Engine Hinweistext",
        value: block.text,
        operations: (text) => [patchBlockOperation(slideId, block.id, { text })]
      };
    case "definition":
      return {
        key: "definition",
        label: "Engine Definition",
        value: block.definition,
        operations: (definition) => [patchBlockOperation(slideId, block.id, { definition })]
      };
    case "quote":
      return {
        key: "quote",
        label: "Engine Zitat",
        value: block.text,
        operations: (text) => [patchBlockOperation(slideId, block.id, { text })]
      };
    case "code":
      return {
        key: "code",
        label: "Engine Code",
        value: block.code,
        operations: (code) => [patchBlockOperation(slideId, block.id, { code })]
      };
    default:
      return null;
  }
}

function patchBlockOperation(slideId: string, blockId: string, patch: SlideBlockPatch): SlideDocumentEditOperation {
  return {
    operationId: `studio-engine-patch-${blockId}`,
    kind: "patchBlock",
    slideId,
    blockId,
    patch
  };
}

function formatLayoutLabel(layout: SlideLayoutId) {
  return layout.replaceAll("_", " ");
}

const figureCompatibleAssetKinds = new Set<SlideAssetKind>(["figure", "photo", "diagram", "chart"]);

function clampIndex(index: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(index, max));
}

function normalizeTableRow(row: string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

function quizAnchorLabel(block: SlideBlock) {
  if ("text" in block && typeof block.text === "string") return block.text.slice(0, 120);
  if (block.type === "definition") return block.term;
  if (block.type === "figure") return block.caption ?? block.altText;
  if (block.type === "formula") return block.caption ?? block.latex ?? "Formel";
  if (block.type === "table") return block.caption ?? "Tabelle";
  return `Frage zu ${block.id}`;
}

function renderLegacyDiagramAsset(asset: SlideAsset): ReactNode {
  if (asset.id === legacyDiagramAssetId("bearing")) return <Diagram type="bearing" />;
  if (asset.id === legacyDiagramAssetId("formula")) return <Diagram type="formula" />;
  if (asset.id === legacyDiagramAssetId("ramp")) return <Diagram type="ramp" />;
  return null;
}
