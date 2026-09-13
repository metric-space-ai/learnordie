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
  const result = await complete(input);
  try {
    const parsed = parseGroundingJson(result.answer);
    reviewVerdicts.push({ reviews: Array.isArray(parsed.reviews) ? parsed.reviews.slice(0, 4).map(entry => ({
      level: String(entry?.level ?? "").slice(0, 8), approved: entry?.approved === true,
      sourceQuote: String(entry?.sourceQuote ?? "").slice(0, 600), reason: String(entry?.reason ?? "").slice(0, 400)
    })) : null });
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
  await reviewQuestionGrounding(provider,valid,sources,Date.now()+14000);
  report.cases.push({name:"grounded-spring-family",status:"pass",elapsedMs:Date.now()-started});
  started=Date.now();let rejected=false;
  try { await reviewQuestionGrounding(provider,invalid,sources,Date.now()+14000); }
  catch(error) {
    // Timeout/malformed/transport errors are not proof of factual rejection.
    if (/^Fachprüfung 2\.0:/.test(error.message) && !/Beleg fehlt/.test(error.message)) rejected=true;
    else throw error;
  }
  if(!rejected)throw new Error("unsupported-numeric-claim-approved");
  report.cases.push({name:"unsupported-Sommerfeld-0.9-claim",status:"pass",elapsedMs:Date.now()-started});
  const absurd = structuredClone(valid);
  absurd[0].answers[1].text="Die Feder bestellt selbstständig Kaffee im Internet.";
  started=Date.now(); rejected=false;
  try { await reviewQuestionGrounding(provider,absurd,sources,Date.now()+14000); }
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
  const lecture = { ...demoLecture, title: "Synthetic student ticker acceptance", questions: [], transcriptSegments: [] };
  const slide = liveQuestionSlideContext(lecture, lecture.slides[0].id);
  started=Date.now();
  const draft = await generateStudentExamDraft({lecture, slide, slideId:lecture.slides[0].id,
    sourceQuestionId:"synthetic-friction", studentQuestion:"Warum ist die Reibung beim Anfahren höher, obwohl sich die Welle langsamer dreht?",
    transcriptContext:"", latestTranscript:"", scriptContext:"", deadlineAt:Date.now()+45000}, provider);
  if(!draft.supported || draft.variants.length!==4)throw new Error("supported-student-fixture-rejected");
  report.cases.push({name:"student-friction-draft-four-by-four",status:"pass",elapsedMs:Date.now()-started});
  report.status="pass";
} catch(error) {
  report.status="fail";
  report.reason=error.message==="unsupported-numeric-claim-approved"?error.message:"review-failed-before-required-verdict";
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
