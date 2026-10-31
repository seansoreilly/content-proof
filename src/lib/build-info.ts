export interface BuildInfo {
  commitHash: string;
  buildTime: string;
  buildVersion: string;
  environment: string;
  isProduction: boolean;
  isDevelopment: boolean;
}

/**
 * Get build information inlined at build time via the `env` key in
 * `next.config.ts`. Each value is read with a literal `process.env.X` access
 * so the bundler can substitute it.
 */
export function getBuildInfo(): BuildInfo {
  const commitHash = process.env.NEXT_PUBLIC_BUILD_COMMIT || "unknown";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || "unknown";
  const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || "unknown";
  const environment = process.env.NODE_ENV || "development";

  return {
    commitHash,
    buildTime,
    buildVersion,
    environment,
    isProduction: environment === "production",
    isDevelopment: environment === "development",
  };
}
