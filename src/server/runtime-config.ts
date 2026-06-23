function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function configuredPublicAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured;

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (!vercelUrl) return "";
  return vercelUrl.startsWith("http://") || vercelUrl.startsWith("https://")
    ? vercelUrl
    : `https://${vercelUrl}`;
}

function publicAppUrlIsLoopback() {
  const configured = configuredPublicAppUrl();
  if (!configured) return false;
  try {
    return isLoopbackHost(new URL(configured).hostname);
  } catch {
    return false;
  }
}

export function isProductionDeployment() {
  const deploymentEnv = process.env.LEARNBUDDY_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (deploymentEnv === "production") return true;
  if (deploymentEnv === "local" || deploymentEnv === "development" || deploymentEnv === "test") return false;

  if (process.env.VERCEL_ENV === "production") return true;
  return process.env.NODE_ENV === "production" && !publicAppUrlIsLoopback();
}

export function isPreviewOrProductionDeployment() {
  const deploymentEnv = process.env.LEARNBUDDY_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (deploymentEnv === "preview" || deploymentEnv === "production") return true;
  if (deploymentEnv === "local" || deploymentEnv === "development" || deploymentEnv === "test") return false;

  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === "preview" || vercelEnv === "production") return true;

  return isProductionDeployment();
}

export function shouldUseSecureCookies() {
  const deploymentEnv = process.env.LEARNBUDDY_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (deploymentEnv === "local" || deploymentEnv === "development" || deploymentEnv === "test") return false;

  const production = isProductionDeployment();
  const configured = configuredPublicAppUrl();
  if (configured) {
    try {
      return new URL(configured).protocol === "https:" || production;
    } catch {
      return production;
    }
  }

  return process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview" || production;
}
