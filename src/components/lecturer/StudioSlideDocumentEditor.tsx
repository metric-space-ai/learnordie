"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Slide } from "@/lib/types";
import {
  DeckRenderer,
  applySlideDocumentEdits,
  legacyDiagramAssetId,
  legacySlidesToSlideDocument,
  slideDocumentToLegacySlides,
  type SlideBlock,
  type SlideBlockPatch,
  type SlideBlockSelection,
  type SlideDocumentEditOperation
} from "@learnordie/slide-engine";
import type { SlideAsset } from "@learnordie/slide-engine/components";
import { Diagram } from "../Diagram";

type StudioSlideDocumentEditorProps = {
  currentIndex: number;
  seriesTitle: string;
  slides: Slide[];
  onSlidesChange: (slides: Slide[]) => void;
};

export function StudioSlideDocumentEditor({
  currentIndex,
  seriesTitle,
  slides,
  onSlidesChange
}: StudioSlideDocumentEditorProps) {
  const document = useMemo(() => legacySlidesToSlideDocument(slides, {
    id: "studio-legacy-slide-document",
    title: seriesTitle,
    language: "de",
    theme: "learnordie-technical"
  }), [seriesTitle, slides]);
  const currentSlide = document.slides[currentIndex] ?? document.slides[0];
  const firstEditableBlock = currentSlide?.blocks.find((block) => block.type !== "spacer") ?? currentSlide?.blocks[0];
  const [selectedBlockId, setSelectedBlockId] = useState(firstEditableBlock?.id ?? "");
  const selectedBlock = currentSlide?.blocks.find((block) => block.id === selectedBlockId) ?? firstEditableBlock;
  const selectedField = selectedBlock ? editableField(selectedBlock, currentSlide?.id ?? "") : null;
  const [editorValue, setEditorValue] = useState(selectedField?.value ?? "");
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
      return;
    }

    onSlidesChange(slideDocumentToLegacySlides(result.document, slides));
    setStatus(message);
    setIssue("");
  }

  function saveSelectedBlock() {
    if (!currentSlide || !selectedBlock || !selectedField) return;
    applyOperations(selectedField.operations(editorValue), "Engine-Block gespeichert. Bitte Lecture speichern.");
  }

  function updateDiagram(diagram: Slide["diagram"]) {
    if (!currentSlide || selectedBlock?.type !== "figure") return;
    applyOperations([
      {
        operationId: `studio-engine-diagram-${selectedBlock.id}`,
        kind: "patchBlock",
        slideId: currentSlide.id,
        blockId: selectedBlock.id,
        patch: {
          assetId: legacyDiagramAssetId(diagram)
        }
      }
    ], "Engine-Diagramm gespeichert. Bitte Lecture speichern.");
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
          <small>{selectedBlock?.type ?? "n/a"} · Legacy-kompatibel</small>
        </div>

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
            <span>Engine Diagrammtyp</span>
            <select
              aria-label="Engine Diagrammtyp"
              value={diagramFromFigureBlock(selectedBlock, slides[currentIndex]?.diagram ?? "bearing")}
              onChange={(event) => updateDiagram(event.currentTarget.value as Slide["diagram"])}
            >
              <option value="bearing">Lager</option>
              <option value="formula">Formel</option>
              <option value="ramp">Anlauf</option>
            </select>
          </label>
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

function diagramFromFigureBlock(block: Extract<SlideBlock, { type: "figure" }>, fallback: Slide["diagram"]) {
  if (block.assetId === legacyDiagramAssetId("formula")) return "formula";
  if (block.assetId === legacyDiagramAssetId("ramp")) return "ramp";
  if (block.assetId === legacyDiagramAssetId("bearing")) return "bearing";
  return fallback;
}

function renderLegacyDiagramAsset(asset: SlideAsset): ReactNode {
  if (asset.id === legacyDiagramAssetId("bearing")) return <Diagram type="bearing" />;
  if (asset.id === legacyDiagramAssetId("formula")) return <Diagram type="formula" />;
  if (asset.id === legacyDiagramAssetId("ramp")) return <Diagram type="ramp" />;
  return null;
}
