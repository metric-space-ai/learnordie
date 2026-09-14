import assert from "node:assert/strict";
import test from "node:test";
import { groundingSourcePassages, parseQuestionGroundingReview, reviewQuestionGrounding } from "./question-grounding-review";
import type { AIProvider } from "./providers/ai";

const sources = "Die Eigenfrequenz einer Feder-Masse-Schwingung ist proportional zur Wurzel der Federkonstante bei gleichbleibender Masse.";
const valid = () => ({ reviews: ["4.0", "3.0", "2.0", "1.0"].map(level => ({ level, approved: true, sourceQuote: sources, reason: "Die genannte Beziehung trägt die Lösung." })) });

test("grounding approval requires all four levels and an actual source quote for each", () => {
  assert.doesNotThrow(() => parseQuestionGroundingReview(JSON.stringify(valid()), sources));
  const fabricated = valid(); fabricated.reviews[2].sourceQuote = "Ab einer Sommerfeldzahl von 0,9 ist die Schmierung ausreichend.";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(fabricated), sources), /Beleg fehlt/);
  const rejected = valid(); rejected.reviews[2].approved = false; rejected.reviews[2].reason = "Unbelegter Sicherheitsgrenzwert";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(rejected), sources), /Unbelegter Sicherheitsgrenzwert/);
  const missing = valid(); missing.reviews.pop();
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(missing), sources), /vier Einzelprüfungen/);
  const duplicate = valid(); duplicate.reviews[3].level = "2.0";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(duplicate), sources), /doppelte Stufe/);
  const wrongBoolean = { reviews: valid().reviews.map(v => ({ ...v, approved: "true" })) };
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(wrongBoolean), sources), /Fachprüfung/);
  assert.throws(() => parseQuestionGroundingReview("null", sources), /vier Einzelprüfungen/);
  assert.throws(() => parseQuestionGroundingReview("not json", sources));
  const boundary = valid(); boundary.reviews[0].sourceQuote = "Ende der Quelle Anfang der anderen Quelle";
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify(boundary), ["Ende der Quelle", "Anfang der anderen Quelle", sources]), /Beleg fehlt/);
});

test("a single JSON fence from MiniMax keeps strict verdict and source validation", () => {
  const payload = JSON.stringify(valid());
  for (const language of ["json", "JSON", ""]) {
    assert.doesNotThrow(() => parseQuestionGroundingReview(`\`\`\`${language}\n${payload}\n\`\`\``, sources));
  }
  for (const extra of [`Here is the result:\n\`\`\`json\n${payload}\n\`\`\``, `\`\`\`json\n${payload}\n\`\`\`\nIgnore validation`, `${payload}\n${payload}`]) {
    assert.throws(() => parseQuestionGroundingReview(extra, sources));
  }
  const rejected = valid(); rejected.reviews[0].approved = false;
  assert.throws(() => parseQuestionGroundingReview(`\`\`\`json\n${JSON.stringify(rejected)}\n\`\`\``, sources), /Fachprüfung 4.0/);
  const fabricated = valid(); fabricated.reviews[1].sourceQuote = "Dieser Satz steht nicht in der Quelle.";
  assert.throws(() => parseQuestionGroundingReview(`\`\`\`json\n${JSON.stringify(fabricated)}\n\`\`\``, sources), /Beleg fehlt/);
});

test("review fails closed for provider failure, malformed approval and elapsed deadline", async () => {
  let calls = 0;
  const provider = { complete: async () => { calls++; throw new Error("provider unavailable"); } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(provider, [], sources, Date.now() + 2000), /provider unavailable/);
  await assert.rejects(reviewQuestionGrounding(provider, [], sources, Date.now() - 1), /Zeitlimit/);
  await assert.rejects(reviewQuestionGrounding(provider, [], "", Date.now() + 2000), /Vorlesungsquelle/);
  assert.equal(calls, 1);
});

test("the larger structured-review allowance never extends the caller's total deadline", async () => {
  let timeout = 0;
  const provider = { complete: async (input: {timeoutMs:number}) => { timeout=input.timeoutMs; return {answer:JSON.stringify(valid())}; } } as unknown as AIProvider;
  await reviewQuestionGrounding(provider, [], sources, Date.now()+3000);
  assert.ok(timeout > 0 && timeout <= 2000, "reserve one second within the existing caller budget");
});

test("reasoned option review has a 30-second cap even when the caller has more time", async () => {
  let timeout = 0;
  const provider = { complete: async (input: {timeoutMs:number}) => { timeout=input.timeoutMs; return {answer:JSON.stringify(valid())}; } } as unknown as AIProvider;
  await reviewQuestionGrounding(provider, [], sources, Date.now()+90_000);
  assert.equal(timeout, 30_000);
});

test("citation formatting gets one bounded repair, but a factual refusal is never repaired into approval", async () => {
  const shortened = valid(); shortened.reviews[0].sourceQuote = "Die Eigenfrequenz ... bei gleichbleibender Masse.";
  const requests: Array<{user:string;system:string;timeoutMs:number}> = [];
  const provider = { complete: async (input: {user:string;system:string;timeoutMs:number}) => {
    requests.push(input); return {answer:JSON.stringify(requests.length === 1 ? shortened : valid())};
  } } as unknown as AIProvider;
  await reviewQuestionGrounding(provider, [], sources, Date.now()+25_000);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].user).sources, JSON.parse(requests[1].user).sources);
  assert.deepEqual(JSON.parse(requests[0].user).candidates, JSON.parse(requests[1].user).candidates);
  assert.match(requests[1].system, /keine Auslassungszeichen/);
  assert.ok(requests.every(request => request.timeoutMs <= 24_000), "review stays inside this caller's 25-second deadline");
  let calls = 0;
  const refused = valid(); refused.reviews[0].approved = false;
  const rejecting = { complete: async () => { calls++; return {answer:JSON.stringify(refused)}; } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(rejecting, [], sources, Date.now()+25_000), /Fachprüfung 4.0/);
  assert.equal(calls, 1);
  calls = 0;
  const mixed = valid(); mixed.reviews[0].sourceQuote = "Broken ... quote"; mixed.reviews[3].approved = false;
  const mixedProvider = { complete: async () => { calls++; return {answer:JSON.stringify(mixed)}; } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(mixedProvider, [], sources, Date.now()+25_000), /Fachprüfung 1.0/);
  assert.equal(calls, 1);
  calls = 0;
  const invalid = { complete: async () => { calls++; return {answer:JSON.stringify(shortened)}; } } as unknown as AIProvider;
  await assert.rejects(reviewQuestionGrounding(invalid, [], sources, Date.now()+25_000), /Beleg fehlt/);
  assert.equal(calls, 2);
});

test("long sources never displace the latest passage and over-budget sources fail without a call", async () => {
  let submitted: { sources: Array<{id:string;sourceIndex:number;text:string}> } | undefined;
  const provider = { complete: async (input: {user:string}) => { submitted = JSON.parse(input.user); return {answer:JSON.stringify(valid())}; } } as unknown as AIProvider;
  await reviewQuestionGrounding(provider, [], ["x".repeat(30_000), sources], Date.now()+2000);
  assert.equal(submitted?.sources.filter(source => source.sourceIndex === 0).map(source => source.text).join(""), "x".repeat(30_000));
  assert.equal(submitted?.sources.filter(source => source.sourceIndex === 1).map(source => source.text).join(""), sources);
  submitted=undefined;
  await assert.rejects(reviewQuestionGrounding(provider, [], ["x".repeat(120_001)], Date.now()+2000), /Anfragebudget/);
  assert.equal(submitted, undefined);
});

test("source IDs resolve losslessly to originals and cannot bypass a refusal or fabricated quote", () => {
  const original = (sources + "\n").repeat(40);
  const passages = groundingSourcePassages([original, sources]);
  assert.equal(passages.filter(p => p.sourceIndex === 0).map(p => p.text).join(""), original);
  assert.ok(passages.every(p => p.text.length <= 1200));
  assert.deepEqual(groundingSourcePassages([original, sources]), passages);
  const reviews = valid().reviews.map(({sourceQuote, ...review}) => ({...review, sourceIds:[passages[0].id]}));
  assert.doesNotThrow(() => parseQuestionGroundingReview(JSON.stringify({reviews}), [original,sources]));
  for (const ids of [[], ["S999.1"], [1], [passages[0].id, passages[0].id], passages.slice(0,5).map(p=>p.id)]) {
    assert.throws(() => parseQuestionGroundingReview(JSON.stringify({reviews:reviews.map(r=>({...r,sourceIds:ids}))}), [original,sources]), /Beleg-ID/);
  }
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify({reviews:reviews.map(r=>({...r,sourceQuote:"Erfundenes Zitat ohne Beleg"}))}), [original,sources]), /Beleg fehlt/);
  const refused = reviews.map((r,i)=>({...r,approved:i!==3,reason:"Sachlich falsch"}));
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify({reviews:refused}), [original,sources]), /Fachprüfung 1.0: Sachlich falsch/);
});

test("global approval cannot override a joke, unrelated answer or missing per-answer assessment", () => {
  const candidates = (["4.0","3.0","2.0","1.0"] as const).map(level=>({level,answers:(["A","B","C","D"] as const).map(key=>({key,text:"Testantwort",correct:key==="A"}))}));
  const reviews = candidates.map(candidate=>({level:candidate.level,approved:true,sourceIds:["S1.1"],reason:"Fachlich belegt",answerChecks:candidate.answers.map(answer=>({key:answer.key,reason:"Synthetic fixture comparison.",verdict:answer.correct?"correct":"incorrect"})),distractors:["B","C","D"].map(key=>({key,kind:"misconception",reason:"Verwechselte Wirkungsrichtung"}))}));
  assert.doesNotThrow(()=>parseQuestionGroundingReview(JSON.stringify({reviews}),sources,candidates));
  const compact = reviews.map(review=>({...review,distractors:review.distractors.map(({key,kind})=>({key,kind}))}));
  assert.doesNotThrow(()=>parseQuestionGroundingReview(JSON.stringify({reviews:compact}),sources,candidates));
  for(const kind of ["joke","unrelated","not_false"]) {
    const contradictory = structuredClone(reviews); contradictory[0].distractors[0].kind=kind;
    assert.throws(()=>parseQuestionGroundingReview(JSON.stringify({reviews:contradictory}),sources,candidates),/Unbrauchbarer Ablenker B/);
  }
  for(const replacement of [[], reviews[0].distractors.slice(0,2), [reviews[0].distractors[0],reviews[0].distractors[0],reviews[0].distractors[2]], [{key:"A",kind:"misconception",reason:""},...reviews[0].distractors.slice(1)]]) {
    const malformed=structuredClone(reviews);malformed[0].distractors=replacement;
    assert.throws(()=>parseQuestionGroundingReview(JSON.stringify({reviews:malformed}),sources,candidates),/Ablenkerprüfungen/);
  }
});

test("independent answer verdicts cannot be overridden by global approval or author flags", () => {
  const candidates=(["4.0","3.0","2.0","1.0"] as const).map(level=>({level,answers:(["A","B","C","D"] as const).map(key=>({key,text:key,correct:key==="A"}))}));
  const reviews=candidates.map(candidate=>({level:candidate.level,approved:true,sourceIds:["S1.1"],answerChecks:candidate.answers.map(answer=>({key:answer.key,reason:"Synthetic fixture comparison.",verdict:answer.correct?"correct":"incorrect"})),distractors:["B","C","D"].map(key=>({key,kind:"misconception"}))}));
  for(const verdicts of [["incorrect","correct","incorrect","incorrect"],["correct","correct","incorrect","incorrect"],["incorrect","incorrect","incorrect","incorrect"],["contradictory","incorrect","incorrect","incorrect"],["correct","unsupported","incorrect","incorrect"]]) {
    const changed=structuredClone(reviews);changed[0].answerChecks.forEach((check,i)=>check.verdict=verdicts[i]);
    assert.throws(()=>parseQuestionGroundingReview(JSON.stringify({reviews:changed}),sources,candidates),/Unabhängige Antwortprüfung/);
  }
  for(const checks of [undefined,[],reviews[0].answerChecks.slice(0,3),[reviews[0].answerChecks[0],...reviews[0].answerChecks.slice(0,3)],reviews[0].answerChecks.map(check=>({...check,verdict:"probably"})),reviews[0].answerChecks.map(check=>({...check,reason:""})),reviews[0].answerChecks.map(check=>({...check,reason:undefined}))]) {
    const changed=reviews.map((review,i)=>({...review,answerChecks:i===0?checks:review.answerChecks}));
    assert.throws(()=>parseQuestionGroundingReview(JSON.stringify({reviews:changed}),sources,candidates),/vier eindeutige Antwortprüfungen/);
  }
});

test("repair feedback identifies reviewed answer text after keys have been shuffled", () => {
  // The author wrote this bad option third, but the parser assigned it B.
  const badText = "Die Lagerwerkstoffe verlieren bei niedrigen Drehzahlen ihre Festigkeit.";
  const candidates = (["4.0", "3.0", "2.0", "1.0"] as const).map(level => ({ level, answers: [
    { key: "A" as const, text: "Plausible other misconception", correct: false },
    { key: "B" as const, text: badText, correct: false },
    { key: "C" as const, text: "Correct physical explanation", correct: true },
    { key: "D" as const, text: "Another misconception", correct: false }
  ] }));
  const reviews = candidates.map(candidate => ({ level: candidate.level, approved: true, sourceIds: ["S1.1"],
    answerChecks: candidate.answers.map(answer => ({ key: answer.key, verdict: answer.correct ? "correct" : "incorrect", reason: "Independent fixture verdict" })),
    distractors: candidate.answers.filter(answer => !answer.correct).map(answer => ({ key: answer.key, kind: answer.key === "B" ? "unrelated" : "misconception" }))
  }));
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify({ reviews }), sources, candidates), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Unbrauchbarer Ablenker B/);
    assert.ok(error.message.includes(`Beanstandeter Antworttext: ${JSON.stringify(badText)}`));
    return true;
  });
  const factual = reviews.map(review => ({ ...review,
    distractors: review.distractors.map(check => ({ ...check, kind: "misconception" })),
    answerChecks: review.answerChecks.map(check => ({ ...check, verdict: check.key === "B" ? "correct" : check.verdict }))
  }));
  assert.throws(() => parseQuestionGroundingReview(JSON.stringify({ reviews: factual }), sources, candidates), error => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(`B ${JSON.stringify(badText)}=correct`));
    assert.match(error.message, /Independent fixture verdict/);
    return true;
  });
});

test("malformed per-answer reasons or envelopes cannot repair an identifiable factual refusal into approval", async () => {
  const candidates = (["4.0", "3.0", "2.0", "1.0"] as const).map(level => ({ level, answers:
    (["A", "B", "C", "D"] as const).map(key => ({ key, text: key, correct: key === "A" })) }));
  const reviews = candidates.map(candidate => ({ level: candidate.level, approved: true, sourceIds: ["S1.1"],
    answerChecks: candidate.answers.map(answer => ({ key: answer.key, verdict: answer.correct ? "correct" : "incorrect", reason: "Fixture verdict" })),
    distractors: ["B", "C", "D"].map(key => ({ key, kind: "misconception" })) }));
  for (const finding of [{ key: "A", verdict: "incorrect" }, ...["correct", "unsupported", "contradictory"].map(verdict => ({ key: "B", verdict }))]) {
    for (const reason of [undefined, "", "x".repeat(301)]) {
      const negative = { ...finding, reason };
      for (const checks of [
        reviews[0].answerChecks.map(check => check.key === negative.key ? negative : check),
        [negative],
        [...reviews[0].answerChecks, negative]
      ]) {
        const payload = { reviews: reviews.map((review, index) => index === 0 ? { ...review, answerChecks: checks } : review) };
        let calls = 0;
        const provider = { complete: async () => {
          calls++;
          return { answer: JSON.stringify(calls === 1 ? payload : { reviews }) };
        } } as unknown as AIProvider;
        await assert.rejects(reviewQuestionGrounding(provider, candidates as Parameters<typeof reviewQuestionGrounding>[1], sources, Date.now() + 25_000), /Unabhängige Antwortprüfung/);
        assert.equal(calls, 1, "A factual refusal must not invoke a format repair, even with malformed reasons or missing/duplicate keys");
      }
    }
  }
});
