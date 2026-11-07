import fs from "fs/promises";
import path from "path";
import type { ReactElement } from "react";
import { marked } from "marked";

/** The documentation files rendered as pages, listed so no caller can pass an arbitrary path. */
export type DocumentationFile = "privacy-policy-content.md" | "cryptography-explanation-content.md";

export interface MarkdownPageProps {
  /** File name relative to the repository's `documentation/` directory. */
  file: DocumentationFile;
}

/**
 * Server component that renders one of our own documentation files as a
 * prose page. The markdown is trusted repository content, not user input,
 * which is why its HTML can be injected directly.
 */
export async function MarkdownPage({ file }: MarkdownPageProps): Promise<ReactElement> {
  const source = await fs.readFile(path.join(process.cwd(), "documentation", file), "utf-8");
  // marked.parse is typed as string | Promise<string> (async extensions), so always await it.
  const html = await marked.parse(source);

  return (
    <article className="prose mx-auto px-4 py-16 dark:prose-invert">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
