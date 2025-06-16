"use client";
import { ReactNode } from "react";

interface GradientHeadingProps {
  children: ReactNode;
  /** Additional Tailwind classes (e.g., text size, margin, alignment) */
  className?: string;
}

export default function GradientHeading({
  children,
  className = "",
}: GradientHeadingProps) {
  return (
    <h1 className={`text-blue-600 font-extrabold ${className}`}>{children}</h1>
  );
}
