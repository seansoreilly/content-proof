"use client";

import { Button, Eyebrow, Panel } from "@/components/ui";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <div className="px-4 py-10 sm:py-16">
      <Panel className="mx-auto max-w-2xl">
        <Eyebrow>Something went wrong</Eyebrow>
        <p className="my-4">
          The page failed to load. Try again, and if it keeps happening come
          back in a few minutes.
        </p>
        <Button onClick={() => reset()}>Try again</Button>
      </Panel>
    </div>
  );
}
