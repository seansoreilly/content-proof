import type { ElementType, ReactElement, ReactNode } from "react";

export interface PanelProps {
  className?: string;
  children: ReactNode;
  as?: ElementType;
}

export function Panel({
  className = "",
  children,
  as: Component = "div",
}: PanelProps): ReactElement {
  return (
    <Component className={`bg-paper shadow-panel p-[18px] sm:p-6 ${className}`}>
      {children}
    </Component>
  );
}
