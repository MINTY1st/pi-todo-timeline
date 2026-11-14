// Pi Web の配布物のファイルに、目印つきで足す・外す
import { join } from "node:path";

export interface PatchFiles {
	read(path: string): string | undefined;
	/** ディレクトリの直下のファイル名。ディレクトリが無ければ undefined */
	list(directory: string): string[] | undefined;
	write(path: string, content: string): void;
}

export interface PatchOutcome {
	ok: boolean;
	changed: string[];
	unchanged: string[];
	/** 失敗の理由。成功なら空 */
	message: string;
}

/** CSS でも JavaScript でも注釈として読まれる形の目印 */
const MARKER_START = "/* pi-todo-timeline:start */";
const MARKER_END = "/* pi-todo-timeline:end */";

/** 足した分（目印の間と、前後に入れた改行）を取り除く。終わりの目印が欠けていれば、始まりの目印から後ろを取り除く */
export function withoutBlock(current: string): string {
	const start = current.indexOf(MARKER_START);
	if (start < 0) return current;
	const end = current.indexOf(MARKER_END, start);
	const tail = end < 0 ? "" : current.slice(end + MARKER_END.length);
	return current.slice(0, start).replace(/\n$/, "") + tail.replace(/^\n/, "");
}

/** block を末尾に目印つきで入れた中身を返す。block が undefined なら外す。変わらなければ null */
export function patchText(current: string, block: string | undefined): string | null {
	const base = withoutBlock(current);
	const next = block === undefined ? base : `${base}\n${MARKER_START}${block}${MARKER_END}\n`;
	return next === current ? null : next;
}

const failure = (message: string): PatchOutcome => ({ ok: false, changed: [], unchanged: [], message });

/**
 * ディレクトリの直下のファイルのうち、isTarget が認めたものにだけ block を足す（block が undefined なら外す）。
 * isTarget には、足した分を除いた元の中身を渡す。対象が1つも無ければ、notFound を理由にして失敗を返す。
 */
export function applyPatch(files: PatchFiles, directory: string, isTarget: (name: string, content: string) => boolean, block: string | undefined, notFound: string): PatchOutcome {
	const names = files.list(directory);
	if (names === undefined) return failure(`${directory} が見つかりません`);
	const outcome: PatchOutcome = { ok: true, changed: [], unchanged: [], message: "" };
	for (const name of names) {
		const path = join(directory, name);
		const current = files.read(path);
		if (current === undefined || !isTarget(name, withoutBlock(current))) continue;
		const next = patchText(current, block);
		if (next === null) outcome.unchanged.push(name);
		else {
			files.write(path, next);
			outcome.changed.push(name);
		}
	}
	return outcome.changed.length + outcome.unchanged.length > 0 ? outcome : failure(notFound);
}
