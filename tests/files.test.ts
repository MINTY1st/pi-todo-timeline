import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAccess } from "../src/files.ts";

test("無いファイルは undefined、書いたファイルは読める。途中のディレクトリは作る", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-timeline-"));
	try {
		const files = createFileAccess();
		const path = join(root, "deep", "dir", "page.html");
		assert.equal(files.read(path), undefined);
		files.write(path, "<a>");
		files.write(path, "<b>");
		assert.equal(files.read(path), "<b>");
		assert.deepEqual(readdirSync(join(root, "deep", "dir")), ["page.html"], "書きかけのファイルを残さない");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("途中がファイルで辿れない場所（git の worktree の .git など）も、無いものとして扱う", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-timeline-"));
	try {
		writeFileSync(join(root, ".git"), "gitdir: /elsewhere\n");
		assert.equal(createFileAccess().read(join(root, ".git", "info", "exclude")), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ディレクトリの直下のファイル名を返す。ディレクトリが無ければ undefined", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-timeline-"));
	try {
		const files = createFileAccess();
		assert.equal(files.list(join(root, "none")), undefined);
		files.write(join(root, "css", "b.css"), "b");
		files.write(join(root, "css", "a.css"), "a");
		assert.deepEqual(files.list(join(root, "css")), ["a.css", "b.css"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("読めない理由が「無い」以外なら、例外にする", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-timeline-"));
	try {
		assert.throws(() => createFileAccess().read(root), /EISDIR/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
