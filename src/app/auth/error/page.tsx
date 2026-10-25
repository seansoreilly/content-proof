import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button, Eyebrow, Panel } from "@/components/ui";
import { authErrorMessage, firstParam } from "../messages";

export const metadata: Metadata = { title: "Sign-in error" };

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  // NextAuth sends `?error=undefined` when it has no code; keep the address clean.
  if (firstParam(params.error) === "undefined") redirect("/auth/error");
  const message = authErrorMessage(firstParam(params.error)) ?? "Sign-in failed. Try again.";

  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 py-10 sm:py-16">
      <Panel className="flex flex-col items-start gap-4">
        <Eyebrow>Sign-in error</Eyebrow>
        <p className="text-void" role="alert">
          {message}
        </p>
        <div className="flex flex-wrap gap-4">
          <Button href="/auth/signin">Try another account</Button>
          <Button variant="secondary" href="/">
            Home
          </Button>
        </div>
      </Panel>
    </div>
  );
}
