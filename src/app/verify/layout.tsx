import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Verify a file" };

export default function VerifyLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
