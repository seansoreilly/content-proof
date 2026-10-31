import { getBuildInfo } from "@/lib/build-info";

export function DevelopmentBuildInfo() {
  const buildInfo = getBuildInfo();

  // Only show in development
  if (!buildInfo.isDevelopment) {
    return null;
  }

  return (
    <div className="text-center space-y-2">
      <div className="text-center">
        <p className="text-sm text-mute">
          Created by{" "}
          <a
            href="https://balddata.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink underline"
          >
            Bald Data
          </a>{" "}
          • Build:{" "}
          <span className="font-mono text-ink">
            {buildInfo.commitHash || "unknown"}
          </span>
        </p>
      </div>
    </div>
  );
}
