import Landing from "@/components/Landing";
import { SignInButton } from "@/components/SignInButton";
import { SignOutButton } from "@/components/SignOutButton";
import { AccountStatus } from "@/components/AccountStatus";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export default async function Home() {
  const session = await getServerSession(authOptions);

  const authSection = (
    <div className="flex justify-center">
      {session ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-light-500">
            Signed in as {session.user?.email}
          </p>
          <AccountStatus />
          <SignOutButton />
        </div>
      ) : (
        <SignInButton />
      )}
    </div>
  );

  return <Landing authSection={authSection} />;
}
