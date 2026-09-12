"use client";

import { useEffect, useState } from "react";
import { seriesIdForLecture } from "@/lib/series";
import { claimSeriesDisplayName, ensureStudentEnrollment, getOrCreateStudentKey } from "@/lib/student-client";
import type { LiveAnswerReceipt } from "@/lib/live-session";
import type { Lecture, QuestionLevel } from "@/lib/types";
import { useLiveSession } from "@/lib/use-live-session";
import { LeaderboardModal } from "./LeaderboardModal";
import { Presence } from "./Presence";
import { LiveQuizDrawer } from "./LiveQuizDrawer";
import { SlideEngineCanvas } from "./SlideEngineCanvas";
import { PseudonymChooser } from "./student/PseudonymChooser";

const followPresenter = () => undefined;

export function StudentLiveExperience({ lecture }: { lecture: Lecture }) {
  const [pseudonym, setPseudonym] = useState("");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatFeedback, setChatFeedback] = useState("");
  const [answeredOnce, setAnsweredOnce] = useState(false);
  const [identitySaved, setIdentitySaved] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityMessage, setIdentityMessage] = useState("");
  const live = useLiveSession(lecture.publicToken, leaderboardOpen);
  const round = live.connected ? live.state?.round : null;
  const enrollment = () => ensureStudentEnrollment({ seriesId: seriesIdForLecture(lecture), seriesTitle: lecture.seriesTitle, lectureId: lecture.id, source: "direct_live_link" });
  useEffect(() => { if (live.state?.receipt) setAnsweredOnce(true); }, [live.state?.receipt]);

  useEffect(() => {
    let stopped = false;
    ensureStudentEnrollment({ seriesId: seriesIdForLecture(lecture), seriesTitle: lecture.seriesTitle, lectureId: lecture.id, source: "direct_live_link" })
      .then(() => fetch(`/api/student/claim?seriesId=${encodeURIComponent(seriesIdForLecture(lecture))}`, { cache: "no-store" }))
      .then((response) => response.json())
      .then((data) => { if (!stopped && data.claim?.displayName) setPseudonym(data.claim.displayName); })
      .catch(() => undefined);
    return () => { stopped = true; };
  }, [lecture.id, lecture.publicToken, lecture.seriesTitle]);

  async function answer(level: QuestionLevel, selected: string): Promise<LiveAnswerReceipt> {
    if (!round || !live.state?.sessionId) throw new Error("Diese Frage ist nicht mehr geöffnet.");
    await enrollment();
    const response = await fetch(`/api/lecture/${lecture.publicToken}/live`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: live.state.sessionId, roundId: round.id, level, selected }), signal: AbortSignal.timeout(6000) });
    const payload = await response.json();
    if (!response.ok) { live.refresh(); throw new Error(payload.error ?? "Antwort nicht gespeichert. Bitte erneut versuchen."); }
    setAnsweredOnce(true);
    live.refresh();
    return payload.receipt as LiveAnswerReceipt;
  }

  async function saveLiveIdentity() {
    if (identitySaving || !pseudonym.trim()) return;
    setIdentitySaving(true);
    setIdentityMessage("");
    try {
      await enrollment();
      const result = await claimSeriesDisplayName(seriesIdForLecture(lecture), pseudonym.trim());
      if (!result.ok) { setIdentityMessage(result.error); return; }
      setPseudonym(result.displayName ?? pseudonym.trim());
      window.localStorage.setItem(`lb_pseudonym_${lecture.publicToken}`, result.displayName ?? pseudonym.trim());
      setIdentitySaved(true);
      live.refresh();
    } catch { setIdentityMessage("Name konnte nicht gespeichert werden. Bitte erneut versuchen."); }
    finally { setIdentitySaving(false); }
  }

  async function submitChatQuestion() {
    if (!chatText.trim() || chatSending) return;
    setChatSending(true);
    setChatFeedback("");
    try {
      await enrollment();
      const response = await fetch(`/api/lecture/${lecture.publicToken}/chat-questions`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: chatText.trim(), pseudonym, anonymousKey: getOrCreateStudentKey() }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Frage konnte nicht gesendet werden.");
      setChatText("");
      setChatFeedback(payload.message ?? "Frage gespeichert.");
    } catch (error) { setChatFeedback(error instanceof Error ? error.message : "Frage konnte nicht gesendet werden."); }
    finally { setChatSending(false); }
  }

  return <main className={`slide-screen learn-shell lb-motion-root ${round ? "question-open" : ""}`} data-live-status={live.state?.status ?? "connecting"}>
    <SlideEngineCanvas lectureToken={lecture.publicToken} lectureTitle={lecture.title} showJoinIntro={live.state?.showIntro ?? true}
      current={Math.min(live.state?.slideIndex ?? 0, Math.max(0, lecture.slides.length - 1))} navigationDisabled
      onNext={followPresenter} onPrevious={followPresenter} slideDocument={lecture.slideDocument} slides={lecture.slides} />
    {(!live.connected || live.state?.status !== "active") && <aside className="student-connection-notice" role="status">
      {!live.connected ? (live.error || "Live-Verbindung wird hergestellt …") : live.state?.status === "ended" ? "Die Live-Sitzung ist beendet." : "Warte auf den Start durch die Lehrperson."}
      {live.state?.status === "ended" && <a href={`/learn/${lecture.publicToken}`}>Jetzt selbstständig lernen</a>}
      {!live.connected && <button type="button" onClick={live.refresh}>Erneut verbinden</button>}
    </aside>}
    <div className="action-stack live-controls lb-enter-control">
      {lecture.leaderboardEnabled && <button className="icon-action action-text" type="button" onClick={() => setLeaderboardOpen(true)}>Rangliste</button>}
      <button className="icon-action action-text" type="button" onClick={() => setChatOpen((current) => !current)}>Frage stellen</button>
    </div>
    <Presence show={chatOpen}>{(motionState) => <aside className="chat-question-panel lb-enter-overlay" data-state={motionState} aria-label="Frage an Dozierende">
      <div><strong>Frage an Dozierende</strong><button className="plain-button" type="button" onClick={() => setChatOpen(false)}>Schließen</button></div>
      <textarea value={chatText} onChange={(event) => setChatText(event.target.value)} aria-label="Deine Frage" rows={3} />
      <button className="primary-button" disabled={chatSending || chatText.trim().length < 4} type="button" onClick={() => void submitChatQuestion()}>{chatSending ? "Sendet …" : "Senden"}</button>
      {chatFeedback && <p role="status">{chatFeedback}</p>}
    </aside>}</Presence>
    {round && <LiveQuizDrawer key={round.id} round={round} serverOffset={live.serverOffset} receipt={live.state?.receipt ?? null} onAnswer={answer} />}
    {!round && (answeredOnce || live.state?.receipt) && <aside className="identity-save-nudge live-identity-nudge lb-enter-panel" aria-label="Pseudonym sichern">
      <strong>{identitySaved ? "Pseudonym gesichert" : "Pseudonym später wählen?"}</strong>
      {identitySaved ? <a className="plain-button small" href="/student">Meine Vorlesungen</a> : <>
        <PseudonymChooser value={pseudonym} onChange={setPseudonym} seriesId={seriesIdForLecture(lecture)} disabled={identitySaving} label="Eigenes Pseudonym" />
        <button className="plain-button small" type="button" onClick={() => void saveLiveIdentity()} disabled={identitySaving}>{identitySaving ? "Sichert …" : "Sichern"}</button>
        {identityMessage && <p role="status">{identityMessage}</p>}
      </>}
    </aside>}
    <Presence show={lecture.leaderboardEnabled && leaderboardOpen}>{(motionState) => <LeaderboardModal entries={live.state?.leaderboard ?? []} loading={!live.connected || !live.state?.leaderboard} motionState={motionState} onClose={() => setLeaderboardOpen(false)} />}</Presence>
  </main>;
}
