#!/usr/bin/env node
// Known synthetic cases only. No database writes and no credential output.
if (!process.argv.includes("--run") || process.env.VERCEL_ENV !== "production") {
  console.error("Run explicitly with --run inside Vercel production; not a browser acceptance test.");
  process.exit(1);
}
const { getAIProvider } = await import("@/server/providers/ai");
const { reviewQuestionGrounding } = await import("@/server/question-grounding-review");
const provider = getAIProvider();
if (provider.info.model.toLowerCase() !== "minimax-m3") throw new Error("MiniMax M3 required");
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
  "Ein ungedämpftes Feder-Masse-System soll bei gleicher Masse eine kürzere Schwingungsdauer erhalten. Welche Änderung erreicht das?"
];
const choices = [
  ["Die Masse hängt tiefer und schwingt langsamer.", "Die Masse hängt höher und schwingt schneller.", "Die Masse hängt tiefer und schwingt schneller.", "Die Masse hängt höher und schwingt langsamer."],
  ["Die Eigenkreisfrequenz sinkt mit der Wurzel der Steifigkeit.", "Die weichere Feder vergrößert die Masse.", "Die Gewichtskraft verschwindet.", "Die Eigenkreisfrequenz steigt mit kleinerer Steifigkeit."],
  ["Sie halbiert sich.", "Sie verdoppelt sich.", "Sie bleibt gleich.", "Sie vervierfacht sich."],
  ["Die Steifigkeit erhöhen.", "Die Steifigkeit verringern.", "Nur die Anfangsphase ändern.", "Nur später mit der Messung beginnen."]
];
const valid = levels.map((level,i)=>({ level, text:stems[i], answers:choices[i].map((text,j)=>({key:"ABCD"[j],text,correct:j===0})), explanation:"Es gilt omega = sqrt(k/m); die statische Auslenkung ist m*g/k." }));
const invalid = structuredClone(valid);
invalid[2] = { ...invalid[2], text:"Ein Gleitlager hat eine Sommerfeldzahl von 0,9. Welche Aussage über die Schmierung ist richtig?", answers:[
  {key:"A",text:"Der Schmierfilm ist ausreichend, aber die Sicherheit gegen Trockenlauf gering.",correct:true},
  {key:"B",text:"Ohne ein gültiges Grenzwertmodell ist diese Beurteilung nicht möglich.",correct:false},
  {key:"C",text:"Der Schmierfilm bricht sofort zusammen.",correct:false},
  {key:"D",text:"Es liegt ausschließlich hydrostatische Schmierung vor.",correct:false}
], explanation:"Bei 0,9 ist die Schmierung noch ausreichend." };
const report = {model:provider.info.model,databaseWrites:false,browserTested:false,cases:[]};
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
  report.status="pass";
} catch(error) {
  report.status="fail";
  report.reason=error.message==="unsupported-numeric-claim-approved"?error.message:"review-failed-before-required-verdict";
  process.exitCode=1;
}
globalThis.fetch=originalFetch;
console.log(JSON.stringify(report,null,2));
