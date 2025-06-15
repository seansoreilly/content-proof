"use client";

interface AnimatedBackgroundProps {
  /**
   * Array of extra Tailwind classes for each orb.
   * Provide width/height, background color & position classes.
   */
  orbs: string[];
}

export default function AnimatedBackground({ orbs }: AnimatedBackgroundProps) {
  return (
    <div className="absolute inset-0 -z-10 pointer-events-none">
      {orbs.map((cls, idx) => (
        <div
          key={idx}
          className={`animate-float blur-3xl rounded-full absolute ${cls}`}
        />
      ))}
    </div>
  );
}
