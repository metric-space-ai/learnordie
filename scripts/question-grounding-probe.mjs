#!/usr/bin/env node
// Known synthetic cases only. No database writes and no credential output.
if (!process.argv.includes("--run") || process.env.VERCEL_ENV !== "production") {
  console.error("Run explicitly with --run inside Vercel production; not a browser acceptance test.");
  process.exit(1);
}
const { getAIProvider } = await import("@/server/providers/ai");
const { reviewQuestionGrounding, parseGroundingJson } = await import("@/server/question-grounding-review");
const provider = getAIProvider();
if (provider.info.model.toLowerCase() !== "minimax-m3") throw new Error("MiniMax M3 required");
// These requests contain only the synthetic fixtures below. Retain bounded
// verdict fields so a semantic refusal is distinguishable from bad JSON or
// unavailable transport, without printing HTTP errors or credentials.
const reviewVerdicts = [];
const complete = provider.complete.bind(provider);
provider.complete = async (input) => {
  const requestStarted=Date.now();
  let result;
  try { result=await complete(input); }
  catch(error) {
    reviewVerdicts.push({providerFailure:/timed out|abort/i.test(String(error?.message??""))?"timeout":"transport",elapsedMs:Date.now()-requestStarted});
    throw error;
  }
  try {
    const parsed = parseGroundingJson(result.answer);
    reviewVerdicts.push({ reviews: Array.isArray(parsed.reviews) ? parsed.reviews.slice(0, 4).map(entry => ({
      level: String(entry?.level ?? "").slice(0, 8), approved: entry?.approved === true,
      sourceIds: Array.isArray(entry?.sourceIds) ? entry.sourceIds.slice(0,4) : undefined,
      distractors: Array.isArray(entry?.distractors) ? entry.distractors.slice(0,3).map(check=>({key:check?.key,kind:check?.kind,reason:String(check?.reason??"").slice(0,200)})) : undefined,
      sourceQuote: String(entry?.sourceQuote ?? "").slice(0, 600), reason: String(entry?.reason ?? "").slice(0, 400)
    })) : null,
      // This executable is restricted to public synthetic fixtures. Preserve
      // the actual candidate so a reviewer's claimed defect can be checked,
      // rather than treating that model's explanation as proof. Runtime
      // handlers must never log student/lecture candidates this way.
      syntheticCandidate: Array.isArray(parsed.variants) ? {
        supported: parsed.supported, topic: String(parsed.topic ?? "").slice(0,100),
        coreStatement: String(parsed.coreStatement ?? "").slice(0,500),
        variants: parsed.variants.slice(0,4).map(variant=>({
          level: variant.level, text: String(variant.text??"").slice(0,500),
          explanation: String(variant.explanation??"").slice(0,700),
          answers: Array.isArray(variant.answers) ? variant.answers.slice(0,4).map(answer=>({text:String(answer.text??"").slice(0,500),correct:answer.correct})) : null
        }))
      } : undefined
    });
  } catch { reviewVerdicts.push({ malformedJson: true }); }
  return result;
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{
  const url=new URL(args[0] instanceof Request?args[0].url:String(args[0]));
  if(url.protocol!=="https:"||!["api.minimax.io","llm.learnordie.app"].includes(url.hostname))throw new Error("Unexpected provider endpoint");
  return originalFetch(...args);
};
const sources = "Eine vertikal aufgehängte Masse m schwingt ungedämpft an einer linearen Feder der Steifigkeit k. Bei gleichbleibender Masse gilt für die Gleichgewichtsauslenkung x_eq = m*g/k und für die Eigenkreisfrequenz omega = sqrt(k/m). Eine weichere Feder führt deshalb zu größerer statischer Auslenkung und langsamerer Schwingung. Vervierfacht man k, halbiert sich die Schwingungsdauer und die statische Auslenkung sinkt auf ein Viertel. Die Sommerfeldzahl kombiniert Viskosität, Drehzahl, Belastung und Lagerspiel.";
const levels = ["4.0", "3.0", "2.0", "1.0"];
const stems = [
  "Eine Masse hängt an einer linearen Feder. Was passiert bei kleinerer Steifigkeit und unveränderter Masse?",
  "Warum schwingt dieselbe Masse an einer weicheren linearen Feder langsamer?",
  "Die Steifigkeit einer linearen Feder wird vervierfacht, die Masse bleibt gleich. Wie ändert sich die Schwingungsdauer?",
  "Ein ungedämpftes lineares Feder-Masse-System soll bei gleicher Masse die halbe Schwingungsdauer erhalten. Welche Änderung erreicht das?"
];
const choices = [
  ["Die Masse hängt tiefer und schwingt langsamer.", "Die Masse hängt höher und schwingt schneller.", "Die Masse hängt tiefer und schwingt schneller.", "Die Masse hängt höher und schwingt langsamer."],
  ["Die Eigenkreisfrequenz sinkt mit der Wurzel der Steifigkeit.", "Die Eigenkreisfrequenz ist umgekehrt proportional zur Wurzel der Steifigkeit.", "Die kleinere Steifigkeit verändert nur die Ruhelage, nicht die Eigenkreisfrequenz.", "Die Eigenkreisfrequenz ist direkt proportional zur Steifigkeit, ohne Wurzel."],
  ["Sie halbiert sich.", "Sie verdoppelt sich.", "Sie bleibt gleich.", "Sie vervierfacht sich."],
  ["Die Steifigkeit vervierfachen.", "Die Steifigkeit verdoppeln, weil die Schwingungsdauer umgekehrt proportional zu k sei.", "Die Steifigkeit vierteln, weil eine weichere Feder schneller zurückschwinge.", "Nur die Anfangsauslenkung verdoppeln, damit die größere Federkraft die Schwingung beschleunige."]
];
const explanations = [
  "Bei kleinerem k wächst die statische Verlängerung mg/k. Zugleich sinkt omega = sqrt(k/m), daher hängt die Masse tiefer und schwingt langsamer.",
  "Bei gleicher Masse sinkt omega = sqrt(k/m) mit kleinerem k. Weniger Rückstellkraft je Auslenkung führt zur langsameren Schwingung; die Abhängigkeit ist weder linear noch umgekehrt proportional.",
  "Vierfaches k verdoppelt omega = sqrt(k/m). Mit T = 2π/omega halbiert sich deshalb die Schwingungsdauer.",
  "Für halbes T braucht man doppeltes omega und damit vierfaches k. Die Anfangsauslenkung kommt in omega = sqrt(k/m) nicht vor: Eine größere Amplitude verkürzt die Periode des linearen Systems nicht."
];
const valid = levels.map((level,i)=>({ level, text:stems[i], answers:choices[i].map((text,j)=>({key:"ABCD"[j],text,correct:j===0})), explanation:explanations[i] }));
const invalid = structuredClone(valid);
invalid[2] = { ...invalid[2], text:"Ein Gleitlager hat eine Sommerfeldzahl von 0,9. Welche Aussage über die Schmierung ist richtig?", answers:[
  {key:"A",text:"Der Schmierfilm ist ausreichend, aber die Sicherheit gegen Trockenlauf gering.",correct:true},
  {key:"B",text:"Ohne ein gültiges Grenzwertmodell ist diese Beurteilung nicht möglich.",correct:false},
  {key:"C",text:"Der Schmierfilm bricht sofort zusammen.",correct:false},
  {key:"D",text:"Es liegt ausschließlich hydrostatische Schmierung vor.",correct:false}
], explanation:"Bei 0,9 ist die Schmierung noch ausreichend." };
const report = {model:provider.info.model,databaseWrites:false,browserTested:false,cases:[],reviewVerdicts};
try {
  let started=Date.now();
  await reviewQuestionGrounding(provider,valid,sources,Date.now()+40000);
  report.cases.push({name:"grounded-spring-family",status:"pass",elapsedMs:Date.now()-started});
  started=Date.now();let rejected=false;
  try { await reviewQuestionGrounding(provider,invalid,sources,Date.now()+40000); }
  catch(error) {
    // Timeout/malformed/transport errors are not proof of factual rejection.
    if (/^Fachprüfung 2\.0:/.test(error.message) && !/Beleg fehlt/.test(error.message)) rejected=true;
    else throw error;
  }
  if(!rejected)throw new Error("unsupported-numeric-claim-approved");
  report.cases.push({name:"unsupported-Sommerfeld-0.9-claim",status:"pass",elapsedMs:Date.now()-started});
  // A real author/reviewer pair previously approved this underdetermined
  // scenario. A valid number is not evidence of a regime threshold.
  const underdetermined = structuredClone(valid);
  underdetermined[2] = { ...underdetermined[2],
    text:"Ein Radiallager wird nach 10 Sekunden Stillstand mit 60 U/min angefahren. Welcher Schmierungszustand liegt vor?",
    answers:[
      {key:"A",text:"Mischreibung, weil 60 U/min für einen tragenden Schmierfilm zu gering sind.",correct:true},
      {key:"B",text:"Ohne Last, Geometrie, Viskosität und Lagermodell ist der Zustand nicht bestimmbar.",correct:false},
      {key:"C",text:"Vollständige Flüssigkeitsreibung, weil jede Drehbewegung die Oberflächen trennt.",correct:false},
      {key:"D",text:"Trockenreibung, weil im Stillstand grundsätzlich kein Schmierstoff im Lager bleibt.",correct:false}
    ], explanation:"Bei 60 U/min entsteht noch kein tragender Schmierfilm; daher liegt Mischreibung vor." };
  started=Date.now(); rejected=false;
  try { await reviewQuestionGrounding(provider,underdetermined,[sources,"Ein hydrodynamischer Schmierfilm entsteht durch Relativbewegung im keilförmigen Spalt. Beim Anfahren kann Mischreibung auftreten."],Date.now()+40000); }
  catch(error) {
    if(error.code==="factual-review" && /Fachprüfung 2\.0:/.test(error.message)) rejected=true;
    else throw error;
  }
  if(!rejected)throw new Error("underdetermined-bearing-regime-approved");
  report.cases.push({name:"underdetermined-bearing-regime",status:"pass",elapsedMs:Date.now()-started});
  const absurd = structuredClone(valid);
  absurd[0].answers[1].text="Die Feder bestellt selbstständig Kaffee im Internet.";
  started=Date.now(); rejected=false;
  try { await reviewQuestionGrounding(provider,absurd,sources,Date.now()+40000); }
  catch(error) {
    if(/^Fachprüfung 4\.0:/.test(error.message)&&!/Beleg fehlt/.test(error.message))rejected=true;
    else throw error;
  }
  if(!rejected)throw new Error("absurd-distractor-approved");
  report.cases.push({name:"factually-false-but-useless-distractor",status:"pass",elapsedMs:Date.now()-started});
  // Reproduce the student-ticker authoring path, not merely its independent
  // reviewer. This public demo fixture contains no user or production data.
  const { demoLecture } = await import("@/lib/demo-data");
  const { generateStudentExamDraft, liveQuestionSlideContext } = await import("@/server/question-generation");
  const { STUDENT_DRAFT_GENERATION_BUDGET_MS } = await import("@/server/student-draft-limits");
  const lecture = { ...demoLecture, title: "Synthetic student ticker acceptance", questions: [], transcriptSegments: [] };
  const slide = liveQuestionSlideContext(lecture, lecture.slides[0].id);
  started=Date.now();
  const draft = await generateStudentExamDraft({lecture, slide, slideId:lecture.slides[0].id,
    sourceQuestionId:"synthetic-friction", studentQuestion:"Warum ist die Reibung beim Anfahren höher, obwohl sich die Welle langsamer dreht?",
    transcriptContext:"", latestTranscript:"", scriptContext:"", deadlineAt:Date.now()+STUDENT_DRAFT_GENERATION_BUDGET_MS}, provider);
  if(!draft.supported || draft.variants.length!==4)throw new Error("supported-student-fixture-rejected");
  report.cases.push({name:"student-friction-draft-four-by-four",status:"pass",elapsedMs:Date.now()-started});
  report.status="pass";
} catch(error) {
  report.status="fail";
  report.reason=["unsupported-numeric-claim-approved","underdetermined-bearing-regime-approved","absurd-distractor-approved","supported-student-fixture-rejected"].includes(error.message)?error.message:"review-failed-before-required-verdict";
  report.failureClass = /^Fachprüfung(?: |:)/.test(error.message) ? "source-review" : error.name;
  if(error.diagnostic) {
    report.diagnostic=error.diagnostic;
    // This probe only sends the hard-coded synthetic cases above. Never do
    // this in runtime request handlers (they log fixed diagnostic codes only).
    report.syntheticValidationReason=String(error.cause?.message??"").slice(0,500);
  }
  process.exitCode=1;
}
globalThis.fetch=originalFetch;
console.log(JSON.stringify(report,null,2));
