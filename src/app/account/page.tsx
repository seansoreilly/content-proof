import type { Metadata } from "next";
import type { ReactElement } from "react";
import { getServerSession } from "next-auth";
import { AccountRecords } from "@/components/account/AccountRecords";
import { SignInButton } from "@/components/SignInButton";
import { Eyebrow, Panel } from "@/components/ui";
import { authOptions } from "@/lib/auth/options";

export const metadata: Metadata = { title: "Account" };

export const dynamic = "force-dynamic";

/**
 * The signed-in account's own history. The lists load client-side from the
 * same-origin account API, so this server component only decides between
 * the account view and the sign-in panel.
 */
export default async function AccountPage(): Promise<ReactElement> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 py-10 sm:py-16">
      <h1 className="mb-8">Account</h1>
      {email ? (
        <div className="flex flex-col gap-8">
          <p className="text-mute">
            Signed in as <span className="text-ink">{email}</span>
          </p>
          <Panel as="section" className="flex flex-col gap-4">
            <Eyebrow>Your records</Eyebrow>
            <AccountRecords />
          </Panel>
        </div>
      ) : (
        <Panel className="flex flex-col items-start gap-4">
          <Eyebrow>Sign in</Eyebrow>
          <p>Sign in with Google to see the records you have signed.</p>
          <SignInButton callbackUrl="/account" />
        </Panel>
      )}
    </div>
  );
}
