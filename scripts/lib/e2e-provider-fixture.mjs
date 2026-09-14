// Synthetic transport contracts only; never evidence of model quality.
export function providerFixturePrompt(payload) {
  const contentText = content => typeof content === "string" ? content
    : Array.isArray(content) ? content.map(part => typeof part?.text === "string" ? part.text : "").join("\n") : "";
  const input = payload.input ?? payload.messages;
  return [payload.instructions, typeof input === "string" ? input
    : Array.isArray(input) ? input.map(message => contentText(message?.content)).join("\n") : ""]
    .filter(value => typeof value === "string" && value).join("\n");
}

export function fixtureGroundingReview(prompt, families) {
  const offset = prompt.indexOf('{"sources":');
  if (offset < 0) throw new Error("Grounding fixture requires the structured review request");
  const { sources, candidates } = JSON.parse(prompt.slice(offset));
  const variants = families.flatMap(family => family.variants);
  return JSON.stringify({ reviews: candidates.map(candidate => {
    const known = variants.find(variant => variant.level === candidate.level && variant.text === candidate.text
      && variant.explanation === candidate.explanation && candidate.answers.length === 4
      && new Set(candidate.answers.map(answer => answer.text)).size === 4
      && variant.answers.every(answer => candidate.answers.some(actual => actual.text === answer.text)));
    const source = sources.find(passage => passage.text.length >= 12);
    if (!known || !source) return { level: candidate.level, approved: false, reason: "Unknown synthetic fixture or missing source; no automatic approval." };
    const correctText = known.answers.find(answer => answer.correct)?.text;
    return {
      level: candidate.level, approved: true, sourceIds: [source.id],
      reason: "Known synthetic fixture, not semantic model evidence.",
      answerChecks: candidate.answers.map(answer => ({ key: answer.key,
        verdict: answer.text === correctText ? "correct" : "incorrect", reason: "Exact known fixture comparison." })),
      distractors: candidate.answers.filter(answer => answer.text !== correctText).map(answer => ({ key: answer.key, kind: "misconception" }))
    };
  }) });
}

export function fixtureTransportUrl(input, origin) {
  const url = new URL(input);
  if (!["api.minimax.io", "llm.learnordie.app"].includes(url.hostname)) return null;
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid fixture provider URL");
  const target = new URL(origin);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("Provider fixture transport must be an explicit loopback origin");
  }
  target.pathname = url.pathname;
  target.search = url.search;
  return target.href;
}
