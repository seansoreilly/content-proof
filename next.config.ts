import type { NextConfig } from "next";
import { execSync } from "child_process";

function getBuildInfo() {
  // Multi-environment git commit hash resolution
  function getGitCommitHash() {
    // Priority 1: Vercel deployment environment
    if (process.env.VERCEL_GIT_COMMIT_SHA) {
      const shortHash = process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
      console.log("Using Vercel commit hash:", shortHash);
      return shortHash;
    }

    // Priority 2: GitHub Actions environment
    if (process.env.GITHUB_SHA) {
      const shortHash = process.env.GITHUB_SHA.substring(0, 7);
      console.log("Using GitHub Actions commit hash:", shortHash);
      return shortHash;
    }

    // Priority 3: Generic CI environment variables
    if (process.env.CI_COMMIT_SHA) {
      const shortHash = process.env.CI_COMMIT_SHA.substring(0, 7);
      console.log("Using CI commit hash:", shortHash);
      return shortHash;
    }

    // Priority 4: Local development fallback
    try {
      const hash = execSync("git rev-parse --short HEAD", {
        encoding: "utf8",
      }).trim();
      console.log("Using local git commit hash:", hash);
      return hash;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn("Could not get git commit hash:", errorMessage);
      return "unknown";
    }
  }

  const commitHash = getGitCommitHash();
  const buildTime = new Date().toISOString();
  const buildVersion = `${commitHash}-${Date.now()}`;

  return {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __BUILD_VERSION__: JSON.stringify(buildVersion),
    __NODE_ENV__: JSON.stringify(process.env.NODE_ENV || "development"),
  };
}

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Define build info constants for webpack
    const webpack = require('webpack');
    config.plugins.push(
      new webpack.DefinePlugin(getBuildInfo())
    );
    return config;
  },
};

export default nextConfig;
