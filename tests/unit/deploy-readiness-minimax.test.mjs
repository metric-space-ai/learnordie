import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const legacyProviderEnvNames = [
  "LEARNBUDDY_OCR_BASE_URL",
  "LEARNBUDDY_OCR_API_KEY",
  "LEARNBUDDY_STT_BASE_URL",
  "LEARNBUDDY_STT_API_KEY",
  "MISTRAL_API_KEY"
];

function runReadiness({ minimaxKey, mistralKey } = {}) {
  const env = Object.fromEntries([
    "NEXT_PUBLIC_APP_URL",
    "LEARNBUDDY_DEPLOYMENT_ENV",
    "AUTH_SECRET",
    "DATABASE_URL",
    "LEARNBUDDY_MAIL_PROVIDER",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "LEARNBUDDY_JOB_PROVIDER",
    "LEARNBUDDY_WORKER_SECRET",
    "CRON_SECRET",
    "LEARNBUDDY_AI_PROVIDER",
    "LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER",
    "LEARNBUDDY_QUESTION_GENERATOR",
    "LEARNBUDDY_STORAGE_PROVIDER"
  ].map((name) => [name, "contract-test-value"]));
  Object.assign(env, {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "test",
    LEARNBUDDY_DEPLOYMENT_ENV: "production",
    LEARNBUDDY_EMBEDDING_PROVIDER: "disabled",
    LEARNBUDDY_OCR_PROVIDER: "minimax",
    LEARNBUDDY_STT_PROVIDER: "minimax",
    LEARNORDIE_LLM_PROXY_API_KEY: "proxy-contract-test-key",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.example.test",
    ...(minimaxKey ? { LEARNORDIE_MINIMAX_API_KEY: minimaxKey } : {}),
    ...(mistralKey ? { MISTRAL_API_KEY: mistralKey } : {})
  });

  const result = spawnSync(process.execPath, [
    "scripts/deploy-readiness.mjs",
    "--local",
    "--environment",
    "production"
  ], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 15_000
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.ok(result.stdout, result.stderr);
  return {
    env,
    report: JSON.parse(result.stdout)
  };
}

function requiredEnvCheck(report) {
  return report.checks.find((check) => check.id === "required_env");
}

test("MiniMax OCR/STT readiness needs no legacy provider keys or endpoints and permits disabled embeddings", () => {
  const { env, report } = runReadiness({ minimaxKey: "minimax-contract-test-key" });
  const check = requiredEnvCheck(report);

  assert.equal(env.LEARNBUDDY_OCR_PROVIDER, "minimax");
  assert.equal(env.LEARNBUDDY_STT_PROVIDER, "minimax");
  assert.equal(env.LEARNBUDDY_EMBEDDING_PROVIDER, "disabled");
  assert.deepEqual(legacyProviderEnvNames.filter((name) => env[name]), []);
  assert.equal(check?.status, "pass", JSON.stringify(check?.details));
});

test("MiniMax STT readiness does not accept Mistral credentials as a substitute", () => {
  const { report } = runReadiness({ mistralKey: "mistral-contract-test-key" });
  const check = requiredEnvCheck(report);
  const sttGroup = check?.details?.missingGroups?.find((group) => group.id === "stt_provider_key");

  assert.deepEqual(sttGroup?.anyOf, ["LEARNORDIE_MINIMAX_API_KEY", "MINIMAX_API_KEY"]);
});
