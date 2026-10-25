import type { Metadata } from "next";
import { Eyebrow, Panel } from "@/components/ui";
import { SignInButton } from "@/components/SignInButton";
import { authErrorMessage, firstParam, safeCallbackUrl } from "../messages";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const message = authErrorMessage(firstParam(params.error));

  return (
    <main className="mx-auto w-full max-w-[42rem] px-4 py-10 sm:py-16">
      <Panel className="flex flex-col items-start gap-4">
        <Eyebrow>Sign in</Eyebrow>
        {message && (
          <p className="text-void" role="alert">
            {message}
          </p>
        )}
        <p>Sign in with Google to sign files. Verifying a file needs no account.</p>
        <SignInButton callbackUrl={callbackUrl ?? "/"} />
      </Panel>
    </main>
  );
}
