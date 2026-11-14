// Pi Web の CSS に、パネルの高さの上書きを足す・外す
import { join } from "node:path";

export interface CssFiles {
	read(path: string): string | undefined;
	/** ディレクトリの直下のファイル名。ディレクトリが無ければ undefined */
	list(directory: string): string[] | undefined;
	write(path: string, content: string): void;
}

export interface CssOutcome {
	ok: boolean;
	changed: string[];
	unchanged: string[];
	/** 失敗の理由。成功なら空 */
	message: string;
}

/** Pi Web が拡張のパネルを入れる枠。元の規則は max-height: min(144px, 18dvh) */
export const PANEL_SELECTOR = ".extension-widget-panels";
const MARKER_START = "/* pi-todo-timeline:start */";
const MARKER_END = "/* pi-todo-timeline:end */";

export function buildRule(percent: number): string {
	return `${PANEL_SELECTOR}{max-height:${percent}dvh!important}`;
}

/** 足した分（目印の間と、前後に入れた改行）を取り除く。終わりの目印が欠けていれば、始まりの目印から後ろを取り除く */
function withoutBlock(current: string): string {
	const start = current.indexOf(MARKER_START);
	if (start < 0) return current;
	const end = current.indexOf(MARKER_END, start);
	const tail = end < 0 ? "" : current.slice(end + MARKER_END.length);
	return current.slice(0, start).replace(/\n$/, "") + tail.replace(/^\n/, "");
}

/** 規則を末尾に目印つきで入れた中身を返す。rule が undefined なら外す。変わらなければ null */
export function patchCss(current: string, rule: string | undefined): string | null {
	const base = withoutBlock(current);
	const next = rule === undefined ? base : `${base}\n${MARKER_START}${rule}${MARKER_END}\n`;
	return next === current ? null : next;
}

const failure = (message: string): CssOutcome => ({ ok: false, changed: [], unchanged: [], message });

/** パネルの規則を含む CSS のファイルにだけ、上書きを足す（rule が undefined なら外す） */
export function applyToDirectory(files: CssFiles, cssDirectory: string, rule: string | undefined): CssOutcome {
	const names = files.list(cssDirectory);
	if (names === undefined) return failure(`${cssDirectory} が見つかりません`);
	const outcome: CssOutcome = { ok: true, changed: [], unchanged: [], message: "" };
	for (const name of names.filter((candidate) => candidate.endsWith(".css"))) {
		const path = join(cssDirectory, name);
		const current = files.read(path);
		if (current === undefined || !withoutBlock(current).includes(PANEL_SELECTOR)) continue;
		const next = patchCss(current, rule);
		if (next === null) outcome.unchanged.push(name);
		else {
			files.write(path, next);
			outcome.changed.push(name);
		}
	}
	const found = outcome.changed.length + outcome.unchanged.length > 0;
	return found ? outcome : failure(`${PANEL_SELECTOR} を含む CSS がありません（${cssDirectory}）`);
}
