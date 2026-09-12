import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { afterEach, test } from "node:test";
import { configuredTestAccounts, testAccountVersion, verifyTestAccountPassword } from "@/server/test-accounts";

const initial = process.env.LEARNBUDDY_TEST_ACCOUNTS;
afterEach(() => {
  if (initial === undefined) delete process.env.LEARNBUDDY_TEST_ACCOUNTS;
  else process.env.LEARNBUDDY_TEST_ACCOUNTS = initial;
});
const password = "unit-only-strong-test-password";
const salt = "ac653340012aacdef819491329009faa";
const account = {
  email: "unit@learnordie.test",
  passwordHash: `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`,
  expiresAt: new Date(Date.now() + 3600000).toISOString()
};

test("test accounts fail closed when absent, malformed or oversized", () => {
  delete process.env.LEARNBUDDY_TEST_ACCOUNTS;
  assert.deepEqual(configuredTestAccounts(), []);
  for (const value of ["invalid-json", "{}", "null", JSON.stringify(Array(11).fill(account))]) {
    process.env.LEARNBUDDY_TEST_ACCOUNTS = value;
    assert.deepEqual(configuredTestAccounts(), []);
  }
});

test("test accounts reject real lecturer addresses, invalid hashes and expired config", () => {
  process.env.LEARNBUDDY_TEST_ACCOUNTS = JSON.stringify([
    { ...account, email: "lecturer@example.edu" },
    { ...account, passwordHash: password },
    { ...account, expiresAt: "2000-01-01T00:00:00Z" },
    { ...account, expiresAt: "not-a-date" }, null, 4, "test"
  ]);
  assert.deepEqual(configuredTestAccounts(), []);
});

test("only explicitly configured scrypt passwords authenticate", async () => {
  process.env.LEARNBUDDY_TEST_ACCOUNTS = JSON.stringify([account]);
  const [configured] = configuredTestAccounts();
  assert.equal(await verifyTestAccountPassword(configured, password), true);
  assert.equal(await verifyTestAccountPassword(configured, `${password}!`), false);
  assert.equal(await verifyTestAccountPassword(configured, "short"), false);
  assert.equal(await verifyTestAccountPassword(undefined, password), false);
});

test("changing a test account's credentials or expiry invalidates its session version", () => {
  assert.equal(testAccountVersion(account), testAccountVersion({ ...account }));
  assert.notEqual(testAccountVersion(account), testAccountVersion({ ...account, passwordHash: `${account.passwordHash}0` }));
  assert.notEqual(testAccountVersion(account), testAccountVersion({ ...account, expiresAt: "2030-01-01T00:00:00Z" }));
});
