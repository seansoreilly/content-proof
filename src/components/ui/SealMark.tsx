import type { ReactElement } from "react";

export type SealTone = "pending" | "sealed" | "void";

export interface SealMarkColors {
  accent: string;
  void: string;
  relief: string;
  ink: string;
}

export interface SealMarkProps {
  tone: SealTone;
  size?: number;
  label?: string;
  /**
   * Override the colours with concrete values. Needed where CSS variables do
   * not resolve (next/og ImageResponse). Defaults to the theme variables.
   */
  colors?: SealMarkColors;
}

const DEFAULT_LABEL: Record<SealTone, string> = {
  pending: "Seal",
  sealed: "Sealed",
  void: "Void",
};

const VAR_COLORS: SealMarkColors = {
  accent: "var(--accent)",
  void: "var(--void)",
  relief: "var(--relief)",
  ink: "currentColor",
};

/**
 * Inline SVG with no hooks and no global CSS classes, so next/og can render
 * it too.
 */
export function SealMark({
  tone,
  size = 52,
  label,
  colors = VAR_COLORS,
}: SealMarkProps): ReactElement {
  const ring =
    tone === "sealed" ? colors.accent : tone === "void" ? colors.void : colors.relief;
  const textColor =
    tone === "sealed" ? colors.accent : tone === "void" ? colors.void : colors.ink;
  const text = (label ?? DEFAULT_LABEL[tone]).toUpperCase();
  const fontSize = text.length > 4 ? 15 : 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label ?? DEFAULT_LABEL[tone]}
    >
      <circle cx="50" cy="50" r="47" fill="none" stroke={ring} strokeWidth="3" />
      {tone === "sealed" && (
        <circle cx="50" cy="50" r="39" fill="none" stroke={ring} strokeWidth="1.5" />
      )}
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={fontSize}
        fontWeight={700}
        letterSpacing="1"
        fontFamily="var(--font-display), sans-serif"
      >
        {text}
      </text>
      {tone === "void" && (
        <line
          x1="20"
          y1="80"
          x2="80"
          y2="20"
          stroke={ring}
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
