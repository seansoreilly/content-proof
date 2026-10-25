import type { ReactElement, ReactNode } from "react";

export interface EyebrowProps {
  className?: string;
  children: ReactNode;
}

export function Eyebrow({ className = "", children }: EyebrowProps): ReactElement {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}
