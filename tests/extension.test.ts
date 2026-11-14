import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/config.ts";
import { createExtension } from "../src/extension.ts";
import { REPORT_ENTRY_TYPE } from "../src/records.ts";
import { custom, ms, session, user } from "./fixtures.ts";

type Handler = (...values: unknown[]) => unknown;
const answer = (first: string) => ({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ progress: [first], uncertainties: [], userActions: [] }) }] });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(rawConfig: unknown = { provider: "p", model: "m" }, clock = "10:15") {
	const state = { now: ms(clock), hasUI: true, modelFound: true, hasAuth: true };
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, { handler: Handler }>();
	const branch: unknown[] = session();
	const notices: string[] = [];
	const calls: Array<{ model: unknown; context: { systemPrompt: string; messages: Array<{ content: Array<{ text: string }> }> }; options: { signal: AbortSignal; maxTokens: number } }> = [];
	let respond: (call: number) => Promise<unknown> = async () => answer("不具合を直した");
	const host = {
		on: (event: string, handler: Handler) => void handlers.set(event, handler),
		registerCommand: (name: string, options: { handler: Handler }) => void commands.set(name, options),
		appendEntry: (customType: string, data: unknown) => void branch.push(custom("10:15", customType, data)),
	};
	const context = {
		get hasUI() { return state.hasUI; },
		sessionManager: { getBranch: () => branch },
		ui: { notify: (message: string) => void notices.push(message) },
		modelRegistry: {
			find: (provider: string, modelId: string) => (state.modelFound ? { provider, modelId } : undefined),
			hasConfiguredAuth: () => state.hasAuth,
			complete: (model: unknown, modelContext: never, options: never) => {
				calls.push({ model, context: modelContext, options });
				return respond(calls.length);
			},
		},
	};
	let serial = 0;
	createExtension({ loadConfig: () => resolveConfig(rawConfig), configLocation: "/c/config.json", now: () => state.now, newId: () => `new${++serial}`, timeZone: "UTC" })(host as never);
	const reports = () => branch.filter((entry) => (entry as { customType?: string }).customType === REPORT_ENTRY_TYPE);
	return {
		state, branch, notices, calls, reports,
		setRespond: (next: typeof respond) => { respond = next; },
		/** モデルの返答を、返された関数を呼ぶまで保留にする */
		holdResponse: () => {
			let release: (value: unknown) => void = () => {};
			respond = () => new Promise((resolve) => { release = resolve; });
			return (value: unknown) => release(value);
		},
		turnEnd: () => handlers.get("turn_end")?.({ type: "turn_end" }, context),
		shutdown: () => handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context),
		command: (argumentText = "") => commands.get("timeline")?.handler(argumentText, context),
	};
}

test("ターンの終わりに期限が来ていれば、設定したモデルに頼み、レポートを記録して1件目を知らせる", async () => {
	const pi = setup();
	assert.equal(pi.turnEnd(), undefined, "ターンの終わりを待たせない");
	await flush();
	assert.equal(pi.reports().length, 1);
	assert.deepEqual(pi.notices, ["タイムライン 15分 10:00–10:03: 不具合を直した"]);
	const call = pi.calls[0];
	assert.deepEqual(call.model, { provider: "p", modelId: "m" });
	assert.match(call.context.systemPrompt, /Return only JSON/);
	assert.match(call.context.messages[0].content[0].text, /同期の不具合を直して/);
	assert.equal(call.options.maxTokens, 2000);
	assert.equal(call.options.signal.aborted, false);
});

test("期限の前のターンでは、モデルに頼まない", async () => {
	const pi = setup(undefined, "10:14");
	pi.turnEnd();
	await flush();
	assert.equal(pi.calls.length, 0);
});

test("画面の無い実行（子の pi など）では何もしない", async () => {
	const pi = setup();
	pi.state.hasUI = false;
	pi.turnEnd();
	await flush();
	assert.equal(pi.calls.length, 0);
});

test("無効にしてあるか、モデルが未設定なら、作らずに /timeline で理由を示す", async () => {
	const disabled = setup({ provider: "p", model: "m", enabled: false });
	disabled.turnEnd();
	await flush();
	assert.equal(disabled.calls.length, 0);
	const unset = setup({});
	unset.turnEnd();
	await flush();
	assert.equal(unset.calls.length, 0);
	await unset.command();
	assert.match(unset.notices.at(-1) ?? "", /\/c\/config\.json に provider と model を書いてください/);
});

test("モデルが見つからないか、認証が無ければ、作らずに /timeline で理由を示す", async () => {
	const missing = setup();
	missing.state.modelFound = false;
	missing.turnEnd();
	await flush();
	await missing.command();
	assert.equal(missing.calls.length, 0);
	assert.match(missing.notices.at(-1) ?? "", /p\/m が見つかりません/);
	const noAuth = setup();
	noAuth.state.hasAuth = false;
	await noAuth.command();
	assert.match(noAuth.notices.at(-1) ?? "", /p\/m の認証が設定されていません/);
});

test("作っている最中に次のターンが終わっても、重ねて頼まない", async () => {
	const pi = setup();
	const release = pi.holdResponse();
	pi.turnEnd();
	await flush();
	pi.turnEnd();
	await flush();
	assert.equal(pi.calls.length, 1);
	release(answer("不具合を直した"));
	await flush();
	assert.equal(pi.reports().length, 1);
});

test("作っている最中に /timeline now が2回届いても、同じ記録を覆うレポートを二重に作らない", async () => {
	const pi = setup();
	const release = pi.holdResponse();
	pi.turnEnd();
	await flush();
	const commands = [pi.command("now"), pi.command("now")];
	pi.branch.push(user("10:14", "追加で頼む"));
	pi.setRespond(async () => answer("追加を済ませた"));
	release(answer("不具合を直した"));
	await Promise.all(commands);
	const ranges = pi.reports().map((entry) => {
		const { start, end } = (entry as { data: { start: number; end: number } }).data;
		return [start, end];
	});
	assert.deepEqual(ranges, [[ms("10:00"), ms("10:03")], [ms("10:14"), ms("10:14")]]);
	assert.equal(pi.calls.length, 2);
});

test("失敗した後はしばらく頼まず、5分経てばまた頼む", async () => {
	const pi = setup();
	pi.setRespond(async () => { throw new Error("接続できない"); });
	pi.turnEnd();
	await flush();
	pi.turnEnd();
	await flush();
	assert.equal(pi.calls.length, 1);
	assert.equal(pi.reports().length, 0);
	pi.state.now += 5 * 60_000;
	pi.turnEnd();
	await flush();
	assert.equal(pi.calls.length, 2);
	await pi.command();
	assert.match(pi.notices.at(-1) ?? "", /直近のレポートは作れませんでした: 接続できない/);
});

test("モデルが失敗を返したら、記録せず、その理由を残す", async () => {
	const pi = setup();
	pi.setRespond(async () => ({ role: "assistant", stopReason: "error", errorMessage: "429 上限", content: [] }));
	pi.turnEnd();
	await flush();
	assert.equal(pi.reports().length, 0);
	await pi.command();
	assert.match(pi.notices.at(-1) ?? "", /429 上限/);
});

test("/timeline は、タスクとレポートをまとめて表示する", async () => {
	const pi = setup();
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "completed", description: "51 件が合格" }], nextId: 2 }));
	pi.turnEnd();
	await flush();
	await pi.command();
	assert.deepEqual((pi.notices.at(-1) ?? "").split("\n"), [
		"タイムライン",
		"タスク 1/1 完了",
		"  ✓ #1 不具合を直す",
		"      51 件が合格",
		"",
		"レポート",
		"  15分 10:00–10:03（ツール 1 回）",
		"    ・不具合を直した",
	]);
});

test("/timeline now は、期限の前でもレポートを作ってから表示する", async () => {
	const pi = setup(undefined, "10:05");
	await pi.command(" now ");
	assert.equal(pi.reports().length, 1);
	assert.match(pi.notices.at(-1) ?? "", /・不具合を直した/);
});

test("セッションを閉じたら、進行中の依頼を中断し、後から届いた結果は記録しない", async () => {
	const pi = setup();
	const release = pi.holdResponse();
	pi.turnEnd();
	await flush();
	pi.shutdown();
	assert.equal(pi.calls[0].options.signal.aborted, true);
	release(answer("不具合を直した"));
	await flush();
	assert.equal(pi.reports().length, 0);
	assert.deepEqual(pi.notices, []);
});

test("通知を切ってあれば、レポートを作っても知らせない", async () => {
	const pi = setup({ provider: "p", model: "m", notify: false });
	pi.turnEnd();
	await flush();
	assert.equal(pi.reports().length, 1);
	assert.deepEqual(pi.notices, []);
});

test("設定ファイルに使えない値があれば、/timeline に添える", async () => {
	const pi = setup({ provider: "p", model: "m", intervalMinutes: 0 });
	await pi.command();
	assert.match(pi.notices.at(-1) ?? "", /intervalMinutes は 1〜1440 の整数で書く/);
});
