"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

export interface ButtonProps {
  variant?: "primary" | "secondary";
  href?: string;
  disabled?: boolean;
  disabledReason?: string;
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

const BASE =
  "inline-flex items-center justify-center font-display text-[13px] font-semibold uppercase tracking-[0.06em] px-[22px] py-3 min-h-[44px] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const VARIANTS = {
  primary: "bg-accent text-paper",
  secondary: "text-accent shadow-outline",
} as const;

export function Button({
  variant = "primary",
  href,
  disabled = false,
  disabledReason,
  type = "button",
  onClick,
  className = "",
  children,
}: ButtonProps): ReactElement {
  const classes = `${BASE} ${VARIANTS[variant]} ${
    disabled ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
  } ${className}`;

  if (href !== undefined && !disabled) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
