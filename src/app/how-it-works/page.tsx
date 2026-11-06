import type { ReactElement } from "react";
import { MarkdownPage } from "@/components/MarkdownPage";

export const metadata = {
  title: "How it works",
};

export default function HowItWorksPage(): ReactElement {
  return <MarkdownPage file="cryptography-explanation-content.md" />;
}
