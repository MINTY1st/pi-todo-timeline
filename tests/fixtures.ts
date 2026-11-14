// テストで使うセッションのエントリの組み立て
import { basename, dirname, resolve, sep } from "node:path";
import type { Report } from "../src/records.ts";
import type { TaskView } from "../src/view.ts";

export const at = (clock: string): string => `2030-11-01T${clock}:00.000Z`;
export const ms = (clock: string): number => Date.parse(at(clock));

let serial = 0;
const base = (clock: string) => ({ id: `e${++serial}`, parentId: null, timestamp: at(clock) });

export const user = (clock: string, text: string) => ({ ...base(clock), type: "message", message: { role: "user", content: [{ type: "text", text }] } });
export const assistant = (clock: string, blocks: unknown[]) => ({ ...base(clock), type: "message", message: { role: "assistant", content: blocks } });
export const text = (value: string) => ({ type: "text", text: value });
export const thinking = (value: string) => ({ type: "thinking", thinking: value });
export const toolCall = (name: string, argumentsValue: unknown) => ({ type: "toolCall", id: "call", name, arguments: argumentsValue });
export const toolResult = (clock: string, toolName: string, output: string, isError = false) => ({
	...base(clock),
	type: "message",
	message: { role: "toolResult", toolCallId: "call", toolName, content: [{ type: "text", text: output }], isError },
});
export const custom = (clock: string, customType: string, data: unknown) => ({ ...base(clock), type: "custom", customType, data });

/** 完了・進行中・未着手が1件ずつのタスク */
export const sampleTasks: TaskView[] = [
	{ id: 1, subject: "不具合を再現する", status: "completed", description: "失敗するテストを足した" },
	{ id: 2, subject: "修正する", status: "in_progress", activeForm: "同期処理を修正中" },
	{ id: 3, subject: "PR を作る", status: "pending" },
];

/** 進捗が1件だけの基本のレポート */
export const baseReport = (id: string, start: string, end: string, first: string): Report =>
	report({ id, start: ms(start), end: ms(end), createdAt: ms(end), summary: { progress: [first], uncertainties: [], userActions: [] } }) as Report;

export const ESCAPE = String.fromCharCode(27);
/** 色の指定を取り除いた行 */
export const plain = (lines: readonly string[]): string[] => lines.map((line) => line.replaceAll(new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g"), ""));

/** "/a/b" と書いたパスを、実行している OS の区切りにする（Windows では "\\a\\b"）。テストを OS に依らず書くため */
export const native = (path: string): string => path.split("/").join(sep);
/** 絶対パスにしたもの（Windows ではドライブも付く）。本体が resolve を通す所の期待に使う */
export const absolute = (path: string): string => resolve(native(path));

/** メモリの上の偽のファイル。パスは "/a/b" の形で書いてよい。failure を入れると、書き込みがその例外で失敗する */
export function fakeFiles(initial: Record<string, string> = {}) {
	const stored = new Map(Object.entries(initial).map(([path, content]) => [native(path), content]));
	const writes: string[] = [];
	const files = {
		stored,
		writes,
		failure: undefined as Error | undefined,
		read: (path: string) => stored.get(path),
		/** ディレクトリの直下のファイル名。1つも無ければ、ディレクトリが無いものとして undefined */
		list: (directory: string) => {
			const names = [...stored.keys()].filter((path) => dirname(path) === native(directory)).map((path) => basename(path));
			return names.length === 0 ? undefined : names.sort();
		},
		/** 中身を "/a/b" の形のパスで見る・置く */
		at: (path: string) => stored.get(native(path)),
		put: (path: string, content: string) => void stored.set(native(path), content),
		write: (path: string, content: string) => {
			if (files.failure !== undefined) throw files.failure;
			writes.push(path);
			stored.set(path, content);
		},
	};
	return files;
}

/** 10:00 に頼まれ、テストを1回実行し、10:03 に直し終えたセッション */
export const session = () => [
	user("10:00", "同期の不具合を直して"),
	assistant("10:01", [thinking("まずテストを見る"), text("テストを実行します"), toolCall("bash", { command: "npm test" })]),
	toolResult("10:02", "bash", "51 passed"),
	assistant("10:03", [text("直しました")]),
];

export const report = (overrides: Record<string, unknown> = {}) => ({
	version: 1,
	id: "r1",
	level: 0,
	start: ms("10:00"),
	end: ms("10:15"),
	createdAt: ms("10:15"),
	toolCount: 3,
	children: [],
	summary: { progress: ["取り込みで備考が消える不具合を直した"], uncertainties: [], userActions: [] },
	...overrides,
});
