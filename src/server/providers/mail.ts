import { Resend } from "resend";

import { assertDeploymentFetchEndpoint, isLocalOrPrivateEndpointHost } from "@/server/providers/endpoint-policy";
import { isProductionDeployment } from "@/server/runtime-config";

export type SendMagicLinkInput = {
  email: string;
  magicLink: string;
};

export type SendMagicLinkResult =
  | { delivery: "local"; magicLink: string }
  | { delivery: "external" };

export interface MailProvider {
  sendMagicLink(input: SendMagicLinkInput): Promise<SendMagicLinkResult>;
}

class ConsoleMailProvider implements MailProvider {
  async sendMagicLink(input: SendMagicLinkInput) {
    console.info(`[mail:dev] Magic link for ${input.email}: ${input.magicLink}`);
    return { delivery: "local" as const, magicLink: input.magicLink };
  }
}

class BlackholeMailProvider implements MailProvider {
  async sendMagicLink(input: SendMagicLinkInput) {
    console.info(`[mail:blackhole] Accepted magic link for ${input.email}. Link intentionally hidden from client.`);
    return { delivery: "external" as const };
  }
}

class ResendMailProvider implements MailProvider {
  private resend: Resend;
  private from: string;

  constructor(apiKey: string, from: string, baseUrl?: string) {
    this.resend = new Resend(apiKey, baseUrl ? { baseUrl } : undefined);
    this.from = from;
  }

  async sendMagicLink(input: SendMagicLinkInput) {
    await this.resend.emails.send({
      from: this.from,
      to: input.email,
      subject: "Dein LearnBuddy Login-Link",
      html: [
        "<p>Hier ist dein Login-Link:</p>",
        `<p><a href="${escapeHtml(input.magicLink)}">${escapeHtml(input.magicLink)}</a></p>`,
        "<p>Der Link ist 15 Minuten gültig.</p>"
      ].join(""),
      text: `Hier ist dein LearnBuddy Login-Link: ${input.magicLink}\n\nDer Link ist 15 Minuten gültig.`
    });
    return { delivery: "external" as const };
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeResendBaseUrl(value?: string) {
  const endpoint = value?.trim().replace(/\/+$/, "");
  if (!endpoint) return undefined;

  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Resend base URL must be HTTP(S).");
  }

  const normalized = parsed.toString().replace(/\/+$/, "");
  assertDeploymentFetchEndpoint(normalized, "LEARNBUDDY_RESEND_BASE_URL/RESEND_BASE_URL");
  return normalized;
}

function senderDomain(value: string) {
  const trimmed = value.trim();
  const bracketedAddress = trimmed.match(/<([^<>]+)>$/)?.[1];
  const address = (bracketedAddress ?? trimmed).trim().replace(/^mailto:/i, "");
  const match = address.match(/^[^\s@<>]+@([A-Za-z0-9.-]+|\[[^\]]+\])$/);
  if (!match) return "";
  return match[1].toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isReservedSenderDomain(domain: string) {
  return (
    domain === "example.com" ||
    domain === "example.net" ||
    domain === "example.org" ||
    domain.endsWith(".example") ||
    domain.endsWith(".test") ||
    domain.endsWith(".invalid")
  );
}

function productionEmailFrom() {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw new Error("EMAIL_FROM is required when using Resend in production.");
  }

  const domain = senderDomain(from);
  if (!domain || isLocalOrPrivateEndpointHost(domain) || isReservedSenderDomain(domain)) {
    throw new Error("EMAIL_FROM must use a verified public sender domain in production.");
  }

  return from;
}

export function getMailProvider(): MailProvider {
  const selectedProvider = process.env.LEARNBUDDY_MAIL_PROVIDER?.trim().toLowerCase();
  const production = isProductionDeployment();

  if (selectedProvider === "console" || selectedProvider === "local") {
    if (production) {
      throw new Error("Console mail provider cannot be used in production.");
    }
    return new ConsoleMailProvider();
  }

  if (selectedProvider === "blackhole" || selectedProvider === "external-test") {
    if (production) {
      throw new Error("Blackhole mail provider cannot be used in production.");
    }
    return new BlackholeMailProvider();
  }

  if (selectedProvider === "resend" && !process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required when LEARNBUDDY_MAIL_PROVIDER=resend.");
  }

  if (process.env.RESEND_API_KEY) {
    const from = production
      ? productionEmailFrom()
      : process.env.EMAIL_FROM?.trim() || "LearnBuddy <noreply@example.com>";

    return new ResendMailProvider(
      process.env.RESEND_API_KEY,
      from,
      normalizeResendBaseUrl(process.env.LEARNBUDDY_RESEND_BASE_URL ?? process.env.RESEND_BASE_URL)
    );
  }
  if (production) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production.");
  }
  return new ConsoleMailProvider();
}
