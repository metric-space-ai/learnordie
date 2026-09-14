// Loaded only by the isolated E2E server through NODE_OPTIONS. Production
// provider allowlists remain intact; no fixture bypass enters application code.
import { fixtureTransportUrl } from "./e2e-provider-fixture.mjs";

const origin = process.env.E2E_PROVIDER_TRANSPORT_ORIGIN;
if (origin) {
  const database = new URL(process.env.DATABASE_URL);
  if (process.env.LEARNBUDDY_DEPLOYMENT_ENV !== "local"
    || !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)
    || !database.pathname.includes("e2e")) throw new Error("Provider fixture requires an isolated local E2E database");
  fixtureTransportUrl("https://llm.learnordie.app/v1/responses", origin);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const target = fixtureTransportUrl(input instanceof Request ? input.url : input, origin);
    return realFetch(target ? (input instanceof Request ? new Request(target, input) : target) : input, init);
  };
}
