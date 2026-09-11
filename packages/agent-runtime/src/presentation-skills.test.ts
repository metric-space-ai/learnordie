import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPresentationSkillBrief,
  selectPresentationSkills
} from "./presentation-skills";

test("routes element rewrites through composition and review skills", () => {
  const skills = selectPresentationSkills({
    prompt: "Kürze diesen Absatz und formuliere ihn präziser.",
    hasSelectedBlock: true,
    hasPresentationAssets: false
  });

  assert.deepEqual(skills.map((skill) => skill.id), ["slide-composer", "deck-critic"]);
});

test("routes slide layout and visual requests through the matching presentation skills", () => {
  const skills = selectPresentationSkills({
    prompt: "Baue die Folie als zweispaltigen Vergleich mit dem vorhandenen Diagramm auf.",
    hasSelectedBlock: false,
    hasPresentationAssets: true
  });
  const ids = skills.map((skill) => skill.id);

  assert.deepEqual(ids, [
    "deck-strategist",
    "slide-composer",
    "template-director",
    "visual-director",
    "deck-critic"
  ]);
  assert.match(buildPresentationSkillBrief(skills), /one clear teaching objective/i);
  assert.match(buildPresentationSkillBrief(skills), /source-grounded visuals/i);
});
