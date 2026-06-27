#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const HELP_TEXT = `
Usage: npm run motion:contract

Checks the LearnBuddy motion/design contract across CSS and core UI components.

Options:
  --help, -h                        Print this usage text without running checks.
`;

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

if (helpRequested()) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

const checks = [];

function record(id, status, message, details = {}) {
  checks.push({ id, status, message, details });
}

function pass(id, message, details) {
  record(id, "pass", message, details);
}

function fail(id, message, details) {
  record(id, "fail", message, details);
}

async function readText(file) {
  return readFile(file, "utf8");
}

function expectContains(id, content, expected, file) {
  const missing = expected.filter((item) => !content.includes(item));
  if (missing.length === 0) {
    pass(id, `${file} contains the required motion-design contract markers.`, { file, count: expected.length });
    return;
  }
  fail(id, `${file} is missing required motion-design contract markers.`, { file, missing });
}

function expectNotContains(id, content, forbidden, file) {
  const found = forbidden.filter((item) => content.includes(item));
  if (found.length === 0) {
    pass(id, `${file} avoids forbidden generic motion-design markers.`, { file, count: forbidden.length });
    return;
  }
  fail(id, `${file} contains forbidden generic motion-design markers.`, { file, found });
}

function expectRegex(id, content, expected, file) {
  const missing = expected
    .filter(({ pattern }) => !pattern.test(content))
    .map(({ label }) => label);
  if (missing.length === 0) {
    pass(id, `${file} contains the required motion-design structural patterns.`, { file, count: expected.length });
    return;
  }
  fail(id, `${file} is missing required motion-design structural patterns.`, { file, missing });
}

const [
  globals,
  design,
  presence,
  quizDrawer,
  learnExperience,
  studentLiveExperience,
  lecturerLiveExperience,
  lecturerDashboard,
  slideCanvas,
  leaderboardModal,
  homePage,
  homeLanding,
  motionUtils
] = await Promise.all([
  readText("src/app/globals.css"),
  readText("DESIGN.md"),
  readText("src/components/Presence.tsx"),
  readText("src/components/QuizDrawer.tsx"),
  readText("src/components/LearnExperience.tsx"),
  readText("src/components/StudentLiveExperience.tsx"),
  readText("src/components/LecturerLiveExperience.tsx"),
  readText("src/components/LecturerDashboard.tsx"),
  readText("src/components/SlideCanvas.tsx"),
  readText("src/components/LeaderboardModal.tsx"),
  readText("src/app/page.tsx"),
  readText("src/components/HomeLanding.tsx"),
  readText("src/lib/motion.ts")
]);

expectContains("design_context", design, [
  "Folie ist der Anker",
  "Bottom-Bar",
  "Hotspots",
  "Sheets",
  "lb-enter-stage",
  "lb-enter-sheet",
  "lb-enter-overlay",
  "Motion Acceptance",
  "Keine Food-App-Optik",
  "Keine Hotspots, die dauerhaft pulsieren",
  "Playwright-Screenshots",
  "Startseite baut Card und Links gestaffelt auf",
  "Frage-Drawer oeffnet nicht hart",
  "Referentenstudio oeffnet Tools aus der unteren Steuerung",
  "prefers-reduced-motion"
], "DESIGN.md");

expectContains("motion_tokens", globals, [
  "--lb-ease-out",
  "--lb-ease-mask",
  "--lb-ease-standard",
  "--lb-ease-in",
  "--lb-dur-press",
  "--lb-dur-fade",
  "--lb-dur-control",
  "--lb-dur-row",
  "--lb-dur-panel",
  "--lb-dur-mask",
  "--lb-dur-route",
  "--lb-dur-shared",
  "--lb-stagger-tight",
  "--lb-stagger-row",
  "--lb-stagger-panel",
  "--lb-radius-control",
  "--lb-radius-control-lg",
  "--lb-radius-panel",
  "--lb-radius-panel-lg",
  "--lb-radius-sheet",
  "--lb-radius-stage",
  "--lb-radius-cover",
  "--lb-radius-pill"
], "src/app/globals.css");

expectRegex("motion_token_values", globals, [
  { label: "ease_out_exact", pattern: /--lb-ease-out:\s*cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\);/ },
  { label: "ease_mask_exact", pattern: /--lb-ease-mask:\s*cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\);/ },
  { label: "press_duration_exact", pattern: /--lb-dur-press:\s*120ms;/ },
  { label: "control_duration_exact", pattern: /--lb-dur-control:\s*220ms;/ },
  { label: "row_duration_exact", pattern: /--lb-dur-row:\s*260ms;/ },
  { label: "panel_duration_exact", pattern: /--lb-dur-panel:\s*420ms;/ },
  { label: "mask_duration_exact", pattern: /--lb-dur-mask:\s*560ms;/ },
  { label: "route_duration_exact", pattern: /--lb-dur-route:\s*720ms;/ },
  { label: "shared_duration_exact", pattern: /--lb-dur-shared:\s*620ms;/ },
  { label: "stagger_row_exact", pattern: /--lb-stagger-row:\s*52ms;/ },
  { label: "control_radius_exact", pattern: /--lb-radius-control:\s*8px;/ },
  { label: "panel_radius_exact", pattern: /--lb-radius-panel:\s*12px;/ },
  { label: "sheet_radius_exact", pattern: /--lb-radius-sheet:\s*18px;/ },
  { label: "cover_radius_exact", pattern: /--lb-radius-cover:\s*22px;/ }
], "src/app/globals.css");

expectContains("motion_classes", globals, [
  ".lb-motion-root",
  ".lb-enter-stage",
  ".lb-enter-sheet",
  ".lb-enter-panel",
  ".lb-enter-row",
  ".lb-enter-control",
  ".lb-enter-hotspot",
  ".lb-enter-overlay",
  ".lb-enter-shared",
  ".studio-slide-shared-ghost",
  ".learn-hotspot-shared-ghost",
  ".studio-tool-shared-ghost",
  ".studio-insight-shared-ghost",
  ".home-route-cover",
  ".lb-cover"
], "src/app/globals.css");

expectContains("motion_keyframes", globals, [
  "@keyframes lb-stage-in",
  "@keyframes lb-card-arrive",
  "@keyframes lb-drawer-rise",
  "@keyframes lb-drawer-drop",
  "@keyframes lb-inspector-right-in",
  "@keyframes lb-tool-sheet-in",
  "@keyframes lb-popover-to-control",
  "@keyframes lb-hotspot-in",
  "@keyframes lb-origin-trace-in",
  "@keyframes lb-origin-socket-in",
  "@keyframes lb-rail-sweep",
  "@keyframes lb-route-cover-in",
  "@keyframes lb-student-gate-cover-in",
  "@keyframes lb-answer-correct",
  "@media (prefers-reduced-motion: reduce)"
], "src/app/globals.css");

expectRegex("motion_performance_rules", globals, [
  { label: "row_animation_uses_transform", pattern: /@keyframes lb-row-in\s*{[\s\S]*transform:/ },
  { label: "drawer_exit_is_shorter_than_enter", pattern: /question-drawer\[data-state="exiting"\]\s*{[\s\S]*280ms/ },
  { label: "overlay_exit_is_shorter_than_enter", pattern: /overlay-panel\[data-state="exiting"\][\s\S]*280ms/ },
  { label: "tool_popover_exit_is_shorter_than_enter", pattern: /studio-tool-popover\[data-state="exiting"\]\s*{[\s\S]*200ms/ },
  { label: "reduced_motion_resets_delay", pattern: /prefers-reduced-motion: reduce[\s\S]*animation-delay:\s*0ms !important/ },
  { label: "question_origin_marker", pattern: /question-drawer::before[\s\S]*var\(--origin-x/ }
], "src/app/globals.css");

expectContains("spatial_fingerprint_contract", globals, [
  "--lb-register",
  "--lb-stage-grid",
  ".slide::before",
  ".studio-slide-stage::after",
  ".studio-filmstrip-rail::before",
  ".studio-bottom-bar::before",
  ".learn-bar::before",
  ".student-gate-cover",
  ".student-gate-screen[data-joining=\"true\"]",
  ".question-origin-trace",
  ".slide-screen.inspector-open .question-drawer",
  "data-panel-origin=\"chat\"",
  "data-panel-origin=\"evaluation\"",
  "data-panel-origin=\"leaderboard\"",
  "data-panel-origin=\"transcript\"",
  "data-panel-origin=\"chat-question\""
], "src/app/globals.css");

expectRegex("studio_origin_contract", globals, [
  { label: "studio_tool_popover_has_origin_marker", pattern: /\.studio-tool-popover::before\s*{[\s\S]*bottom:\s*-7px[\s\S]*animation:\s*lb-origin-line/ }
], "src/app/globals.css");

// parallel-product-plan §4.1: the root is the real app landing (join-by-code,
// "Meine Vorlesungen", lecturer login) — it must NOT redirect away or show a demo.
expectContains("home_app_landing_contract", homePage, [
  "HomeLanding"
], "src/app/page.tsx");

expectNotContains("home_not_demo_launch_contract", homePage, [
  "LaunchExperience",
  "demoLecture",
  "mode-card",
  "mode-screen",
  "mode-list"
], "src/app/page.tsx");

expectContains("home_route_cover_contract", homeLanding, [
  "data-route-cover={routeCover ? \"active\" : \"idle\"}",
  "home-route-cover lb-route-cover",
  "navigateWithCover",
  "followWithCover",
  "prefersReducedMotion()",
  "setRouteCover(target)",
  "router.push(href)"
], "src/components/HomeLanding.tsx");

expectContains("presence_contract", presence, [
  "export type PresenceState = \"entering\" | \"open\" | \"exiting\"",
  "exitMs = 280",
  "setState(\"exiting\")",
  "setPresent(false)"
], "src/components/Presence.tsx");

expectContains("quiz_drawer_contract", quizDrawer, [
  "motionState?: PresenceState",
  "data-state={motionState}",
  "data-origin={origin}",
  "data-answer-state={revealed ? \"answered\" : \"open\"}",
  "\"--lb-i\"",
  "onExpired?.()"
], "src/components/QuizDrawer.tsx");

expectContains("learn_mode_contract", learnExperience, [
  "animateHotspotToDrawerSharedElement",
  "hotspotButtonRefs",
  "pendingHotspotSharedRef",
  "className={`slide-screen lb-motion-root",
  "data-question-origin={questionOrigin}",
  "\"--origin-x\"",
  "inspectorOpen",
  "question-origin-trace",
  "hotspot lb-enter-hotspot",
  "learn-bar lb-enter-control",
  "action-stack lb-enter-control",
  "question-ai-link",
  "<Presence show={questionOpen}>",
  "<Presence show={lecture.leaderboardEnabled && leaderboardOpen}>",
  "<Presence show={chatOpen}>",
  "<Presence show={evaluationOpen && evaluationConfig.enabled}>",
  "data-panel-origin=\"chat\"",
  "data-panel-origin=\"evaluation\""
], "src/components/LearnExperience.tsx");

expectContains("student_live_contract", studentLiveExperience, [
  "className={`slide-screen lb-motion-root",
  "prefersReducedMotion()",
  "joining",
  "student-gate-cover",
  "data-joining={joining ? \"true\" : \"false\"}",
  "chat-question-panel lb-enter-overlay",
  "data-panel-origin=\"chat-question\"",
  "<Presence show={questionOpen}>",
  "<Presence show={lecture.leaderboardEnabled && leaderboardOpen}>"
], "src/components/StudentLiveExperience.tsx");

expectContains("lecturer_live_contract", lecturerLiveExperience, [
  "className={`slide-screen lb-motion-root",
  "transcript-panel lb-enter-overlay",
  "data-panel-origin=\"transcript\"",
  "question-drawer compact lb-enter-sheet",
  "<Presence show={transcriptVisible}>",
  "<Presence show={questionOpen}>"
], "src/components/LecturerLiveExperience.tsx");

expectContains("studio_contract", lecturerDashboard, [
  "animateStudioToolSharedElement",
  "animateStudioInsightSharedElement",
  "pendingStudioToolMotionRef",
  "animateStudioSlideSharedElement",
  "filmstripButtonRefs",
  "moveToStudioSlide",
  "studio-tool-popover lb-enter-panel",
  "studio-tool-trigger",
  "data-open={toolMenuOpen ? \"true\" : \"false\"}",
  "<Presence show={toolMenuOpen} exitMs={200}>",
  "data-state={motionState}",
  "studio-bottom-bar lb-enter-control",
  "studio-hotspot lb-enter-hotspot",
  "style={{ \"--lb-i\": index } as MotionStyle}",
  "studio-context-drawer materials",
  "studio-context-drawer questions",
  "studio-context-drawer evaluation",
  "studio-context-drawer analytics",
  "studio-context-drawer assistant",
  "data-panel-origin=\"studio-sources\"",
  "data-panel-origin=\"studio-analytics\"",
  "studio-slide-tool-overlay",
  "studio-slide-source-overlay",
  "studio-slide-assistant-overlay",
  "data-slide-id={slide.id}",
  "data-slide-id={studioSlide.id}",
  "<Presence show={workspaceTool === \"materials\"}>",
  "<Presence show={workspaceTool === \"assistant\"}>",
  "<Presence show={workspaceTool === \"questions\"}>",
  "<Presence show={workspaceTool === \"evaluation\"}>",
  "<Presence show={workspaceTool === \"analytics\"}>"
], "src/components/LecturerDashboard.tsx");

expectContains("slide_transition_contract", slideCanvas, [
  "data-direction={direction}",
  "setDirection(current === nextIndex ? \"next\" : \"previous\")",
  "slide lb-enter-stage",
  "slide-meta lb-enter-row",
  "diagram lb-enter-panel",
  "slide-nav lb-enter-control"
], "src/components/SlideCanvas.tsx");

expectContains("leaderboard_overlay_contract", leaderboardModal, [
  "motionState?: PresenceState",
  "overlay-panel lb-enter-overlay",
  "data-panel-origin=\"leaderboard\"",
  "data-state={motionState}",
  "leader-row lb-enter-row"
], "src/components/LeaderboardModal.tsx");

expectContains("shared_element_motion_contract", motionUtils, [
  "export function animateFlip",
  "export function animateHotspotToDrawerSharedElement",
  "export function animateStudioToolSharedElement",
  "export function animateStudioInsightSharedElement",
  "export function animateStudioSlideSharedElement",
  "prefersReducedMotion()",
  "getBoundingClientRect",
  "learn-hotspot-shared-ghost",
  "studio-tool-shared-ghost",
  "studio-insight-shared-ghost",
  "sharedElement: \"learn-hotspot\"",
  "sharedElement: tool === \"materials\" ? \"studio-sources\" : \"studio-analytics\"",
  "studio-slide-shared-ghost lb-enter-shared",
  "ghost.dataset.sharedElement = \"studio-slide\"",
  "document.body.append(ghost)",
  "window.setTimeout(() => ghost.remove(), 80)"
], "src/lib/motion.ts");

const summary = {
  total: checks.length,
  passed: checks.filter((check) => check.status === "pass").length,
  failed: checks.filter((check) => check.status === "fail").length
};
const ok = summary.failed === 0;

console.log(JSON.stringify({
  ok,
  command: "motion-design-contract",
  checks,
  summary
}, null, 2));

process.exit(ok ? 0 : 1);
