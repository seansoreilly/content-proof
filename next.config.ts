import type { NextConfig } from "next";
import { execSync } from "child_process";

/**
 * Resolve the short commit hash for the build. Prefers the hash the hosting or
 * CI environment reports, falling back to the local git checkout.
 */
function getGitCommitHash(): string {
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA;
  if (fromEnv) return fromEnv.substring(0, 7);

  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("Could not get git commit hash:", errorMessage);
    return "unknown";
  }
}

const commitHash = getGitCommitHash();

const nextConfig: NextConfig = {
  // Build metadata inlined into every bundle. Using `env` rather than a webpack
  // DefinePlugin keeps this working under both webpack and Turbopack.
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: commitHash,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_VERSION: `${commitHash}-${Date.now()}`,
  },
};

export default nextConfig;
