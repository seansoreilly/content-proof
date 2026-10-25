import type { ReactElement, ReactNode } from "react";

// Deprecated stub: use a plain h1 in the Seal theme. Remove once the pages
// that still import it are migrated.
interface GradientHeadingProps {
  children: ReactNode;
  className?: string;
}

export default function GradientHeading({
  children,
  className = "",
}: GradientHeadingProps): ReactElement {
  return <h1 className={`font-display ${className}`}>{children}</h1>;
}
