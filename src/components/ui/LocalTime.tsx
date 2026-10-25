"use client";

import { useEffect, useState, type ReactElement } from "react";
import { formatLocalTime } from "@/lib/format-time";

export interface LocalTimeProps {
  /** ISO 8601 timestamp. */
  iso: string;
  className?: string;
  /** What to show before hydration: the ISO text (default) or nothing. */
  fallback?: "iso" | "none";
}

/**
 * A timestamp in the viewer's own time zone. Server-rendered pages cannot know
 * the zone, so this shows the ISO text until the browser takes over and then
 * swaps in the local string. The `dateTime` attribute is always the ISO value.
 */
export function LocalTime({ iso, className, fallback = "iso" }: LocalTimeProps): ReactElement | null {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    const ms = Date.parse(iso);
    setLocal(Number.isNaN(ms) ? null : formatLocalTime(ms));
  }, [iso]);

  const text = local ?? (fallback === "iso" ? iso : null);
  if (text === null) return null;
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
