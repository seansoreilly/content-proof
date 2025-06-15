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
    <h1
      className={`text-gradient-blue font-extrabold bg-[length:200%_200%] bg-clip-text text-transparent animate-gradient-x ${className}`}
    >
      {children}
    </h1>
  );
}
