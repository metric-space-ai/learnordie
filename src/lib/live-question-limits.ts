// Creation is asynchronous; the separate student answer clock starts only
// after a reviewed family is published. Reserve time for author → review →
// one correction → review, not just a single provider response.
export const LIVE_QUESTION_GENERATION_BUDGET_MS = 120_000;
export const LIVE_QUESTION_REQUEST_TIMEOUT_MS = 130_000;
