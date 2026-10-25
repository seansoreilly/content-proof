import type { ReactElement, ReactNode } from "react";
import { SealMark, type SealTone } from "./SealMark";

export interface VerifyResultProps {
  tone: SealTone;
  title: string;
  children: ReactNode;
  className?: string;
}

const TITLE_COLOR: Record<SealTone, string> = {
  pending: "text-mute",
  sealed: "text-accent",
  void: "text-void",
};

export function VerifyResult({
  tone,
  title,
  children,
  className = "",
}: VerifyResultProps): ReactElement {
  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2 ${className}`}
    >
      <p className={`eyebrow ${TITLE_COLOR[tone]}`}>{title}</p>
      <div className="col-start-2 row-span-2 row-start-1">
        <SealMark tone={tone} size={52} />
      </div>
      <div className="col-start-1">{children}</div>
    </div>
  );
}
