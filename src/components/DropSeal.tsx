import { useId } from "react";
import { rimFontSizeFraction, SEAL_GEOMETRY } from "@/lib/seal-image";
import styles from "./DropSeal.module.css";

export type DropSealState = "idle" | "over" | "busy";

export interface DropSealProps {
  state: DropSealState;
  rimText: string;
  size?: number;
}

/**
 * The blank seal shown in the drop zone: the same geometry as `Seal`, but the
 * rings are dashed and uninked until a file is over it. Decorative; the drop
 * zone carries the accessible label.
 */
export function DropSeal({ state, rimText, size = 132 }: DropSealProps): React.JSX.Element {
  const pathId = useId();
  const g = SEAL_GEOMETRY;
  const textR = g.textRadius * 100;
  const path = `M 50 ${50 - textR} A ${textR} ${textR} 0 1 1 50 ${50 + textR} A ${textR} ${textR} 0 1 1 50 ${50 - textR}`;
  const inked = state !== "idle";

  return (
    <div
      className={`${styles.root} ${inked ? styles.inked : ""} ${state === "busy" ? styles.busy : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" className={styles.rim} focusable="false">
        <defs>
          <path id={pathId} d={path} />
        </defs>
        <circle
          cx="50"
          cy="50"
          r={g.outerRingRadius * 100}
          fill="none"
          strokeWidth={g.outerRingWidth * 100 * 1.6}
          strokeDasharray={inked ? "none" : "2.2 2.2"}
          className={styles.ring}
        />
        <circle
          cx="50"
          cy="50"
          r={g.innerRingRadius * 100}
          fill="none"
          strokeWidth={g.innerRingWidth * 100 * 1.6}
          strokeDasharray={inked ? "none" : "1.4 1.6"}
          className={styles.ring}
        />
        <text
          dominantBaseline="central"
          className={styles.text}
          style={{ fontSize: rimFontSizeFraction(rimText.length) * 100 }}
        >
          <textPath href={`#${pathId}`}>{rimText}</textPath>
        </text>
      </svg>
      <svg viewBox="0 0 24 24" className={styles.glyph} focusable="false">
        <path d="M12 4v11M7 10.5 12 15.5l5-5M6 19.5h12" />
      </svg>
    </div>
  );
}
