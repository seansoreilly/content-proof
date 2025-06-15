import Landing from "@/components/Landing";
import { SignInButton } from "@/components/SignInButton";
import { SignOutButton } from "@/components/SignOutButton";
import { AccountStatus } from "@/components/AccountStatus";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export default async function Home() {
  const session = await getServerSession(authOptions);
  return (
    <>
      <Landing />
      <section className="flex justify-center mt-10">
        {session ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-gray-600">
              Signed in as {session.user?.email}
            </p>
            <AccountStatus />
            <SignOutButton />
          </div>
        ) : (
          <SignInButton />
        )}
      </section>
    </>
  );
}
