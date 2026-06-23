import crypto from "node:crypto";

import type {
  Lecture,
  LecturerAssistantMetadata,
  LecturerAssistantSourceWeight,
  LecturerAssistantToolPlanItem,
  LecturerAssistantToolSuggestion,
  QuestionLevel,
  Slide
} from "@/lib/types";
import { normalizeEvaluationConfig } from "@/lib/evaluation";
import { normalizeLearnQuestionDensity } from "@/lib/learn-settings";
import { getAIProvider } from "@/server/providers/ai";

const levelTargets: Record<QuestionLevel, string> = {
  "4.0": "Begriffe sicher zuordnen",
  "3.0": "den beschriebenen Ablauf erklären",
  "2.0": "eine Ursache oder Maßnahme begründen",
  "1.0": "das Prinzip auf eine neue technische Situation übertragen"
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function selectSlide(lecture: Lecture, slideId?: string) {
  return lecture.slides.find((slide) => slide.id === slideId) ?? lecture.slides[0];
}

function slideFocus(slide: Slide | undefined) {
  if (!slide) return "das aktuelle Thema";
  return clean([slide.title, slide.topic].filter(Boolean).join(": "));
}

function slideEvidence(slide: Slide | undefined) {
  if (!slide) return "Keine Folie ausgewählt.";
  const copy = slide.copy.map(clean).filter(Boolean).slice(0, 2).join(" ");
  return copy || slide.topic || slide.title;
}

function hasQuestionIntent(message: string) {
  return /frage|quiz|niveau|multiple|choice|mcq|pruef|prüf|transfer/i.test(message);
}

function hasSourceIntent(message: string) {
  return /quelle|material|powerpoint|pdf|transkript|chat|audio/i.test(message);
}

function hasEvaluationIntent(message: string) {
  return /evaluation|feedback|rueckmeldung|rückmeldung|verstaendnis|verständnis|tempo|nachbereit|selbsteinschaetzung|selbsteinschätzung/i.test(message);
}

function hasLearnDensityIntent(message: string) {
  return /fragedichte|dichte|hotspot|learn|lernmodus|nacharbeit|nachbereit|wiederhol|uebung|übung|selbstlern/i.test(message);
}

function sourceRefsForLecture(lecture: Lecture, slide: Slide | undefined) {
  const refs = [
    slide ? `${slide.eyebrow}: ${slide.title}` : undefined,
    ...(lecture.materials ?? []).slice(0, 2).map((material) => material.originalName),
    ...(lecture.studentChatQuestions ?? []).filter((question) => question.status === "accepted").slice(0, 1).map((question) => `Chat: ${question.text}`),
    ...(lecture.transcriptSegments ?? []).filter((segment) => segment.status === "accepted").slice(0, 1).map((segment) => `Transkript: ${segment.text}`)
  ];

  return refs.filter((ref): ref is string => Boolean(ref));
}

function sourceWeightsForLecture(lecture: Lecture, slide: Slide | undefined): LecturerAssistantSourceWeight[] {
  const weights: LecturerAssistantSourceWeight[] = [];
  if (slide) {
    weights.push({
      label: `Folie: ${slide.title}`,
      weight: 0.45,
      reason: "aktueller WYSIWYG-Kontext"
    });
  }

  const material = (lecture.materials ?? []).find((item) => item.status === "ready") ?? lecture.materials?.[0];
  if (material) {
    weights.push({
      label: material.originalName,
      weight: 0.25,
      reason: material.status === "ready" ? "verarbeitetes Material" : "vorgemerkte Quelle"
    });
  }

  const chatQuestion = (lecture.studentChatQuestions ?? []).find((item) => item.status === "accepted");
  if (chatQuestion) {
    weights.push({
      label: `Chat: ${chatQuestion.text}`,
      weight: 0.15,
      reason: "studentisches Verständnisproblem"
    });
  }

  const transcript = (lecture.transcriptSegments ?? []).find((item) => item.status === "accepted");
  if (transcript) {
    weights.push({
      label: `Transkript: ${transcript.text}`,
      weight: 0.15,
      reason: "Live-Erklärung des Dozenten"
    });
  }

  if (weights.length === 0) {
    weights.push({
      label: lecture.title,
      weight: 1,
      reason: "Vorlesungstitel als Fallback"
    });
  }

  return weights.slice(0, 4);
}

function toolSuggestionsForMessage(message: string): LecturerAssistantToolSuggestion[] {
  if (hasLearnDensityIntent(message)) {
    return [
      {
        action: "learn_density",
        label: "Learn-Fragedichte setzen",
        reason: "Die Fragehäufigkeit soll im Learn-Modus zur Nacharbeit passen."
      },
      {
        action: "review_draft",
        label: "Fragenentwurf anlegen",
        reason: "Mehr Learn-Hotspots brauchen passende Fragevarianten im Review."
      }
    ];
  }

  if (hasEvaluationIntent(message)) {
    return [
      {
        action: "evaluation_focus",
        label: "Evaluation schärfen",
        reason: "Die Rückmeldung soll das Verständnis zur sichtbaren Folie messbar machen."
      },
      {
        action: "review_draft",
        label: "Fragenentwurf anlegen",
        reason: "Aus der Evaluation kann eine passende Fragefamilie zur Nacharbeit entstehen."
      }
    ];
  }

  if (hasSourceIntent(message)) {
    return [
      {
        action: "source_note",
        label: "Quellen-Notiz anlegen",
        reason: "Der Materialpool sollte vor der Fragegenerierung ergänzt werden."
      },
      {
        action: "review_draft",
        label: "Fragenentwurf vorbereiten",
        reason: "Aus der Quelle kann danach eine 4-Niveau-Fragefamilie entstehen."
      }
    ];
  }

  if (hasQuestionIntent(message)) {
    return [
      {
        action: "review_draft",
        label: "Fragenentwurf anlegen",
        reason: "Die Anfrage zielt auf prüfbare Varianten in 4.0 bis 1.0."
      },
      {
        action: "slide_point",
        label: "Folienpunkt übernehmen",
        reason: "Ein kurzer Merksatz macht das Lernziel direkt auf der Folie sichtbar."
      }
    ];
  }

  return [
    {
      action: "slide_point",
      label: "Folienpunkt übernehmen",
      reason: "Die sichtbare Folie braucht zuerst eine klare didaktische Kante."
    },
    {
      action: "review_draft",
      label: "Fragenentwurf anlegen",
      reason: "Aus der geschärften Kernaussage kann anschließend eine Fragefamilie entstehen."
    },
    {
      action: "source_note",
      label: "Quellen-Notiz anlegen",
      reason: "Bei fehlendem Material sollte der Quellenpool ergänzt werden."
    }
  ];
}

function toolPlanFromSuggestions(input: {
  suggestions: LecturerAssistantToolSuggestion[];
  lecture: Lecture;
  slide: Slide | undefined;
}): LecturerAssistantToolPlanItem[] {
  const hasReadyMaterial = (input.lecture.materials ?? []).some((material) => material.status === "ready");
  const hasSlide = Boolean(input.slide);

  return input.suggestions.slice(0, 3).map((suggestion, index) => {
    const prerequisite =
      suggestion.action === "review_draft" && !hasReadyMaterial
        ? "Material oder Folienkontext prüfen"
        : suggestion.action === "source_note" && hasReadyMaterial
          ? "Nur ergänzen, wenn die bestehende Quelle die Anwendungsfrage nicht trägt"
          : suggestion.action === "slide_point" && !hasSlide
            ? "Erst eine Folie auswählen"
            : undefined;

    return {
      ...suggestion,
      order: index + 1,
      status: prerequisite && suggestion.action === "slide_point" ? "blocked" : "suggested",
      prerequisite
    };
  });
}

function strategyForMessage(message: string) {
  if (hasLearnDensityIntent(message)) return "Learn-Fragedichte für die Nacharbeit einstellen";
  if (hasEvaluationIntent(message)) return "Evaluation folienbezogen schärfen";
  if (hasSourceIntent(message)) return "Quellen zuerst, danach Fragefamilie";
  if (hasQuestionIntent(message)) return "Lernziel schärfen und Review-Draft erzeugen";
  return "Folie kürzen, Lernziel markieren, passende Toolaktion anbieten";
}

function lecturerAssistantProviderMode() {
  return process.env.LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER?.trim().toLowerCase() || "local";
}

function shouldUseLecturerAssistantAI() {
  return ["ai", "llm", "external", "provider", "ctox", "ctox-responses", "openai-compatible", "http"].includes(lecturerAssistantProviderMode());
}

function providerSystemPrompt() {
  return [
    "Du bist der LearnBuddy Planungsassistent für einen Referenten einer technischen Hochschulvorlesung.",
    "Antworte auf Deutsch, präzise und WYSIWYG-nah zur sichtbaren Folie.",
    "Nutze nur die gelieferten Folien-, Quellen-, Chat- und Transkriptinformationen.",
    "Erfinde keine UI-Funktionen und nenne keine API-, Provider- oder Token-Details.",
    "Gib eine kurze fachliche Empfehlung und eine konkrete nächste Aktion für die Folienbühne."
  ].join(" ");
}

function providerUserPrompt(input: { lecture: Lecture; message: string; slide: Slide | undefined; sourceRefs: string[]; strategy: string }) {
  const slide = input.slide;
  const materials = (input.lecture.materials ?? [])
    .slice(0, 4)
    .map((material) => `- ${material.originalName}: ${material.status}`)
    .join("\n") || "- Keine Materialien";
  const chat = (input.lecture.studentChatQuestions ?? [])
    .filter((question) => question.status === "accepted")
    .slice(0, 3)
    .map((question) => `- ${question.text}`)
    .join("\n") || "- Keine übernommenen Chatfragen";
  const transcript = (input.lecture.transcriptSegments ?? [])
    .filter((segment) => segment.status === "accepted")
    .slice(0, 3)
    .map((segment) => `- ${segment.text}`)
    .join("\n") || "- Keine übernommenen Transkriptsegmente";

  return [
    `Vorlesungsreihe: ${input.lecture.seriesTitle}`,
    `Vorlesung: ${input.lecture.title}`,
    `Aktuelle Strategie: ${input.strategy}`,
    `Referentenfrage: ${input.message}`,
    "",
    "Aktuelle Folie:",
    `- Kennung: ${slide?.eyebrow ?? "unbekannt"}`,
    `- Titel: ${slide?.title ?? input.lecture.title}`,
    `- Thema: ${slide?.topic ?? "unbekannt"}`,
    `- Text: ${slide?.copy.join(" | ") ?? "Keine Folientexte"}`,
    "",
    "Materialien:",
    materials,
    "",
    "Akzeptierte Chatfragen:",
    chat,
    "",
    "Akzeptierte Transkriptsegmente:",
    transcript,
    "",
    `Sichtbare Quellenanker: ${input.sourceRefs.join(" · ") || "nur Folie"}`
  ].join("\n");
}

function providerToolPlanPrompt(input: {
  lecture: Lecture;
  message: string;
  slide: Slide | undefined;
  localToolPlan: LecturerAssistantToolPlanItem[];
  strategy: string;
}) {
  return [
    "LEARNBUDDY_LECTURER_ASSISTANT_TOOL_PLAN_V1",
    "Gib nur JSON zurück, kein Markdown.",
    "Schema:",
    "{\"strategy\":\"...\",\"toolPlan\":[{\"action\":\"source_note|slide_point|review_draft|evaluation_focus|learn_density\",\"label\":\"...\",\"reason\":\"...\",\"order\":1,\"status\":\"suggested|blocked\",\"prerequisite\":\"optional\"}]}",
    "",
    `Vorlesung: ${input.lecture.seriesTitle} / ${input.lecture.title}`,
    `Aktuelle Folie: ${slideFocus(input.slide)}`,
    `Referentenfrage: ${input.message}`,
    `Lokale Strategie: ${input.strategy}`,
    "Erlaubte Aktionen: source_note, slide_point, review_draft, evaluation_focus, learn_density.",
    "Lokaler Startplan:",
    JSON.stringify({
      strategy: input.strategy,
      toolPlan: input.localToolPlan
    })
  ].join("\n");
}

function questionPlan(slide: Slide | undefined) {
  const focus = slideFocus(slide);
  const evidence = slideEvidence(slide);
  return [
    `Für die Folie "${focus}" würde ich ein einziges Lernziel scharf halten: ${evidence}`,
    `Niveau 4.0: ${levelTargets["4.0"]} - welcher Begriff beschreibt den zentralen Effekt?`,
    `Niveau 3.0: ${levelTargets["3.0"]} - warum führt die beschriebene Bewegung zum tragenden Schmierfilm?`,
    `Niveau 2.0: ${levelTargets["2.0"]} - welche Maßnahme passt zur kritischen Mischreibung?`,
    `Niveau 1.0: ${levelTargets["1.0"]} - was folgt bei einer langsam anlaufenden, hoch belasteten Welle?`
  ].join("\n");
}

function sourcePlan(lecture: Lecture, slide: Slide | undefined) {
  const refs = sourceRefsForLecture(lecture, slide);
  if (refs.length === 0) {
    return "Ich sehe bisher nur die Folie selbst. Für belastbare Fragen sollten mindestens Folieninhalt, Transkript und eine ergänzende Quelle als Materialpool verfügbar sein.";
  }

  return [
    "Ich würde den Quellenpool so gewichten:",
    `1. Folie: ${slideFocus(slide)}`,
    "2. Transkript: nur Stellen übernehmen, die das Folienthema fachlich erweitern.",
    "3. Chat: nur Fragen übernehmen, die ein echtes Missverständnis oder eine Anwendungssituation zeigen.",
    `Aktuell sichtbare Quellen: ${refs.join(" · ")}`
  ].join("\n");
}

function slidePlan(slide: Slide | undefined) {
  return [
    `Die Folie sollte visuell bei "${slideFocus(slide)}" bleiben.`,
    "Eine gute nächste Änderung wäre: erst Kernaussage kürzen, dann eine einzige Anwendungsfrage direkt an dieser Stelle vorbereiten.",
    "Alles, was nur Verwaltung ist, sollte im Menü bleiben und nicht dauerhaft Platz auf der Folie belegen."
  ].join("\n");
}

function evaluationPlan(slide: Slide | undefined) {
  const focus = slideFocus(slide);
  return [
    `Die Evaluation sollte direkt auf "${focus}" zielen.`,
    "Sinnvoll ist eine kurze Selbsteinschätzung zu Verständnis, Tempo, KI-Hilfe und einer offenen Frage.",
    "Der Learn-Modus bleibt dadurch leicht, aber die Rückmeldung ist für die nächste Überarbeitung auswertbar."
  ].join("\n");
}

function learnDensityPlan(lecture: Lecture, message: string) {
  const { density, reason } = createLecturerAssistantLearnDensity({ lecture, message });
  return [
    `Ich würde die Learn-Fragedichte auf ${density} setzen.`,
    reason,
    "Die Dichte bestimmt, wie viele anklickbare Frageanker im Learn-Modus direkt auf der Folie erscheinen."
  ].join("\n");
}

export function createLecturerAssistantSlidePoint(input: { lecture: Lecture; slideId?: string; message?: string }) {
  const slide = selectSlide(input.lecture, input.slideId);
  const message = clean(input.message ?? "");
  const focus = slideFocus(slide);
  const lower = `${message} ${focus} ${slideEvidence(slide)}`.toLowerCase();
  const line = lower.includes("anlauf") || lower.includes("welle")
    ? "Transferanker: Beim langsamen Anlauf fehlt oft ein tragfähiger Schmierfilm; Startentlastung oder Zusatzschmierung wird relevant."
    : lower.includes("mischreibung") || lower.includes("festkörper")
      ? "Merksatz: Mischreibung ist kritisch, weil tragende Schmierfilmanteile noch lokale Festkörperkontakte zulassen."
      : lower.includes("stribeck") || lower.includes("sommerfeld") || lower.includes("viskos")
        ? "Merksatz: Die Stribeck-Kurve verbindet Betriebszustand, Viskosität und Lagerbelastung mit der Reibungsform."
        : `Merksatz: ${focus} als Ursache, Kontaktzustand und konstruktive Maßnahme zusammen denken.`;

  return {
    slide,
    line
  };
}

export function createLecturerAssistantLearnDensity(input: { lecture: Lecture; slideId?: string; message?: string }) {
  const slide = selectSlide(input.lecture, input.slideId);
  const message = clean(input.message ?? "");
  const lower = message.toLowerCase();
  const current = normalizeLearnQuestionDensity(input.lecture.learnQuestionDensity);
  const requestedNumber = lower.match(/\b([1-7])\b/)?.[1];
  const density = requestedNumber
    ? normalizeLearnQuestionDensity(Number(requestedNumber), current)
    : /maximal|max|sehr viel|intensiv|prüfung|pruefung|exam|viele|mehr|hoch|dicht/i.test(lower)
      ? normalizeLearnQuestionDensity(6, current)
      : /wenig|weniger|niedrig|locker|ruhig|sparsam|kaum/i.test(lower)
        ? normalizeLearnQuestionDensity(2, current)
        : /nacharbeit|nachbereit|wiederhol|uebung|übung|selbstlern/i.test(lower)
          ? normalizeLearnQuestionDensity(5, current)
          : current;
  const reason = density > current
    ? "Damit bekommen Studierende mehr direkte Übungsanker auf der Folie."
    : density < current
      ? "Damit bleibt der Learn-Modus ruhiger und unterbricht die Folie seltener."
      : "Die aktuelle Dichte passt bereits zur beschriebenen Nacharbeit.";

  return {
    slide,
    density,
    reason
  };
}

export function createLecturerAssistantEvaluationFocus(input: { lecture: Lecture; slideId?: string; message?: string }) {
  const slide = selectSlide(input.lecture, input.slideId);
  const current = normalizeEvaluationConfig(input.lecture.evaluationConfig);
  const focus = clean(slide?.topic || slide?.title || input.lecture.title);
  const labelFocus = focus.length > 48 ? `${focus.slice(0, 45)}...` : focus;

  return {
    slide,
    focus: labelFocus,
    config: {
      ...current,
      enabled: true,
      title: `Evaluation: ${labelFocus}`,
      intro: `Kurze Rückmeldung dazu, ob ${labelFocus} fachlich angekommen ist.`,
      understandingLabel: `${labelFocus} verstanden`,
      paceLabel: `Tempo bei ${labelFocus}`,
      aiHelpfulLabel: `KI-Hilfe zu ${labelFocus}`,
      commentLabel: `Offene Frage zu ${labelFocus}`,
      submitLabel: current.submitLabel
    }
  };
}

export function createLecturerAssistantSourceNote(input: { lecture: Lecture; slideId?: string; message?: string }) {
  const slide = selectSlide(input.lecture, input.slideId);
  const message = clean(input.message ?? "");
  const focus = slideFocus(slide);
  const evidence = slideEvidence(slide);
  const lower = `${message} ${focus} ${evidence}`.toLowerCase();
  const note = lower.includes("anlauf") || lower.includes("welle")
    ? "Ergänzende Quelle: Beim Anlauf ist die Gleitgeschwindigkeit noch zu gering, um den Schmierfilm sicher zu tragen. Für Fragen sollte die Verbindung aus Startphase, Mischreibung und konstruktiver Entlastung im Materialpool liegen."
    : lower.includes("stribeck") || lower.includes("sommerfeld") || lower.includes("viskos")
      ? "Ergänzende Quelle: Die Stribeck-Kurve ordnet Grenzreibung, Mischreibung und Flüssigkeitsreibung über Betriebsparameter wie Viskosität, Drehzahl, Belastung und Lagerspiel ein."
      : "Ergänzende Quelle: Mischreibung verbindet tragende Schmierfilmanteile mit lokalen Festkörperkontakten. Für Lernfragen ist wichtig, Ursache, Reibungszustand und konstruktive Maßnahme gemeinsam zu betrachten.";

  return {
    slide,
    originalName: `Assistentenquelle: ${slide?.title ?? input.lecture.title}`,
    content: [
      `Folie: ${focus}`,
      `Ausgangspunkt: ${evidence}`,
      note
    ].join("\n\n")
  };
}

function generateLocalLecturerAssistantReply(input: { lecture: Lecture; message: string; slideId?: string }) {
  const message = clean(input.message);
  const slide = selectSlide(input.lecture, input.slideId);
  const sourceRefs = sourceRefsForLecture(input.lecture, slide);
  const sourceWeights = sourceWeightsForLecture(input.lecture, slide);
  const toolSuggestions = toolSuggestionsForMessage(message);
  const toolPlan = toolPlanFromSuggestions({
    suggestions: toolSuggestions,
    lecture: input.lecture,
    slide
  });
  const strategy = strategyForMessage(message);
  const intro = `Ich beziehe mich auf "${slideFocus(slide)}".`;
  const body = hasEvaluationIntent(message)
    ? evaluationPlan(slide)
    : hasLearnDensityIntent(message)
      ? learnDensityPlan(input.lecture, message)
      : hasQuestionIntent(message)
      ? questionPlan(slide)
      : hasSourceIntent(message)
        ? sourcePlan(input.lecture, slide)
        : slidePlan(slide);
  const metadata: LecturerAssistantMetadata = {
    provider: "learnbuddy-agent-loop",
    model: "local-planning-agent-v1",
    agentRunId: `agent_${crypto.randomUUID()}`,
    strategy,
    steps: [
      {
        title: "Kontext gelesen",
        detail: slide ? `Folie ${slide.eyebrow}: ${slide.title}` : input.lecture.title,
        status: "done"
      },
      {
        title: "Quellen gewichtet",
        detail: sourceWeights.map((source) => `${source.label} ${Math.round(source.weight * 100)}%`).join(" · "),
        status: "done"
      },
      {
        title: "Strategie gewählt",
        detail: strategy,
        status: "done"
      },
      {
        title: "Toolaktion vorgeschlagen",
        detail: toolSuggestions.map((tool) => tool.label).join(" · "),
        status: "suggested"
      }
    ],
    sourceWeights,
    toolSuggestions,
    toolPlan
  };

  return {
    content: `${intro}\n\n${body}`,
    sourceRefs,
    metadata
  };
}

function parseProviderToolPlan(value: string, fallback: LecturerAssistantMetadata): Pick<LecturerAssistantMetadata, "strategy" | "toolPlan"> {
  try {
    const payload = JSON.parse(value) as {
      strategy?: unknown;
      toolPlan?: unknown;
    };
    const toolPlan = Array.isArray(payload.toolPlan)
      ? payload.toolPlan.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const action: LecturerAssistantToolSuggestion["action"] | undefined = record.action === "source_note" || record.action === "slide_point" || record.action === "review_draft" || record.action === "evaluation_focus" || record.action === "learn_density"
          ? record.action
          : undefined;
        const label = typeof record.label === "string" ? clean(record.label) : "";
        const reason = typeof record.reason === "string" ? clean(record.reason) : "";
        const order = Number(record.order);
        const status: LecturerAssistantToolPlanItem["status"] = record.status === "blocked" ? "blocked" : "suggested";
        const prerequisite = typeof record.prerequisite === "string" && record.prerequisite.trim()
          ? clean(record.prerequisite)
          : undefined;
        return action && label && reason && Number.isFinite(order)
          ? [{ action, label, reason, order: Math.max(1, Math.round(order)), status, prerequisite }]
          : [];
      })
      : [];

    return {
      strategy: typeof payload.strategy === "string" && payload.strategy.trim() ? clean(payload.strategy) : fallback.strategy,
      toolPlan: toolPlan.length > 0 ? toolPlan.sort((a, b) => a.order - b.order).slice(0, 3) : fallback.toolPlan
    };
  } catch {
    return {
      strategy: fallback.strategy,
      toolPlan: fallback.toolPlan
    };
  }
}

function addTokenUsage(left: number | undefined, right: number | undefined) {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

export async function generateLecturerAssistantReply(input: { lecture: Lecture; message: string; slideId?: string }) {
  const localReply = generateLocalLecturerAssistantReply(input);
  if (!shouldUseLecturerAssistantAI()) return localReply;

  const message = clean(input.message);
  const slide = selectSlide(input.lecture, input.slideId);
  const strategy = localReply.metadata.strategy ?? strategyForMessage(message);

  try {
    const provider = getAIProvider();
    const result = await provider.complete({
      system: providerSystemPrompt(),
      user: providerUserPrompt({
        lecture: input.lecture,
        message,
        slide,
        sourceRefs: localReply.sourceRefs,
        strategy
      }),
      maxOutputTokens: 760,
      temperature: 0.2
    });
    const toolPlanResult = await provider.complete({
      system: providerSystemPrompt(),
      user: providerToolPlanPrompt({
        lecture: input.lecture,
        message,
        slide,
        localToolPlan: localReply.metadata.toolPlan ?? [],
        strategy
      }),
      maxOutputTokens: 420,
      temperature: 0,
      responseFormat: "json_object"
    });
    const content = clean(result.answer);
    if (!content) return localReply;
    const providerToolDecision = parseProviderToolPlan(toolPlanResult.answer, localReply.metadata);

    const metadata: LecturerAssistantMetadata = {
      ...localReply.metadata,
      provider: provider.info.provider,
      model: provider.info.model,
      strategy: providerToolDecision.strategy ?? localReply.metadata.strategy,
      toolPlan: providerToolDecision.toolPlan ?? localReply.metadata.toolPlan,
      usage: {
        inputTokens: addTokenUsage(result.usage?.inputTokens, toolPlanResult.usage?.inputTokens),
        outputTokens: addTokenUsage(result.usage?.outputTokens, toolPlanResult.usage?.outputTokens),
        totalTokens: addTokenUsage(result.usage?.totalTokens, toolPlanResult.usage?.totalTokens)
      },
      steps: [
        ...(localReply.metadata.steps ?? []),
        {
          title: "AIProvider genutzt",
          detail: `${provider.info.provider}:${provider.info.model}`,
          status: "done"
        },
        {
          title: "Provider-Toolplan geprüft",
          detail: (providerToolDecision.toolPlan ?? localReply.metadata.toolPlan ?? []).map((tool) => `${tool.order}. ${tool.label}`).join(" · "),
          status: "done"
        }
      ]
    };

    return {
      ...localReply,
      content,
      metadata
    };
  } catch {
    const metadata: LecturerAssistantMetadata = {
      ...localReply.metadata,
      steps: [
        ...(localReply.metadata.steps ?? []),
        {
          title: "AIProvider nicht erreichbar",
          detail: "Lokaler Planungsmodus genutzt.",
          status: "blocked"
        }
      ]
    };

    return {
      ...localReply,
      metadata
    };
  }
}
