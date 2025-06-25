"use client";
import { ReactNode } from "react";

interface GradientHeadingProps {
  children: ReactNode;
  /** Additional Tailwind classes (e.g., text size, margin, alignment) */
  className?: string;
  /** Heading level for accessibility */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Gradient variant */
  variant?: "primary" | "emerald" | "sunset" | "ocean";
}

const gradientClasses = {
  primary: "text-gradient",
  emerald: "text-gradient-emerald",
  sunset:
    "bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 bg-clip-text text-transparent",
  ocean:
    "bg-gradient-to-r from-blue-600 via-teal-500 to-emerald-500 bg-clip-text text-transparent",
};

export default function GradientHeading({
  children,
  className = "",
  level = 1,
  variant = "primary",
}: GradientHeadingProps) {
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  const gradientClass = gradientClasses[variant];

  return (
    <Tag
      className={`${gradientClass} font-extrabold tracking-tight ${className}`}
    >
      {children}
    </Tag>
  );
}
