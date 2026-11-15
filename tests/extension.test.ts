import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/config.ts";
import { createExtension } from "../src/extension.ts";
import { REPORT_ENTRY_TYPE } from "../src/records.ts";
import { TASKS_ENTRY_TYPE } from "../src/todo-state.ts";
import { absolute, at, custom, fakeFiles, ms, native, plain, session, user } from "./fixtures.ts";

type Handler = (...values: unknown[]) => unknown;
const answer = (first: string) => ({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ progress: [first], uncertainties: [], userActions: [] }) }] });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const PAGE_PATH = absolute("/work/.pi/timeline/1101-1000-01a1d8af.html");

type ModelCall = { model: unknown; context: { systemPrompt: string; messages: Array<{ content: Array<{ text: string }> }> }; options: { signal: AbortSignal; maxTokens: number; reasoning?: string } };

/** 偽のモデルの登録簿。返答は差し替えられ、保留にもできる */
function fakeRegistry(state: { modelFound: boolean; hasAuth: boolean }) {
	const calls: ModelCall[] = [];
	let respond: (call: number) => Promise<unknown> = async () => answer("不具合を直した");
	return {
		calls,
		setRespond: (next: typeof respond) => { respond = next; },
		/** モデルの返答を、返された関数を呼ぶまで保留にする */
		holdResponse: () => {
			let release: (value: unknown) => void = () => {};
			respond = () => new Promise((resolve) => { release = resolve; });
			return (value: unknown) => release(value);
		},
		registry: {
			find: (provider: string, modelId: string) => (state.modelFound ? { provider, modelId } : undefined),
			hasConfiguredAuth: () => state.hasAuth,
			streamSimple: (model: unknown, modelContext: never, options: never) => {
				calls.push({ model, context: modelContext, options });
				const response = respond(calls.length);
				return { result: () => response };
			},
		},
	};
}

interface ToolResultLike {
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
}
interface ToolLike {
	name: string;
	executionMode: string;
	promptGuidelines: string[];
	parameters: { required: string[]; properties: Record<string, { enum?: string[] }> };
	prepareArguments(raw: unknown): unknown;
	execute(toolCallId: string, params: unknown, signal: undefined, onUpdate: undefined, context: unknown): Promise<ToolResultLike>;
}

/** 偽の画面。通知と、今出ているパネル、パネルを送った履歴を覚える */
function fakeScreen() {
	const notices: string[] = [];
	const widgets = new Map<string, string[]>();
	const widgetCalls: Array<{ key: string; lines: string[] | undefined }> = [];
	const failures = { widget: undefined as Error | undefined };
	const ui = {
		notify: (message: string) => void notices.push(message),
		setWidget: (key: string, lines: string[] | undefined) => {
			if (failures.widget !== undefined) throw failures.widget;
			widgetCalls.push({ key, lines });
			if (lines === undefined) widgets.delete(key);
			else widgets.set(key, lines);
		},
	};
	return { notices, widgets, widgetCalls, failures, ui };
}

/** 偽の pi。登録されたハンドラ・コマンド・ツールを覚え、記録の追加はセッションの記録の末尾に足す */
function fakeHost(branch: unknown[]) {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, { handler: Handler }>();
	const registeredTools = new Map<string, ToolLike>();
	const host = {
		on: (event: string, handler: Handler) => void handlers.set(event, handler),
		registerCommand: (name: string, options: { handler: Handler }) => void commands.set(name, options),
		registerTool: (definition: ToolLike) => void registeredTools.set(definition.name, definition),
		appendEntry: (customType: string, data: unknown) => void branch.push(custom("10:15", customType, data)),
	};
	return { handlers, commands, registeredTools, host };
}

function setup(rawConfig: unknown = { provider: "p", model: "m" }, clock = "10:15", piWebDirectory?: string) {
	const state = { now: ms(clock), hasUI: true, modelFound: true, hasAuth: true, branchFailure: undefined as Error | undefined };
	const branch: unknown[] = session();
	const { handlers, commands, registeredTools, host } = fakeHost(branch);
	const screen = fakeScreen();
	const files = fakeFiles();
	const model = fakeRegistry(state);
	const context = {
		get hasUI() { return state.hasUI; },
		cwd: "/work",
		sessionManager: {
			getBranch: () => {
				if (state.branchFailure !== undefined) throw state.branchFailure;
				return branch;
			},
			getSessionId: () => "01a1d8af-9c88-723c-8893-0ad7d50d7bea",
			getHeader: () => ({ timestamp: at("10:00") }),
			getSessionName: () => "同期の不具合",
		},
		ui: screen.ui,
		modelRegistry: model.registry,
	};
	let serial = 0;
	createExtension({ files, loadConfig: () => resolveConfig(rawConfig), configLocation: "/c/config.json", now: () => state.now, newId: () => `new${++serial}`, timeZone: "UTC", piWebDirectory })(host as never);
	const reports = () => branch.filter((entry) => (entry as { customType?: string }).customType === REPORT_ENTRY_TYPE);
	return {
		state, branch, reports, files,
		notices: screen.notices,
		panel: (key = "timeline") => plain(screen.widgets.get(key) ?? []),
		widgetCalls: screen.widgetCalls,
		screenFailures: screen.failures,
		sessionStart: () => handlers.get("session_start")?.({ type: "session_start" }, context),
		stored: files.stored,
		calls: model.calls,
		setRespond: model.setRespond,
		holdResponse: model.holdResponse,
		turnEnd: () => handlers.get("turn_end")?.({ type: "turn_end" }, context),
		shutdown: () => handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context),
		command: (argumentText = "") => commands.get("timeline")?.handler(argumentText, context),
		tool: (name = "todo") => registeredTools.get(name),
		/** モデルが todo ツールを呼んだのと同じ形で実行する */
		todo: (params: Record<string, unknown>) => registeredTools.get("todo")?.execute("call", params, undefined, undefined, context) as Promise<ToolResultLike>,
		entriesOf: (customType: string) => branch.filter((entry) => (entry as { customType?: string }).customType === customType) as Array<{ data: Record<string, unknown> }>,
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
	assert.equal(call.options.maxTokens, 4000);
	assert.equal(call.options.signal.aborted, false);
});

test("思考の強さを設定してあれば依頼に付け、無ければ付けない", async () => {
	const plain = setup();
	plain.turnEnd();
	await flush();
	assert.equal("reasoning" in plain.calls[0].options, false);
	const tuned = setup({ provider: "p", model: "m", reasoning: "low" });
	tuned.turnEnd();
	await flush();
	assert.equal(tuned.calls[0].options.reasoning, "low");
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

test("モデルの返答に文が無ければ、直しを頼まず、記録もせず、その理由を残す", async () => {
	const pi = setup();
	pi.setRespond(async () => ({ role: "assistant", stopReason: "length", content: [{ type: "thinking", thinking: "考えている途中で上限に達した" }] }));
	pi.turnEnd();
	await flush();
	assert.equal(pi.calls.length, 1, "中身の無い返答を直させると、中身の無いレポートができる");
	assert.equal(pi.reports().length, 0);
	await pi.command();
	assert.match(pi.notices.at(-1) ?? "", /モデルの返答に文がありません（length）/);
});

test("出力の上限で途中で切れた返答は、文があっても失敗にし、上限を上げるよう知らせる", async () => {
	const pi = setup();
	pi.setRespond(async () => ({ role: "assistant", stopReason: "length", content: [{ type: "text", text: '{"progress":["途中まで' }] }));
	pi.turnEnd();
	await flush();
	assert.equal(pi.calls.length, 1);
	assert.equal(pi.reports().length, 0);
	await pi.command();
	assert.match(pi.notices.at(-1) ?? "", /出力の上限に達して途中で切れました。maxOutputTokens を上げるか、reasoning を下げてください/);
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
		"",
		`ページ: ${PAGE_PATH}`,
	]);
});

test("ターンの終わりごとに、タスクとレポートのページをセッションごとのファイルに書き出す", async () => {
	const pi = setup(undefined, "10:05");
	pi.turnEnd();
	await flush();
	const page = pi.stored.get(PAGE_PATH) ?? "";
	assert.match(page, /<h1>タイムライン<\/h1><div class="sub">同期の不具合<\/div>/);
	assert.match(page, /タスクはまだありません/);
	assert.match(page, /レポートはまだありません/);
	assert.match(page, /記録の最後 10:03/);
});

test("レポートができたら、それを入れてページを書き直す", async () => {
	const pi = setup();
	pi.turnEnd();
	await flush();
	assert.match(pi.stored.get(PAGE_PATH) ?? "", /<div class="lead">不具合を直した<\/div>/);
});

test("ページを切ってあれば書き出さず、/timeline にも場所を添えない", async () => {
	const pi = setup({ provider: "p", model: "m", page: false });
	pi.turnEnd();
	await flush();
	await pi.command();
	assert.equal(pi.stored.size, 0);
	assert.doesNotMatch(pi.notices.at(-1) ?? "", /ページ/);
});

test("ページを書き出せなくても、レポートは作り、/timeline で理由を示す", async () => {
	const pi = setup();
	pi.files.failure = new Error("書き込めない場所");
	assert.equal(pi.turnEnd(), undefined);
	await flush();
	assert.equal(pi.reports().length, 1);
	await pi.command();
	assert.match(pi.notices.at(-1) ?? "", /ページを書き出せませんでした: 書き込めない場所/);
});

test("追跡の対象から外す処理が失敗しても、ページは書き、その処理は繰り返さない", async () => {
	const pi = setup(undefined, "10:05");
	let excludeReads = 0;
	const read = pi.files.read;
	pi.files.read = (path: string) => {
		if (!path.endsWith(native("/.git/info/exclude"))) return read(path);
		excludeReads++;
		throw new Error("EACCES: 読めない");
	};
	pi.turnEnd();
	pi.turnEnd();
	await flush();
	assert.match(pi.stored.get(PAGE_PATH) ?? "", /タイムライン/);
	assert.equal(excludeReads, 1);
	await pi.command();
	assert.doesNotMatch(pi.notices.at(-1) ?? "", /ページを書き出せませんでした/);
});

test("作業ディレクトリが git の作業ツリーなら、ページの置き場を追跡の対象から外す", async () => {
	const pi = setup(undefined, "10:05");
	pi.files.put("/work/.git/info/exclude", "*.log\n");
	pi.turnEnd();
	pi.turnEnd();
	await flush();
	assert.equal(pi.files.at("/work/.git/info/exclude"), "*.log\n/.pi/timeline/\n");
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

test("ターンの終わりに、下のボタンから開くパネルを今の状態にする", async () => {
	const pi = setup(undefined, "10:05");
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	pi.turnEnd();
	await flush();
	assert.deepEqual(pi.panel(), ["進捗 ░░░░░░░░░░░░░░░░░░░░ 0%  0/1 完了 · 経過 3分", "今   #1 不具合を直す（修正中）", "", "◐ #1 不具合を直す"]);
});

test("レポートができたら、タスクとは別のボタン（reports）のパネルに出す", async () => {
	const pi = setup();
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	pi.turnEnd();
	await flush();
	assert.deepEqual(pi.panel("reports"), ["15分 10:00–10:03  ツール 1 回", "  ・不具合を直した", "", `ページ ${PAGE_PATH}`]);
	assert.equal(pi.panel("timeline").some((line) => line.includes("不具合を直した")), false);
	assert.deepEqual([...new Set(pi.widgetCalls.map((call) => call.key))], ["timeline", "reports"]);
});

test("中身が変わらなければパネルを送り直さず、タスクもレポートも無ければ出さない", async () => {
	const empty = setup(undefined, "10:05");
	empty.turnEnd();
	await flush();
	assert.deepEqual(empty.widgetCalls, []);
	const pi = setup(undefined, "10:05");
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	pi.turnEnd();
	pi.turnEnd();
	await flush();
	assert.equal(pi.widgetCalls.length, 1);
});

test("出していたパネルは、タスクが無くなったら消す", async () => {
	const pi = setup(undefined, "10:05");
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	pi.turnEnd();
	pi.branch.push(custom("10:05", "rpiv-todo-state", { tasks: [], nextId: 2 }));
	pi.turnEnd();
	await flush();
	assert.deepEqual(pi.widgetCalls.at(-1), { key: "timeline", lines: undefined });
	assert.deepEqual(pi.panel(), []);
});

test("セッションを開いたときにもパネルを出し、閉じたら両方とも消す", async () => {
	const pi = setup();
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	pi.sessionStart();
	assert.equal(pi.panel()[1], "今   #1 不具合を直す（修正中）");
	pi.turnEnd();
	await flush();
	assert.equal(pi.panel("reports").length > 0, true);
	pi.shutdown();
	assert.deepEqual([pi.panel("timeline"), pi.panel("reports")], [[], []]);
});

test("パネルを切ってあるか、画面の無い実行なら、パネルを出さない", async () => {
	const off = setup({ provider: "p", model: "m", panel: false }, "10:05");
	off.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	off.turnEnd();
	const headless = setup(undefined, "10:05");
	headless.state.hasUI = false;
	headless.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	headless.sessionStart();
	headless.turnEnd();
	await flush();
	assert.deepEqual([...off.widgetCalls, ...headless.widgetCalls], []);
});

test("パネルを送れなくても、ターンの終わりとレポートの作成は止めず、できたレポートは知らせる", async () => {
	const pi = setup();
	pi.screenFailures.widget = new Error("画面に送れない");
	assert.equal(pi.turnEnd(), undefined);
	await flush();
	assert.equal(pi.reports().length, 1);
	assert.deepEqual(pi.notices, ["タイムライン 15分 10:00–10:03: 不具合を直した"]);
	await pi.command();
	assert.doesNotMatch(pi.notices.at(-1) ?? "", /作れませんでした/);
});

test("パネルを送れなかったときは、次の機会に送り直す", async () => {
	const pi = setup(undefined, "10:05");
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	pi.screenFailures.widget = new Error("画面に送れない");
	pi.turnEnd();
	pi.screenFailures.widget = undefined;
	pi.turnEnd();
	await flush();
	assert.equal(pi.panel()[1], "今   #1 不具合を直す（修正中）");
});

test("セッションの記録を読めなくても、ターンの終わりを例外にしない", async () => {
	const pi = setup();
	pi.state.branchFailure = new Error("記録を読めない");
	assert.equal(pi.turnEnd(), undefined);
	await flush();
	assert.equal(pi.reports().length, 0);
});

test("セッションを閉じた後は、/timeline を実行しても、パネルを出し直さず、ページも書かない", async () => {
	const pi = setup(undefined, "10:05");
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", status: "in_progress", activeForm: "修正中" }], nextId: 2 }));
	pi.sessionStart();
	pi.shutdown();
	const writesBefore = pi.files.writes.length;
	await pi.command();
	assert.deepEqual(pi.panel(), []);
	assert.deepEqual(pi.widgetCalls.at(-1), { key: "timeline", lines: undefined });
	assert.equal(pi.files.writes.length, writesBefore);
});

test("todo という名前のツールを登録する。操作の種類は必須で、同時には走らせない", () => {
	const tool = setup().tool();
	assert.ok(tool !== undefined);
	assert.deepEqual(tool.parameters.required, ["action"]);
	assert.deepEqual(tool.parameters.properties.action.enum, ["create", "update", "list", "get", "delete", "clear"]);
	assert.deepEqual(tool.parameters.properties.status.enum, ["pending", "in_progress", "completed", "deleted"]);
	assert.equal(tool.executionMode, "sequential");
	assert.ok(tool.promptGuidelines.some((line) => /one-line result in 日本語/.test(line)), "完了のときに結果を1行書かせる");
});

test("作成すると、状態をセッションに記録し、結果の文を返し、ターンの終わりを待たずにパネルを更新する", async () => {
	const pi = setup(undefined, "10:05");
	const result = await pi.todo({ action: "create", tasks: [{ subject: "再現する" }, { subject: "直す" }] });
	assert.equal(result.content[0].text, "Created #1: 再現する (pending)\nCreated #2: 直す (pending)");
	const recorded = pi.entriesOf(TASKS_ENTRY_TYPE);
	assert.equal(recorded.length, 1);
	assert.deepEqual([recorded[0].data.action, recorded[0].data.nextId, (recorded[0].data.tasks as unknown[]).length], ["create", 3, 2]);
	assert.deepEqual(result.details, recorded[0].data);
	assert.equal(pi.panel()[0], "進捗 ░░░░░░░░░░░░░░░░░░░░ 0%  0/2 完了 · 経過 3分");
});

test("続けて呼ぶと、前の呼び出しで記録した状態を踏まえる", async () => {
	const pi = setup(undefined, "10:05");
	await pi.todo({ action: "create", subject: "再現する" });
	const result = await pi.todo({ action: "update", id: 1, status: "in_progress", activeForm: "手順を確認中" });
	assert.equal(result.content[0].text, "Updated #1 (pending → in_progress)");
	assert.equal(pi.panel()[1], "今   #1 再現する（手順を確認中）");
	assert.equal(pi.entriesOf(TASKS_ENTRY_TYPE).length, 2);
});

test("rpiv-todo の記録があるセッションでは、その続きから番号を振る", async () => {
	const pi = setup(undefined, "10:05");
	pi.branch.push(custom("10:04", "rpiv-todo-state", { tasks: [{ id: 1, subject: "前に作った", status: "completed" }, { id: 2, subject: "途中", status: "in_progress" }], nextId: 3 }));
	const result = await pi.todo({ action: "create", subject: "続き" });
	assert.equal(result.content[0].text, "Created #3: 続き (pending)");
});

test("できない操作は、記録せず、失敗として理由を返す。一覧や詳細も記録しない", async () => {
	const pi = setup(undefined, "10:05");
	const failed = await pi.todo({ action: "update", id: 9, status: "completed" });
	assert.deepEqual([failed.content[0].text, failed.isError, failed.details.error], ["Error: #9 not found", true, "#9 not found"]);
	const listed = await pi.todo({ action: "list" });
	assert.deepEqual([listed.content[0].text, listed.isError], ["No tasks", undefined]);
	assert.equal(pi.entriesOf(TASKS_ENTRY_TYPE).length, 0);
});

test("画面の無い実行でもツールは動き、記録するが、パネルは出さない", async () => {
	const pi = setup(undefined, "10:05");
	pi.state.hasUI = false;
	const result = await pi.todo({ action: "create", subject: "再現する" });
	assert.equal(result.content[0].text, "Created #1: 再現する (pending)");
	assert.equal(pi.entriesOf(TASKS_ENTRY_TYPE).length, 1);
	assert.deepEqual(pi.widgetCalls, []);
});

test("モデルが tasks を JSON の文字列で渡してきても、配列に直して受け取る", () => {
	const tool = setup().tool();
	assert.deepEqual(tool?.prepareArguments({ action: "create", tasks: '[{"subject":"再現する"}]' }), { action: "create", tasks: [{ subject: "再現する" }] });
	assert.deepEqual(tool?.prepareArguments({ action: "create", tasks: "配列ではない" }), { action: "create", tasks: "配列ではない" });
	assert.deepEqual(tool?.prepareArguments({ action: "list" }), { action: "list" });
});

test("todoTool を切ってあれば、ツールを登録しない（別の拡張の todo と一緒に使うとき）", () => {
	assert.equal(setup({ provider: "p", model: "m", todoTool: false }).tool(), undefined);
});

const PI_WEB = "/web";
const PI_WEB_CSS = "/web/.next/static/css/main.css";
const PI_WEB_LAYOUT = "/web/.next/static/chunks/app/layout-abc.js";
const PANEL_CSS = ".extension-widget-panels{max-height:min(144px,18dvh)}";
const LAYOUT_CHUNK = "(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[7177],{}]);";

/** Pi Web の中で動いている拡張。Pi Web の置き場に、パネルの CSS と画面の共通部分のチャンクがある */
function insidePiWeb(rawConfig: unknown = { provider: "p", model: "m" }) {
	const pi = setup(rawConfig, "10:15", absolute(PI_WEB));
	pi.files.put("/web/package.json", JSON.stringify({ name: "@agegr/pi-web", version: "0.15.0" }));
	pi.files.put(PI_WEB_CSS, PANEL_CSS);
	pi.files.put(PI_WEB_LAYOUT, LAYOUT_CHUNK);
	return pi;
}
const piWebNotices = (notices: readonly string[]) => notices.filter((notice) => notice.includes("Pi Web"));

test("Pi Web の中で動いていれば、セッションの始まりに小窓と高さの上書きを足し、再読み込みを1度だけ促す", async () => {
	const pi = insidePiWeb();
	await pi.sessionStart();
	assert.match(pi.files.at(PI_WEB_LAYOUT) ?? "", /installPopup\(window\)/);
	assert.match(pi.files.at(PI_WEB_CSS) ?? "", /max-height:50dvh/);
	assert.equal(piWebNotices(pi.notices).length, 1);
	assert.match(piWebNotices(pi.notices)[0] ?? "", /Ctrl\+Shift\+R/);
	await pi.sessionStart();
	assert.equal(piWebNotices(pi.notices).length, 1, "入っていれば書かず、知らせもしない");
});

test("設定で小窓を切ってあれば、入っている小窓のスクリプトを外す", async () => {
	const pi = insidePiWeb({ provider: "p", model: "m", webPopup: false });
	pi.files.put(PI_WEB_LAYOUT, LAYOUT_CHUNK + "\n/* pi-todo-timeline:start */\n;installPopup(window);\n/* pi-todo-timeline:end */\n");
	await pi.sessionStart();
	assert.equal(pi.files.at(PI_WEB_LAYOUT), LAYOUT_CHUNK);
});

test("Pi Web の中でなければ、Pi Web のファイルには触らない", async () => {
	const pi = setup({ provider: "p", model: "m" }, "10:15", absolute("/work"));
	pi.files.put("/work/package.json", JSON.stringify({ name: "my-app" }));
	pi.files.put("/work/.next/static/css/main.css", PANEL_CSS);
	await pi.sessionStart();
	assert.equal(pi.files.at("/work/.next/static/css/main.css"), PANEL_CSS);
	assert.deepEqual(piWebNotices(pi.notices), []);
});

test("Pi Web のファイルに書けなくても、ページは書き、理由を1度だけ知らせる", async () => {
	const pi = insidePiWeb();
	const write = pi.files.write;
	pi.files.write = (path: string, content: string) => {
		if (path.startsWith(native(absolute(PI_WEB)))) throw new Error("EACCES: permission denied");
		write(path, content);
	};
	await pi.sessionStart();
	await pi.sessionStart();
	assert.ok(pi.files.at(PAGE_PATH) !== undefined, "ページは書く");
	assert.equal(piWebNotices(pi.notices).length, 1);
	assert.match(piWebNotices(pi.notices)[0] ?? "", /EACCES/);
});
