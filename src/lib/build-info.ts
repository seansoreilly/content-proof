export interface BuildInfo {
  commitHash: string;
  buildTime: string;
  buildVersion: string;
  environment: string;
  isProduction: boolean;
  isDevelopment: boolean;
}

/**
 * Get build information injected at build time
 */
export function getBuildInfo(): BuildInfo {
  // Safe access to potentially undefined globals (especially in Turbopack/dev mode)
  const commitHash =
    (typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : null) ||
    "unknown";
  const buildTime =
    (typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : null) ||
    "unknown";
  const buildVersion =
    (typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : null) ||
    "unknown";
  const environment =
    (typeof __NODE_ENV__ !== "undefined" ? __NODE_ENV__ : null) ||
    process.env.NODE_ENV ||
    "development";

  return {
    commitHash,
    buildTime,
    buildVersion,
    environment,
    isProduction: environment === "production",
    isDevelopment: environment === "development",
  };
}

/**
 * Format build time for display
 */
export function formatBuildTime(buildTime: string): string {
  if (buildTime === "unknown") return "Unknown";

  try {
    const date = new Date(buildTime);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return buildTime;
  }
}

/**
 * Get short display version (commit hash only)
 */
export function getShortVersion(): string {
  const { commitHash } = getBuildInfo();
  return commitHash === "unknown" ? "dev" : commitHash;
}
