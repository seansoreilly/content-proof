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
  return {
    commitHash: __COMMIT_HASH__ || "unknown",
    buildTime: __BUILD_TIME__ || "unknown",
    buildVersion: __BUILD_VERSION__ || "unknown",
    environment: __NODE_ENV__ || "development",
    isProduction: __NODE_ENV__ === "production",
    isDevelopment: __NODE_ENV__ === "development",
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