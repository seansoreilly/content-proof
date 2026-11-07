import type { ReactElement } from "react";
import { MarkdownPage } from "@/components/MarkdownPage";

export const metadata = {
  title: "Privacy",
};

export default function PrivacyPage(): ReactElement {
  return <MarkdownPage file="privacy-policy-content.md" />;
}
