"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { rimFontSizeFraction, SEAL_GEOMETRY } from "@/lib/seal-image";
import styles from "./Seal.module.css";

export interface SealProps {
  rimText: string;
  size?: number;
  pressed?: boolean;
  children: ReactNode;
  className?: string;
}

const RAISED_SHADOW =
  "inset 1px 1px 2px var(--relief-hi), inset -2px -2px 4px var(--relief), 6px 8px 18px -8px var(--relief)";

export function Seal({
  rimText,
  size = 288,
  pressed = false,
  children,
  className,
}: SealProps): React.JSX.Element {
  const pathId = useId();
  const [animating, setAnimating] = useState(false);
  const wasPressed = useRef(pressed);

  useEffect(() => {
    if (pressed && !wasPressed.current) setAnimating(true);
    wasPressed.current = pressed;
  }, [pressed]);

  const g = SEAL_GEOMETRY;
  const u = 100;
  const textR = g.textRadius * u;
  const fontSize = rimFontSizeFraction(rimText.length) * u;
  const path = `M 50 ${50 - textR} A ${textR} ${textR} 0 1 1 50 ${50 + textR} A ${textR} ${textR} 0 1 1 50 ${50 - textR}`;

  const rootStyle: CSSProperties = {
    width: size,
    maxWidth: "100%",
    aspectRatio: "1 / 1",
    background: "var(--paper)",
    boxShadow: RAISED_SHADOW,
  };
  const slotStyle: CSSProperties = {
    width: `${g.slotSize * 100}%`,
    height: `${g.slotSize * 100}%`,
    padding: `${g.slotPadding * g.slotSize * 100}%`,
    background: "#FFFFFF",
  };

  return (
    <div
      role="img"
      aria-label={`Seal: ${rimText}`}
      className={[
        "relative flex items-center justify-center rounded-full",
        animating ? styles.press : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={rootStyle}
      onAnimationEnd={() => setAnimating(false)}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="50"
          cy="50"
          r={g.outerRingRadius * u}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={g.outerRingWidth * u}
        />
        <circle
          cx="50"
          cy="50"
          r={g.innerRingRadius * u}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={g.innerRingWidth * u}
        />
        <defs>
          <path id={pathId} d={path} />
        </defs>
        <text
          fill="var(--accent)"
          dominantBaseline="central"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <textPath href={`#${pathId}`}>{rimText}</textPath>
        </text>
      </svg>
      <div className="relative box-border flex items-center justify-center" style={slotStyle}>
        {children}
      </div>
    </div>
  );
}
