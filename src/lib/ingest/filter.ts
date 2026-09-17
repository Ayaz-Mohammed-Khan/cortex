/**
 * Markdown file filter for the Ingestion Domain (L1).
 *
 * Pure, framework-free helpers that decide which discovered files are Notes.
 * A file is a Note when its extension is exactly `.md`, compared
 * case-insensitively. Every other file (including `.mdx`, `.txt`, or names with
 * no extension) is excluded.
 *
 * Satisfies Design Property 5; Requirement 1.1.
 */

/**
 * Returns true when `name` has the exact `.md` extension, compared
 * case-insensitively.
 *
 * Only the final `.md` extension matches:
 * - Matches: "notes.md", "NOTES.MD", "a.Md", "archive.tar.md"
 * - Excludes: "notes.mdx", "notes.txt", "md", "notesmd", "readme", ".md"
 *
 * The bare name ".md" is treated as a dotfile with no base name and is
 * therefore excluded — a matching file must have at least one character before
 * the `.md` extension.
 */
export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.length > '.md'.length && lower.endsWith('.md');
}

/**
 * Returns the subset of `names` that are Markdown files, preserving their
 * original order. Non-`.md` files are excluded.
 */
export function filterMarkdownFiles(names: readonly string[]): string[] {
  return names.filter(isMarkdownFile);
}
