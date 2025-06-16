import fs from "fs/promises";
import path from "path";
import { marked } from "marked";

export const metadata = {
  title: "Privacy Policy – Content Proof",
};

export default async function PrivacyPage() {
  const markdownPath = path.join(
    process.cwd(),
    "documentation",
    "privacy-policy-content.md"
  );
  const source = await fs.readFile(markdownPath, "utf-8");
  const html = marked.parse(source);

  return (
    <article className="prose mx-auto px-4 py-20 dark:prose-invert">
      {/* biome-ignore-next-line: react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
