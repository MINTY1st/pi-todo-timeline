// 実際のファイルの読み書き
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FileAccess {
	/** ファイルの中身。無ければ undefined */
	read(path: string): string | undefined;
	write(path: string, content: string): void;
}

/** 一覧も取れるファイルの読み書き（Pi Web の配布物に当てるときに使う） */
export interface PatchFiles {
	read(path: string): string | undefined;
	/** ディレクトリの直下のファイル名。ディレクトリが無ければ undefined */
	list(directory: string): string[] | undefined;
	write(path: string, content: string): void;
}

const isMissing = (error: unknown): boolean => {
	// ENOTDIR は、途中がファイルで辿れないとき（git の worktree では .git がファイル）
	const code = (error as { code?: string }).code;
	return code === "ENOENT" || code === "ENOTDIR";
};

export function createFileAccess(): PatchFiles {
	return {
		list(directory) {
			try {
				return readdirSync(directory).sort();
			} catch (error) {
				if (isMissing(error)) return undefined;
				throw error;
			}
		},
		read(path) {
			try {
				return readFileSync(path, "utf8");
			} catch (error) {
				if (isMissing(error)) return undefined;
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
