# Temporary lecturer test accounts

Students need no accounts: public lecture links open directly. Browser identity
and enrollment are persisted without a mandatory name form; a pseudonym can be
chosen later. Separate browser contexts represent separate students.

Lecturer QA accounts are explicitly provisioned, isolated lecturer identities.
There is no default password, demo authentication bypass, or alternative login
for ordinary lecturer addresses. The feature is disabled by default.

1. Run `node scripts/create-test-account.mjs /absolute/private/directory`.
   The two output files are private (0600); keep them outside Git and public artifacts.
2. Set the deployment environment variable `LEARNBUDDY_TEST_ACCOUNTS` to the
   contents of `test-accounts.env-value.json` using the hosting provider's secret
   input mechanism. Deploy the application to activate it.
3. Open `/lecturer/login`, expand **Mit Testkonto anmelden**, and use the private
   credentials. Create QA-owned lectures; never reuse real teaching data.
4. Remove the configuration and redeploy to revoke all test sessions immediately,
   or let the configured expiry pass. Sessions last at most eight hours and never
   beyond the account expiry. Password/configuration changes invalidate old sessions.

Configuration is a JSON array of at most ten `{ email, passwordHash, expiresAt }`
objects. Addresses must end in `@learnordie.test`. Hashes use scrypt with random
salts. Production requires PostgreSQL-backed rate limiting; concurrent attempts
are serialized. The existing mail/code login remains available independently.

The E2E runner configures separate synthetic accounts only in its isolated,
resettable test environment. Those known fixture passwords are not deployable
production defaults.
