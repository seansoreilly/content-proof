"use client";

import type { ReactElement } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui";

export function SignOutButton(): ReactElement {
  return (
    <Button variant="secondary" onClick={() => signOut()}>
      Sign out
    </Button>
  );
}
