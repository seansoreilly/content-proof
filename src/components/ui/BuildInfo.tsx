import { getBuildInfo, formatBuildTime } from "@/lib/build-info";

interface BuildInfoProps {
  variant?: "minimal" | "detailed";
  className?: string;
}

export function BuildInfo({
  variant = "minimal",
  className = "",
}: BuildInfoProps) {
  const buildInfo = getBuildInfo();

  if (variant === "minimal") {
    return (
      <div className={`text-xs text-mute ${className}`}>
        <span className="font-mono">v{buildInfo.commitHash}</span>
      </div>
    );
  }

  return (
    <div className={`text-xs text-mute space-y-1 ${className}`}>
      <div className="font-mono">
        <span className="font-semibold">Build:</span>{" "}
        <span className="text-ink">{buildInfo.commitHash}</span>
      </div>
      <div>
        <span className="font-semibold">Built:</span>{" "}
        <span className="text-ink">
          {formatBuildTime(buildInfo.buildTime)}
        </span>
      </div>
      <div>
        <span className="font-semibold">Env:</span>{" "}
        <span className="text-ink">{buildInfo.environment}</span>
      </div>
    </div>
  );
}

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
