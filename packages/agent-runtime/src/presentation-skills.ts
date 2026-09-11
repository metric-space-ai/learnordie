export const presentationSkillIds = [
  "deck-strategist",
  "slide-composer",
  "template-director",
  "visual-director",
  "deck-critic"
] as const;

export type PresentationSkillId = typeof presentationSkillIds[number];

export type PresentationSkill = {
  id: PresentationSkillId;
  purpose: string;
  instructions: readonly string[];
};

export const presentationSkills: readonly PresentationSkill[] = [
  {
    id: "deck-strategist",
    purpose: "Turns a teaching goal into a coherent narrative and slide sequence.",
    instructions: [
      "Preserve one clear teaching objective per slide.",
      "Prefer a causal narrative over a collection of facts.",
      "Remove repetition and make transitions between ideas explicit."
    ]
  },
  {
    id: "slide-composer",
    purpose: "Rewrites the selected slide or element for clarity and teaching value.",
    instructions: [
      "Keep one dominant message and make supporting content scannable.",
      "Use concise, concrete German suitable for projection.",
      "Do not add meta commentary about the editing process."
    ]
  },
  {
    id: "template-director",
    purpose: "Chooses structure and layout without changing the visual identity arbitrarily.",
    instructions: [
      "Respect the deck theme and existing visual system.",
      "Choose layout from content hierarchy, comparison, process, or evidence needs.",
      "Avoid decorative layout changes that do not improve comprehension."
    ]
  },
  {
    id: "visual-director",
    purpose: "Selects and describes diagrams, figures, formulas, and other visual evidence.",
    instructions: [
      "Prefer source-grounded visuals that explain the actual subject.",
      "Write useful captions and accessible alternative text.",
      "Do not invent sources, measurements, or visual evidence."
    ]
  },
  {
    id: "deck-critic",
    purpose: "Checks narrative, density, visual hierarchy, accessibility, and factual restraint.",
    instructions: [
      "Flag overflow, weak hierarchy, unsupported claims, and duplicate content.",
      "Keep warnings actionable and specific.",
      "Prefer the smallest change that resolves the issue."
    ]
  }
] as const;

export function selectPresentationSkills(input: {
  prompt: string;
  hasSelectedBlock: boolean;
  hasPresentationAssets: boolean;
}): PresentationSkill[] {
  const prompt = input.prompt.toLocaleLowerCase("de-DE");
  const selected = new Set<PresentationSkillId>([
    input.hasSelectedBlock ? "slide-composer" : "deck-strategist",
    "deck-critic"
  ]);

  if (/layout|struktur|aufbau|spalten|vergleich|prozess|timeline|vorlage|template/.test(prompt)) {
    selected.add("template-director");
  }
  if (input.hasPresentationAssets || /bild|grafik|diagramm|visual|formel|tabelle|abbildung/.test(prompt)) {
    selected.add("visual-director");
  }
  if (/folie|text|titel|kuerz|kürz|praez|präz|erklaer|erklär|formulier|stichpunkt/.test(prompt)) {
    selected.add("slide-composer");
  }

  return presentationSkills.filter((skill) => selected.has(skill.id));
}

export function buildPresentationSkillBrief(skills: readonly PresentationSkill[]) {
  return skills
    .map((skill) => [
      `[${skill.id}] ${skill.purpose}`,
      ...skill.instructions.map((instruction) => `- ${instruction}`)
    ].join("\n"))
    .join("\n\n");
}
