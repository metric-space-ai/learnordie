import {
  applySlideDocumentEdits,
  type SlideBlock,
  type SlideDocument,
  type SlideDocumentEditOperation
} from "@learnordie/slide-engine";
import {
  runPiVercelTurn,
  type PiVercelToolRun
} from "./pi-vercel-adapter";
import {
  buildPresentationSkillBrief,
  presentationSkillIds,
  selectPresentationSkills
} from "./presentation-skills";

export {
  buildPresentationSkillBrief,
  presentationSkillIds,
  presentationSkills,
  selectPresentationSkills,
  type PresentationSkill,
  type PresentationSkillId
} from "./presentation-skills";

export {
  VercelVirtualExecutionEnv,
  createVercelVirtualExecutionEnv,
  type VercelVirtualExecutionEnvOptions,
  type VirtualFileSnapshotEntry
} from "./vercel-execution-env";
export {
  createVercelPiCodingOperations,
  createVercelPiCodingSystemPrompt,
  createVercelPiCodingTextMessage,
  createVercelPiCodingToolCallMessage,
  createVercelPiCodingTools,
  runVercelPiCodingAgentTurn,
  vercelPiCodingToolNames,
  type CreateVercelPiCodingToolsOptions,
  type RunVercelPiCodingAgentTurnInput,
  type VercelPiCodingAgentTurnResult,
  type VercelPiCodingToolName,
  type VercelPiCodingToolsMode
} from "./pi-coding-agent-vercel";

export const LEARNORDIE_PI_UPSTREAM = {
  repository: "https://github.com/earendil-works/pi",
  fork: "metric-space-ai/pi-learnordie",
  tag: "v0.80.2",
  commit: "0201806adfa825ab3d7957a4267d46e5030fd357"
} as const;

export const agentSkillIds = [
  "slide-editor",
  "quiz-author",
  "asset-curator",
  "lecture-planner",
  "qa-repair",
  ...presentationSkillIds
] as const;

export type AgentSkillId = typeof agentSkillIds[number];
export type AgentThreadStatus = "draft" | "running" | "awaiting_review" | "accepted" | "rejected" | "failed";
export type AgentThreadMode = "studio_slide_edit" | "lecturer_assistant" | "quiz_authoring" | "material_processing" | "qa_repair";

export type AgentRunEventStatus = "running" | "done" | "failed" | "blocked";

export type AgentRunEvent = {
  id: string;
  type:
    | "agent_start"
    | "message_start"
    | "message_end"
    | "tool_execution_start"
    | "tool_execution_end"
    | "review_patch_created"
    | "agent_end";
  label: string;
  detail?: string;
  status: AgentRunEventStatus;
  toolName?: LearnordieAgentToolName;
  payload?: unknown;
  at: string;
};

export type AgentToolCall = {
  id: string;
  toolName: LearnordieAgentToolName;
  skillId: AgentSkillId;
  input: unknown;
  output?: unknown;
  status: "running" | "succeeded" | "failed";
  durationMs: number;
  provider?: string;
  model?: string;
  usage?: AgentUsage;
  error?: string;
  createdAt: string;
};

export type AgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AgentMessage = {
  id: string;
  role: "lecturer" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
};

export type AgentReviewPatch = {
  schemaVersion: "learnordie.agent-review-patch.v1";
  summary: string;
  operations: SlideDocumentEditOperation[];
  affectedSlideIds: string[];
  affectedBlockIds: string[];
  qa: {
    ok: boolean;
    warnings: string[];
  };
  previewDocument?: SlideDocument;
};

export type AgentRuntimeResult = {
  status: AgentThreadStatus;
  messages: AgentMessage[];
  events: AgentRunEvent[];
  toolCalls: AgentToolCall[];
  reviewPatch?: AgentReviewPatch;
  provider?: string;
  model?: string;
  usage?: AgentUsage;
  error?: string;
};

export type AgentRuntimeCompletionInput = {
  system: string;
  user: string;
  responseFormat?: "json_object";
  maxOutputTokens?: number;
  temperature?: number;
};

export type AgentRuntimeCompletionResult = {
  answer: string;
  provider?: string;
  model?: string;
  usage?: AgentUsage;
};

export type AgentRuntimeInput = {
  lecture: {
    id: string;
    title: string;
    seriesTitle: string;
    slides?: Array<{ id: string; title: string; topic?: string; copy?: string[] }>;
    materials?: Array<{ id: string; originalName: string; extractedTextPreview?: string; sourceRefs?: string[] }>;
    presentationAssets?: Array<{ id: string; title: string; kind: string; extractedText?: string; tags?: string[] }>;
    studentChatQuestions?: Array<{ id: string; text: string; status: string; relevanceReason?: string; sourceTopic?: string }>;
    transcriptSegments?: Array<{ id: string; text: string; status: string; sourceTopic?: string; createdAt?: string }>;
  };
  document: SlideDocument;
  prompt: string;
  mode: AgentThreadMode;
  slideId?: string;
  blockId?: string;
  assetId?: string;
  complete?: (input: AgentRuntimeCompletionInput) => Promise<AgentRuntimeCompletionResult>;
};

export type LearnordieAgentToolName =
  | "getSlideContext"
  | "getLectureContext"
  | "getSelectedBlock"
  | "queryPresentationAssets"
  | "getTranscriptWindow"
  | "getAcceptedChatQuestions"
  | "proposeSlideEditBatch"
  | "validateSlideDocumentEdits"
  | "renderSlidePreview"
  | "runSlideRenderQA"
  | "repairSlideEditBatch"
  | "createQuestionFamily"
  | "createLearnHotspots"
  | "createSpeakerNotes"
  | "summarizeMaterial"
  | "createSourceNote"
  | "createReviewDiff"
  | "acceptAgentPatch"
  | "rejectAgentPatch";

export type LearnordieAgentTool = {
  name: LearnordieAgentToolName;
  skillId: AgentSkillId;
  description: string;
};

export const learnordieAgentTools: LearnordieAgentTool[] = [
  { name: "getSlideContext", skillId: "slide-composer", description: "Reads the scoped slide without mutation." },
  { name: "getLectureContext", skillId: "deck-strategist", description: "Reads lecture metadata and available source pools." },
  { name: "getSelectedBlock", skillId: "slide-composer", description: "Reads the selected block without mutation." },
  { name: "queryPresentationAssets", skillId: "visual-director", description: "Reads curated presentation assets." },
  { name: "getTranscriptWindow", skillId: "lecture-planner", description: "Reads recent accepted transcript segments." },
  { name: "getAcceptedChatQuestions", skillId: "lecture-planner", description: "Reads accepted student questions." },
  { name: "proposeSlideEditBatch", skillId: "slide-composer", description: "Creates SlideDocumentEditOperation proposals only." },
  { name: "validateSlideDocumentEdits", skillId: "deck-critic", description: "Validates proposed edit operations." },
  { name: "renderSlidePreview", skillId: "deck-critic", description: "Creates a server-side preview document artifact." },
  { name: "runSlideRenderQA", skillId: "deck-critic", description: "Runs structural render checks for the preview." },
  { name: "repairSlideEditBatch", skillId: "deck-critic", description: "Repairs invalid edit batches." },
  { name: "createQuestionFamily", skillId: "quiz-author", description: "Drafts a 4.0 to 1.0 question family." },
  { name: "createLearnHotspots", skillId: "slide-editor", description: "Drafts learn-mode hotspots." },
  { name: "createSpeakerNotes", skillId: "lecture-planner", description: "Drafts speaker notes." },
  { name: "summarizeMaterial", skillId: "asset-curator", description: "Summarizes source material." },
  { name: "createSourceNote", skillId: "asset-curator", description: "Creates a source note artifact." },
  { name: "createReviewDiff", skillId: "slide-editor", description: "Creates a reviewable patch. No persistence." },
  { name: "acceptAgentPatch", skillId: "slide-editor", description: "Commit tool placeholder. Implemented only in the app server." },
  { name: "rejectAgentPatch", skillId: "slide-editor", description: "Reject tool placeholder. Implemented only in the app server." }
];

export async function runLearnordieAgentRuntime(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
  const startedAt = Date.now();
  const events: AgentRunEvent[] = [];
  const toolCalls: AgentToolCall[] = [];
  const messages: AgentMessage[] = [];
  const prompt = normalizePrompt(input.prompt);
  const activePresentationSkills = selectPresentationSkills({
    prompt,
    hasSelectedBlock: Boolean(input.blockId),
    hasPresentationAssets: (input.lecture.presentationAssets?.length ?? input.document.assets.length) > 0
  });
  const presentationSkillBrief = buildPresentationSkillBrief(activePresentationSkills);

  if (!prompt) {
    return {
      status: "failed",
      messages,
      events,
      toolCalls,
      error: "Der Agent-Prompt ist leer."
    };
  }

  const emit = (event: Omit<AgentRunEvent, "id" | "at">) => {
    events.push({ ...event, id: id("event"), at: now() });
  };

  const runTool = async <TInput, TOutput>(
    toolName: LearnordieAgentToolName,
    inputPayload: TInput,
    execute: () => Promise<TOutput> | TOutput
  ) => {
    const tool = learnordieAgentTools.find((item) => item.name === toolName);
    if (!tool) throw new Error(`Tool ${toolName} is not allowlisted.`);
    const call: AgentToolCall = {
      id: id("tool"),
      toolName,
      skillId: tool.skillId,
      input: inputPayload,
      status: "running",
      durationMs: 0,
      createdAt: now()
    };
    toolCalls.push(call);
    emit({
      type: "tool_execution_start",
      label: toolName,
      detail: tool.description,
      status: "running",
      toolName,
      payload: inputPayload
    });
    const started = Date.now();
    try {
      const output = await execute();
      call.output = output;
      call.status = "succeeded";
      call.durationMs = Date.now() - started;
      emit({
        type: "tool_execution_end",
        label: toolName,
        detail: "Tool abgeschlossen.",
        status: "done",
        toolName,
        payload: output
      });
      return output;
    } catch (error) {
      call.status = "failed";
      call.durationMs = Date.now() - started;
      call.error = error instanceof Error ? error.message : "Unbekannter Toolfehler.";
      emit({
        type: "tool_execution_end",
        label: toolName,
        detail: call.error,
        status: "failed",
        toolName
      });
      throw error;
    }
  };

  emit({
    type: "agent_start",
    label: "Pi-Core Vercel-Port gestartet",
    detail: `${LEARNORDIE_PI_UPSTREAM.tag} / @earendil-works/pi-agent-core / allowlisted Learnordie tools`,
    status: "running"
  });

  messages.push({
    id: id("message"),
    role: "lecturer",
    content: prompt,
    createdAt: now()
  });

  try {
    const complete = input.complete;
    const planningTurn = await runPiVercelTurn<LearnordieAgentToolName>({
      prompt,
      systemPrompt: [
        "Du bist die Pi-Core Runtime innerhalb von Learnordie.",
        "Du laeufst als Vercel-kompatibler Port von @earendil-works/pi-agent-core.",
        "Du darfst keine Aktionen direkt ausfuehren.",
        "Antworte als JSON mit den Feldern summary und replacementText.",
        "Nutze Deutsch und bleibe im Kontext der Vorlesung.",
        "Wende diese internen Praesentations-Skills an, ohne ihre Namen im Ergebnis zu erwaehnen:",
        presentationSkillBrief
      ].join(" "),
      maxOutputTokens: 700,
      temperature: 0.2,
      tools: [
        {
          name: "getLectureContext",
          label: "Lecture context",
          description: "Reads lecture metadata and available source pools.",
          input: { lectureId: input.lecture.id },
          execute: () => ({
            title: input.lecture.title,
            seriesTitle: input.lecture.seriesTitle,
            slideCount: input.document.slides.length,
            materialCount: input.lecture.materials?.length ?? 0,
            assetCount: input.lecture.presentationAssets?.length ?? input.document.assets.length,
            transcriptCount: input.lecture.transcriptSegments?.filter((segment) => segment.status === "accepted").length ?? 0,
            acceptedQuestionCount: input.lecture.studentChatQuestions?.filter((question) => question.status === "accepted").length ?? 0
          })
        },
        {
          name: "getSlideContext",
          label: "Slide context",
          description: "Reads the scoped slide without mutation.",
          input: { slideId: input.slideId },
          execute: () => resolveSlide(input.document, input.slideId)
        },
        {
          name: "getSelectedBlock",
          label: "Selected block",
          description: "Reads the selected block without mutation.",
          input: { slideId: input.slideId, blockId: input.blockId },
          execute: () => {
            const scopedSlide = resolveSlide(input.document, input.slideId);
            return resolveBlock(scopedSlide.blocks, input.blockId);
          }
        },
        {
          name: "queryPresentationAssets",
          label: "Presentation assets",
          description: "Reads curated presentation assets.",
          input: { assetId: input.assetId },
          execute: () => (
            (input.lecture.presentationAssets ?? [])
              .filter((asset) => !input.assetId || asset.id === input.assetId)
              .slice(0, 12)
              .map((asset) => ({
                id: asset.id,
                title: asset.title,
                kind: asset.kind,
                tags: asset.tags ?? [],
                preview: truncate(asset.extractedText, 180)
              }))
          )
        },
        {
          name: "getTranscriptWindow",
          label: "Transcript window",
          description: "Reads recent accepted transcript segments.",
          input: { limit: 6 },
          execute: () => (
            (input.lecture.transcriptSegments ?? [])
              .filter((segment) => segment.status === "accepted")
              .slice(0, 6)
              .map((segment) => ({
                id: segment.id,
                text: truncate(segment.text, 220),
                sourceTopic: segment.sourceTopic
              }))
          )
        },
        {
          name: "getAcceptedChatQuestions",
          label: "Accepted chat questions",
          description: "Reads accepted student questions.",
          input: { limit: 6 },
          execute: () => (
            (input.lecture.studentChatQuestions ?? [])
              .filter((question) => question.status === "accepted")
              .slice(0, 6)
              .map((question) => ({
                id: question.id,
                text: truncate(question.text, 220),
                sourceTopic: question.sourceTopic
              }))
          )
        }
      ],
      complete: complete
        ? async ({ toolOutputs }) => complete({
        system: [
          "Du bist die Pi-Core Runtime innerhalb von Learnordie.",
          "Du laeufst als Vercel-kompatibler Port von @earendil-works/pi-agent-core.",
          "Du darfst keine Aktionen direkt ausfuehren.",
          "Antworte als JSON mit den Feldern summary und replacementText.",
          "Nutze Deutsch und bleibe im Kontext der Vorlesung.",
          "Wende diese internen Praesentations-Skills an, ohne ihre Namen im Ergebnis zu erwaehnen:",
          presentationSkillBrief
        ].join(" "),
        user: JSON.stringify({
          task: prompt,
          lecture: toolOutputs.getLectureContext,
          slideTitle: (toolOutputs.getSlideContext as { title?: string } | undefined)?.title,
          selectedBlock: summarizeBlock(toolOutputs.getSelectedBlock as SlideBlock | undefined),
          activePresentationSkills: activePresentationSkills.map((skill) => skill.id),
          allowedOutput: "review_patch_only"
        }),
        responseFormat: "json_object",
        maxOutputTokens: 700,
        temperature: 0.2
      })
        : undefined
    });
    for (const piEvent of planningTurn.piEvents) {
      const mapped = mapPiEvent(piEvent);
      if (mapped) emit(mapped);
    }
    toolCalls.push(...planningTurn.toolRuns.map(toAgentToolCall));

    requireToolOutput(planningTurn.toolOutputs, "getLectureContext");
    const slide = requireToolOutput<SlideDocument["slides"][number]>(planningTurn.toolOutputs, "getSlideContext");
    const selectedBlock = planningTurn.toolOutputs.getSelectedBlock as SlideBlock | undefined;
    const provider = planningTurn.provider;
    const model = planningTurn.model;
    const usage = planningTurn.usage;
    const assistantRationale = extractReplacementText(planningTurn.assistantText);

    if (input.mode === "lecturer_assistant") {
      const note = await runTool("createSpeakerNotes", {
        prompt,
        slideId: slide.id,
        blockId: selectedBlock?.id
      }, () => ({
        slideId: slide.id,
        summary: assistantRationale || `Assistentenlauf zu "${truncate(prompt, 180)}" dokumentiert.`,
        source: "lecturer_assistant",
        reviewRequired: false
      }));
      messages.push({
        id: id("message"),
        role: "assistant",
        content: typeof note.summary === "string" ? note.summary : "Assistentenlauf dokumentiert.",
        createdAt: now()
      });
      emit({
        type: "agent_end",
        label: "Pi-Core Vercel-Port abgeschlossen",
        detail: `Lecturer-Assistant-Thread in ${Date.now() - startedAt} ms dokumentiert.`,
        status: "done"
      });
      return {
        status: "accepted",
        messages,
        events,
        toolCalls,
        provider,
        model,
        usage
      };
    }

    const operations = await runTool("proposeSlideEditBatch", {
      prompt,
      slideId: slide.id,
      blockId: selectedBlock?.id
    }, () => proposeSlideEditBatch({
      prompt,
      slideId: slide.id,
      slideTitle: slide.title,
      selectedBlock,
      assistantRationale
    }));

    let validation = await runTool("validateSlideDocumentEdits", {
      operationCount: operations.length
    }, () => applySlideDocumentEdits(input.document, operations));

    let finalOperations = operations;
    if (!validation.ok) {
      finalOperations = await runTool("repairSlideEditBatch", {
        rejectedOperation: validation.rejectedOperation,
        issues: validation.issues
      }, () => proposeSlideEditBatch({
        prompt,
        slideId: slide.id,
        slideTitle: slide.title,
        selectedBlock: undefined,
        assistantRationale
      }));
      validation = await runTool("validateSlideDocumentEdits", {
        operationCount: finalOperations.length,
        repair: true
      }, () => applySlideDocumentEdits(input.document, finalOperations));
    }

    if (!validation.ok || !validation.document) {
      const error = validation.issues[0]?.repairHint ?? "Der Agent-Patch konnte nicht validiert werden.";
      throw new Error(error);
    }

    const previewDocument = await runTool("renderSlidePreview", {
      slideId: slide.id,
      operationCount: finalOperations.length
    }, () => validation.document);
    const qa = await runTool("runSlideRenderQA", {
      slideId: slide.id
    }, () => runStaticRenderQa(previewDocument, slide.id));
    const reviewPatch = await runTool("createReviewDiff", {
      slideId: slide.id,
      operationCount: finalOperations.length
    }, () => createReviewPatch({
      prompt,
      operations: finalOperations,
      previewDocument,
      qa
    }));

    emit({
      type: "review_patch_created",
      label: "Review-Diff bereit",
      detail: reviewPatch.summary,
      status: "done",
      payload: reviewPatch
    });

    const assistantContent = [
      reviewPatch.summary,
      qa.warnings.length > 0 ? `QA-Hinweise: ${qa.warnings.join(" ")}` : "QA ohne strukturelle Warnung."
    ].join("\n");
    messages.push({
      id: id("message"),
      role: "assistant",
      content: assistantContent,
      createdAt: now()
    });

    emit({
      type: "agent_end",
      label: "Pi Runtime abgeschlossen",
      detail: `Review-Patch in ${Date.now() - startedAt} ms erstellt.`,
      status: "done"
    });

    return {
      status: "awaiting_review",
      messages,
      events,
      toolCalls,
      reviewPatch,
      provider,
      model,
      usage
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Agentfehler.";
    emit({
      type: "agent_end",
      label: "Pi Runtime fehlgeschlagen",
      detail: message,
      status: "failed"
    });
    messages.push({
      id: id("message"),
      role: "assistant",
      content: message,
      createdAt: now()
    });
    return {
      status: "failed",
      messages,
      events,
      toolCalls,
      error: message
    };
  }
}

function proposeSlideEditBatch(input: {
  prompt: string;
  slideId: string;
  slideTitle: string;
  selectedBlock?: SlideBlock;
  assistantRationale?: string;
}): SlideDocumentEditOperation[] {
  const text = buildReplacementText(input.prompt, input.selectedBlock, input.assistantRationale);
  const context = {
    actor: "agent" as const,
    source: "pi-runtime",
    reason: input.prompt
  };

  if (!input.selectedBlock) {
    return [
      {
        operationId: id("agent-insert-callout"),
        kind: "insertBlock",
        slideId: input.slideId,
        block: {
          id: id("agent-callout"),
          type: "callout",
          tone: "info",
          title: "Merksatz",
          text
        },
        context
      }
    ];
  }

  switch (input.selectedBlock.type) {
    case "heading":
      return [
        {
          operationId: id("agent-update-heading"),
          kind: "patchBlock",
          slideId: input.slideId,
          blockId: input.selectedBlock.id,
          patch: { text: truncate(text, 140) ?? input.slideTitle },
          context
        }
      ];
    case "paragraph":
    case "callout":
    case "quote":
      return [
        {
          operationId: id("agent-patch-text"),
          kind: "patchBlock",
          slideId: input.slideId,
          blockId: input.selectedBlock.id,
          patch: { text },
          context
        }
      ];
    case "definition":
      return [
        {
          operationId: id("agent-patch-definition"),
          kind: "patchBlock",
          slideId: input.slideId,
          blockId: input.selectedBlock.id,
          patch: { definition: text },
          context
        }
      ];
    case "figure":
      return [
        {
          operationId: id("agent-patch-caption"),
          kind: "patchBlock",
          slideId: input.slideId,
          blockId: input.selectedBlock.id,
          patch: { caption: truncate(text, 240), altText: truncate(text, 320) ?? input.selectedBlock.altText },
          context
        }
      ];
    case "formula":
      return [
        {
          operationId: id("agent-patch-formula-caption"),
          kind: "patchBlock",
          slideId: input.slideId,
          blockId: input.selectedBlock.id,
          patch: { caption: truncate(text, 240) },
          context
        }
      ];
    case "bulletList":
    case "numberedList":
      return [
        {
          operationId: id("agent-patch-list"),
          kind: "patchBlock",
          slideId: input.slideId,
          blockId: input.selectedBlock.id,
          patch: { items: splitListText(text) },
          context
        }
      ];
    default:
      return [
        {
          operationId: id("agent-insert-context-callout"),
          kind: "insertBlock",
          slideId: input.slideId,
          block: {
            id: id("agent-callout"),
            type: "callout",
            tone: "info",
            title: "Merksatz",
            text
          },
          afterBlockId: input.selectedBlock.id,
          context
        }
      ];
  }
}

function createReviewPatch(input: {
  prompt: string;
  operations: SlideDocumentEditOperation[];
  previewDocument: SlideDocument;
  qa: AgentReviewPatch["qa"];
}): AgentReviewPatch {
  const affectedSlideIds = [...new Set(input.operations
    .map((operation) => "slideId" in operation ? operation.slideId : undefined)
    .filter((value): value is string => Boolean(value)))];
  const affectedBlockIds = [...new Set(input.operations
    .map((operation) => "blockId" in operation ? operation.blockId : undefined)
    .filter((value): value is string => Boolean(value)))];

  return {
    schemaVersion: "learnordie.agent-review-patch.v1",
    summary: `Vorgeschlagene Änderung: ${truncate(input.prompt, 180)}`,
    operations: input.operations,
    affectedSlideIds,
    affectedBlockIds,
    qa: input.qa,
    previewDocument: input.previewDocument
  };
}

function requireToolOutput<T = unknown>(
  outputs: Partial<Record<LearnordieAgentToolName, unknown>>,
  toolName: LearnordieAgentToolName
): T {
  const output = outputs[toolName];
  if (output === undefined) throw new Error(`Pi-Core Tool ${toolName} returned no output.`);
  return output as T;
}

function toAgentToolCall(run: PiVercelToolRun<LearnordieAgentToolName>): AgentToolCall {
  const tool = learnordieAgentTools.find((item) => item.name === run.toolName);
  return {
    id: run.id,
    toolName: run.toolName,
    skillId: tool?.skillId ?? "lecture-planner",
    input: run.input,
    output: run.output,
    status: run.status,
    durationMs: run.durationMs,
    error: run.error,
    createdAt: run.createdAt
  };
}

function mapPiEvent(event: { type: string; message?: unknown; toolName?: string; args?: unknown; result?: unknown; isError?: boolean }): Omit<AgentRunEvent, "id" | "at"> | undefined {
  switch (event.type) {
    case "agent_start":
      return {
        type: "agent_start",
        label: "Pi-Core Loop gestartet",
        detail: "@earendil-works/pi-agent-core@0.80.2",
        status: "running"
      };
    case "message_start":
      return {
        type: "message_start",
        label: "Pi-Core Message gestartet",
        status: "running",
        payload: event.message
      };
    case "message_end":
      return {
        type: "message_end",
        label: "Pi-Core Message abgeschlossen",
        status: "done",
        payload: event.message
      };
    case "tool_execution_start":
      return {
        type: "tool_execution_start",
        label: event.toolName ?? "Pi-Core Tool",
        detail: "Pi-Core Toolausfuehrung gestartet.",
        status: "running",
        toolName: normalizeToolName(event.toolName),
        payload: event.args
      };
    case "tool_execution_end":
      return {
        type: "tool_execution_end",
        label: event.toolName ?? "Pi-Core Tool",
        detail: event.isError ? "Pi-Core Tool fehlgeschlagen." : "Pi-Core Tool abgeschlossen.",
        status: event.isError ? "failed" : "done",
        toolName: normalizeToolName(event.toolName),
        payload: event.result
      };
    case "agent_end":
      return {
        type: "agent_end",
        label: "Pi-Core Loop abgeschlossen",
        status: "done",
        payload: event.message
      };
    default:
      return undefined;
  }
}

function normalizeToolName(value: string | undefined): LearnordieAgentToolName | undefined {
  return learnordieAgentTools.some((tool) => tool.name === value)
    ? value as LearnordieAgentToolName
    : undefined;
}

function runStaticRenderQa(document: SlideDocument, slideId: string): AgentReviewPatch["qa"] {
  const slide = document.slides.find((item) => item.id === slideId) ?? document.slides[0];
  const warnings: string[] = [];
  if (!slide) {
    warnings.push("Keine Folie fuer den Preview gefunden.");
  } else {
    const longTextBlocks = slide.blocks.filter((block) => {
      const text = blockText(block);
      return text.length > 900;
    });
    if (longTextBlocks.length > 0) {
      warnings.push("Ein Textblock ist sehr lang und sollte visuell geprueft werden.");
    }
    if (slide.blocks.length > 12) {
      warnings.push("Die Folie enthaelt viele Bloecke; mobile Darstellung pruefen.");
    }
  }
  return { ok: warnings.length === 0, warnings };
}

function resolveSlide(document: SlideDocument, slideId?: string) {
  const slide = slideId ? document.slides.find((item) => item.id === slideId) : document.slides[0];
  if (!slide) throw new Error("Keine passende Folie fuer den Agent-Scope gefunden.");
  return slide;
}

function resolveBlock(blocks: SlideBlock[], blockId?: string) {
  if (blockId) return blocks.find((block) => block.id === blockId);
  return blocks.find((block) => block.type !== "spacer");
}

function buildReplacementText(prompt: string, block?: SlideBlock, assistantRationale?: string) {
  const llmText = assistantRationale?.trim();
  if (llmText) return truncate(llmText, 1200) ?? llmText;
  const fallback = prompt.trim() || (block ? blockText(block) : "Neuer Inhalt");
  return truncate(fallback, 1200) ?? fallback;
}

function blockText(block: SlideBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "callout":
    case "quote":
      return block.text;
    case "definition":
      return `${block.term}: ${block.definition}`;
    case "figure":
      return block.caption ?? block.altText;
    case "formula":
      return block.caption ?? block.latex ?? block.mathMl ?? "Formel";
    case "bulletList":
    case "numberedList":
      return block.items.join("; ");
    case "table":
      return [block.caption, ...block.columns, ...block.rows.flat()].filter(Boolean).join("; ");
    case "code":
      return block.code;
    default:
      return block.id;
  }
}

function summarizeBlock(block?: SlideBlock) {
  if (!block) return null;
  return {
    id: block.id,
    type: block.type,
    text: truncate(blockText(block), 500)
  };
}

function splitListText(text: string) {
  const lines = text
    .split(/\n|;|\. /)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  return lines.length > 0 ? lines : [truncate(text, 220) ?? "Neuer Punkt"];
}

export function extractReplacementText(answer: string) {
  const withoutThinking = answer
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!withoutThinking) return "";
  try {
    const jsonStart = withoutThinking.indexOf("{");
    const jsonEnd = withoutThinking.lastIndexOf("}");
    const candidate = jsonStart >= 0 && jsonEnd > jsonStart
      ? withoutThinking.slice(jsonStart, jsonEnd + 1)
      : withoutThinking;
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const replacement = typeof parsed.replacementText === "string" ? parsed.replacementText : undefined;
    const summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
    const result = replacement?.trim() || summary?.trim() || "";
    return /<think>|<\/think>/i.test(result) ? "" : result;
  } catch {
    return "";
  }
}

function normalizePrompt(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 2000);
}

function truncate(value: string | undefined, max: number) {
  if (!value) return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}
