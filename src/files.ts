// 実際のファイルの読み書き
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FileAccess } from "./page.ts";

export function createFileAccess(): FileAccess {
	return {
		read(path) {
			try {
				return readFileSync(path, "utf8");
			} catch (error) {
				// ENOTDIR は、途中がファイルで辿れないとき（git の worktree では .git がファイル）
				const code = (error as { code?: string }).code;
				if (code === "ENOENT" || code === "ENOTDIR") return undefined;
				throw error;
			}
		},
		// 書きかけを読み手に見せないよう、別の名前で書いてから置き換える
		write(path, content) {
			mkdirSync(dirname(path), { recursive: true });
			const temporaryPath = `${path}.${process.pid}.tmp`;
			try {
				writeFileSync(temporaryPath, content, "utf8");
				renameSync(temporaryPath, path);
			} finally {
				rmSync(temporaryPath, { force: true });
			}
		},
	};
}
