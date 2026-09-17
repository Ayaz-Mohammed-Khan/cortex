import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncContent } from '../scripts/sync-content.ts';
import { NOTES_TARGET_DIR } from '../src/lib/config.ts';

// Unit tests for the `sync-content` prebuild step (design "Content sync step").
//
// These exercise the real `syncContent` function against throwaway temp
// directories, driving it with an explicit `cwd`/`contentRoot` so no
// environment variables or subprocess are needed. Console output is silenced.
//
// Contract under test:
//   - Requirement 1.1 governs which files become NOTES: only `.md` files
//     (case-insensitive), with the folder hierarchy preserved. `filesCopied`
//     counts exactly those note files.
//   - Image/asset files (`.png .jpg .jpeg .gif .svg .webp .avif`) are ALSO
//     mirrored — not as content, but so relative image references inside a note
//     resolve during the build. `assetsCopied` counts those. Genuinely
//     unsupported files (`.txt`, `.json`, `.markdown`, …) are never copied.
//   - Dot-directories (`.obsidian`, `.git`, …) are skipped entirely.
//   - The sync is a TRUE mirror: the target is cleared before copying so stale
//     notes never survive across syncs (except the `in-place` case).
//   - Requirement 1.9: an empty/missing/non-directory content root completes
//     without error and yields an empty target.

/** Create a file, creating parent directories as needed. */
function writeFileDeep(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

describe('sync-content step', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'sync-content-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Absolute path of the sync target inside the temp working directory. */
  const targetIn = (base: string): string => join(base, NOTES_TARGET_DIR);

  it('mirrors .md files and preserves the folder hierarchy (Req 1.1)', () => {
    const contentRoot = join(workDir, 'content');
    writeFileDeep(join(contentRoot, 'root-note.md'), '# Root');
    writeFileDeep(
      join(contentRoot, 'AI-ML', '01 - Statistics.md'),
      '# Statistics',
    );
    writeFileDeep(
      join(contentRoot, 'AI-ML', 'SelfNotes', 'intro.md'),
      '# Intro',
    );

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.status).toBe('copied');
    expect(result.filesCopied).toBe(3);
    expect(result.assetsCopied).toBe(0);

    const target = targetIn(workDir);
    expect(existsSync(join(target, 'root-note.md'))).toBe(true);
    expect(existsSync(join(target, 'AI-ML', '01 - Statistics.md'))).toBe(true);
    expect(existsSync(join(target, 'AI-ML', 'SelfNotes', 'intro.md'))).toBe(
      true,
    );

    // Content is copied verbatim.
    expect(readFileSync(join(target, 'root-note.md'), 'utf8')).toBe('# Root');
  });

  it('mirrors .md case-insensitively and excludes non-note, non-image files (Req 1.1)', () => {
    const contentRoot = join(workDir, 'content');
    writeFileDeep(join(contentRoot, 'keep.md'), 'md');
    writeFileDeep(join(contentRoot, 'KEEP-UPPER.MD'), 'MD');
    writeFileDeep(join(contentRoot, 'notes.txt'), 'txt');
    writeFileDeep(join(contentRoot, 'data.json'), '{}');
    writeFileDeep(join(contentRoot, 'readme.markdown'), 'markdown');

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    // Only the two `.md` NOTE files are counted / copied.
    expect(result.filesCopied).toBe(2);
    expect(result.assetsCopied).toBe(0);

    const target = targetIn(workDir);
    expect(existsSync(join(target, 'keep.md'))).toBe(true);
    expect(existsSync(join(target, 'KEEP-UPPER.MD'))).toBe(true);
    expect(existsSync(join(target, 'notes.txt'))).toBe(false);
    expect(existsSync(join(target, 'data.json'))).toBe(false);
    // `.markdown` is not `.md`, so it is excluded.
    expect(existsSync(join(target, 'readme.markdown'))).toBe(false);
  });

  it('mirrors image assets alongside notes so relative references resolve', () => {
    const contentRoot = join(workDir, 'content');
    writeFileDeep(join(contentRoot, 'AI-ML', 'note.md'), '# Note ![x](./chart.png)');
    // A mix of image extensions in various cases, next to the note that uses them.
    writeFileDeep(join(contentRoot, 'AI-ML', 'chart.png'), 'png');
    writeFileDeep(join(contentRoot, 'AI-ML', 'photo.JPG'), 'jpg');
    writeFileDeep(join(contentRoot, 'assets', 'diagram.svg'), '<svg/>');
    writeFileDeep(join(contentRoot, 'assets', 'anim.gif'), 'gif');
    writeFileDeep(join(contentRoot, 'assets', 'hero.webp'), 'webp');
    writeFileDeep(join(contentRoot, 'assets', 'hero.avif'), 'avif');
    writeFileDeep(join(contentRoot, 'assets', 'pic.jpeg'), 'jpeg');
    // Not an image and not a note → excluded even though it sits with assets.
    writeFileDeep(join(contentRoot, 'assets', 'notes.txt'), 'txt');

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.status).toBe('copied');
    // One note, seven image assets; the `.txt` is excluded.
    expect(result.filesCopied).toBe(1);
    expect(result.assetsCopied).toBe(7);

    const target = targetIn(workDir);
    expect(existsSync(join(target, 'AI-ML', 'note.md'))).toBe(true);
    expect(existsSync(join(target, 'AI-ML', 'chart.png'))).toBe(true);
    expect(existsSync(join(target, 'AI-ML', 'photo.JPG'))).toBe(true);
    expect(existsSync(join(target, 'assets', 'diagram.svg'))).toBe(true);
    expect(existsSync(join(target, 'assets', 'anim.gif'))).toBe(true);
    expect(existsSync(join(target, 'assets', 'hero.webp'))).toBe(true);
    expect(existsSync(join(target, 'assets', 'hero.avif'))).toBe(true);
    expect(existsSync(join(target, 'assets', 'pic.jpeg'))).toBe(true);
    expect(existsSync(join(target, 'assets', 'notes.txt'))).toBe(false);
  });

  it('skips dot-directories entirely (vault/tooling junk)', () => {
    const contentRoot = join(workDir, 'content');
    // Real content that must be mirrored.
    writeFileDeep(join(contentRoot, 'AI-ML', 'note.md'), '# Note');
    // Dot-directories (Obsidian/vault junk) that must be skipped wholesale,
    // even when they contain notes or images.
    writeFileDeep(join(contentRoot, '.obsidian', 'workspace.md'), '# junk');
    writeFileDeep(join(contentRoot, '.obsidian', 'icon.png'), 'png');
    writeFileDeep(join(contentRoot, '.trash', 'deleted.md'), '# trash');
    writeFileDeep(join(contentRoot, '.git', 'HEAD'), 'ref: refs/heads/main');

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.filesCopied).toBe(1);
    expect(result.assetsCopied).toBe(0);

    const target = targetIn(workDir);
    expect(existsSync(join(target, 'AI-ML', 'note.md'))).toBe(true);
    expect(existsSync(join(target, '.obsidian'))).toBe(false);
    expect(existsSync(join(target, '.trash'))).toBe(false);
    expect(existsSync(join(target, '.git'))).toBe(false);
  });

  it('performs a true mirror: stale target content is removed before copying', () => {
    const contentRoot = join(workDir, 'content');
    writeFileDeep(join(contentRoot, 'current.md'), '# Current');

    // Pre-seed the target with a note that no longer exists in the source.
    const target = targetIn(workDir);
    writeFileDeep(join(target, 'stale', 'old-note.md'), '# Old');
    writeFileDeep(join(target, 'stale', 'old-image.png'), 'png');

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.status).toBe('copied');
    expect(result.filesCopied).toBe(1);

    // The new note is present; the stale content is gone.
    expect(existsSync(join(target, 'current.md'))).toBe(true);
    expect(existsSync(join(target, 'stale', 'old-note.md'))).toBe(false);
    expect(existsSync(join(target, 'stale'))).toBe(false);
  });

  it('completes without error and copies nothing for an empty content root (Req 1.9)', () => {
    const contentRoot = join(workDir, 'content');
    mkdirSync(contentRoot, { recursive: true });

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.status).toBe('copied');
    expect(result.filesCopied).toBe(0);
    expect(result.assetsCopied).toBe(0);

    // The target directory always exists so downstream globbing sees an empty
    // (but well-defined) set of entries.
    expect(existsSync(targetIn(workDir))).toBe(true);
  });

  it('treats a content root with only unsupported files as empty (Req 1.9)', () => {
    const contentRoot = join(workDir, 'content');
    writeFileDeep(join(contentRoot, 'notes.txt'), 'txt');
    writeFileDeep(join(contentRoot, 'nested', 'data.json'), '{}');

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.filesCopied).toBe(0);
    expect(result.assetsCopied).toBe(0);
    expect(existsSync(targetIn(workDir))).toBe(true);
  });

  it('completes without error when the content root is missing (Req 1.9)', () => {
    const result = syncContent({
      cwd: workDir,
      contentRoot: join(workDir, 'does-not-exist'),
      silent: true,
    });

    expect(result.status).toBe('missing-source');
    expect(result.filesCopied).toBe(0);
    // Target is still prepared so downstream globbing has a directory to read.
    expect(existsSync(targetIn(workDir))).toBe(true);
  });

  it('completes without error when the content root is a file, not a directory (Req 1.9)', () => {
    const contentRoot = join(workDir, 'not-a-dir.md');
    writeFileSync(contentRoot, '# oops');

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.status).toBe('source-not-directory');
    expect(result.filesCopied).toBe(0);
    expect(existsSync(targetIn(workDir))).toBe(true);
  });

  it('reads in place without copying or clearing when the root already resolves to the target', () => {
    const contentRoot = targetIn(workDir);
    writeFileDeep(join(contentRoot, 'existing.md'), '# Existing');

    const result = syncContent({
      cwd: workDir,
      contentRoot,
      silent: true,
    });

    expect(result.status).toBe('in-place');
    expect(result.filesCopied).toBe(0);
    // The pre-existing file is left untouched (never cleared in-place).
    expect(readFileSync(join(contentRoot, 'existing.md'), 'utf8')).toBe(
      '# Existing',
    );
  });
});
