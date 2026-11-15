import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SOURCE = resolve(import.meta.dirname, "..", "src");

/** フォルダごとに、読み込んではいけないフォルダ。組み立てるのは直下の extension.ts だけにする */
const FORBIDDEN: Record<string, string[]> = {
	core: ["todo", "report", "view", "pi-web", "."],
	todo: ["report", "view", "pi-web", "."],
	report: ["view", "pi-web", "."],
	view: ["pi-web", "."],
	"pi-web": ["todo", "report", "view", "."],
};

/** src の下の .ts ごとに、読み込んでいる src の中のファイルのフォルダ（直下なら "."） */
function importsByFile(): Array<{ file: string; folder: string; targets: string[] }> {
	const files = readdirSync(SOURCE, { recursive: true }).map(String).filter((name) => name.endsWith(".ts"));
	return files.map((file) => {
		const text = readFileSync(join(SOURCE, file), "utf8");
		const targets = [...text.matchAll(/from "(\.{1,2}\/[^"]+)"/g)].map((match) => dirname(relative(SOURCE, resolve(SOURCE, dirname(file), match[1] ?? ""))));
		return { file, folder: dirname(file), targets };
	});
}

test("部品のフォルダは、決めた向きにだけ読み込む（todo と report は表示を知らず、pi-web は core だけを使う）", () => {
	const violations = importsByFile().flatMap(({ file, folder, targets }) =>
		targets.filter((target) => target !== folder && (FORBIDDEN[folder] ?? []).includes(target)).map((target) => `${file} → ${target}`),
	);
	assert.deepEqual(violations, []);
});

test("src の直下には、入口と組み立て役だけを置く", () => {
	const top = readdirSync(SOURCE).filter((name) => name.endsWith(".ts")).sort();
	assert.deepEqual(top, ["extension.ts", "index.ts"]);
});
