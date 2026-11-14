// テストで使うセッションのエントリの組み立て
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

/** メモリの上の偽のファイル。failure を入れると、書き込みがその例外で失敗する */
export function fakeFiles(initial: Record<string, string> = {}) {
	const stored = new Map(Object.entries(initial));
	const writes: string[] = [];
	const files = {
		stored,
		writes,
		failure: undefined as Error | undefined,
		read: (path: string) => stored.get(path),
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
