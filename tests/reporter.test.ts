import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/config.ts";
import type { ModelRequest } from "../src/prompt.ts";
import { REPORT_ENTRY_TYPE } from "../src/records.ts";
import { produceReports } from "../src/reporter.ts";
import { assistant, custom, ms, report, session, text, toolCall, user } from "./fixtures.ts";

const config = resolveConfig({ provider: "p", model: "m" }).config;
const answer = (first: string) => JSON.stringify({ progress: [first], uncertainties: [], userActions: [] });
const saved = (id: string, start: string, end: string, toolCount = 2) => custom(end, REPORT_ENTRY_TYPE, report({ id, start: ms(start), end: ms(end), createdAt: ms(end), toolCount }));

function fakeModel(answers: Array<string | Error>, clock: string) {
	const requests: ModelRequest[] = [];
	let serial = 0;
	const dependencies = {
		now: () => ms(clock),
		newId: () => `new${++serial}`,
		complete: async (request: ModelRequest) => {
			requests.push(request);
			const next = answers.shift();
			if (next === undefined) throw new Error("想定より多く呼ばれた");
			if (next instanceof Error) throw next;
			return next;
		},
	};
	return { requests, dependencies };
}
const run = (entries: unknown[], model: ReturnType<typeof fakeModel>, force = false, settings = config) => produceReports({ entries, config: settings, force }, model.dependencies, new AbortController().signal);
/** 発言が1件しか入らない上限。記録が切れて次回に持ち越す状況を作る */
const oneItemOnly = { ...config, maxInputChars: 60 };
const todoState = (clock: string, task: Record<string, unknown>) => custom(clock, "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を直す", ...task }], nextId: 2 });

test("まだ報告していない活動が間隔に満たなければ、モデルを呼ばない", async () => {
	const model = fakeModel([], "10:14");
	assert.deepEqual(await run(session(), model), { reports: [], error: undefined });
	assert.equal(model.requests.length, 0);
});

test("期限が来たら、前回より後の記録を渡して基本のレポートを1件作る", async () => {
	const model = fakeModel([answer("不具合を直した")], "10:15");
	const result = await run(session(), model);
	assert.deepEqual(result.reports, [{ version: 1, id: "new1", level: 0, start: ms("10:00"), end: ms("10:03"), createdAt: ms("10:15"), toolCount: 1, children: [], summary: { progress: ["不具合を直した"], uncertainties: [], userActions: [] } }]);
	assert.match(model.requests[0].user, /\[10:00\] ユーザー: 同期の不具合を直して/);
	assert.doesNotMatch(model.requests[0].user, /Previous summary/);
});

test("2件目からは、前回のレポートが覆った後の記録と、前回の要約を渡す", async () => {
	const entries = [...session(), saved("a", "10:00", "10:03"), user("10:20", "PR も作って"), assistant("10:21", [text("作りました")])];
	const model = fakeModel([answer("PR を作った")], "10:35");
	const result = await run(entries, model);
	assert.equal(result.reports[0].start, ms("10:20"));
	assert.doesNotMatch(model.requests[0].user, /同期の不具合を直して/);
	assert.match(model.requests[0].user, /PR も作って/);
	assert.match(model.requests[0].user, /Previous summary[\s\S]*取り込みで備考が消える不具合を直した/);
});

test("タスクの記録があれば、今の状態を依頼に添える", async () => {
	const todo = custom("10:01", "rpiv-todo-state", { tasks: [{ id: 1, subject: "不具合を再現する", status: "completed", description: "失敗するテストを足した" }], nextId: 2 });
	const model = fakeModel([answer("直した")], "10:15");
	await run([...session(), todo], model);
	assert.match(model.requests[0].user, /✓ #1 不具合を再現する/);
});

test("記録が上限で切れたときは、タスクも切れ目の時点の状態を添え、その後の状態を混ぜない", async () => {
	const entries = [todoState("09:59", { status: "in_progress" }), user("10:00", "あ".repeat(30)), user("10:20", "い".repeat(30)), todoState("10:30", { status: "completed", description: "後で完了した" })];
	const model = fakeModel([answer("途中まで")], "10:40");
	const result = await run(entries, model, false, oneItemOnly);
	assert.equal(result.reports[0].end, ms("10:00"));
	assert.match(model.requests[0].user, /◐ #1 不具合を直す/);
	assert.doesNotMatch(model.requests[0].user, /後で完了した/);
});

test("記録が上限で切れて報告が追いついていない間は、束ねる期限が来ていても束ねない", async () => {
	const entries = [saved("a", "09:00", "09:15"), user("10:00", "あ".repeat(30)), user("10:20", "い".repeat(30))];
	const model = fakeModel([answer("途中まで")], "10:40");
	const result = await run(entries, model, false, oneItemOnly);
	assert.deepEqual(result.reports.map((item) => item.level), [0]);
	assert.equal(model.requests.length, 1);
});

test("今すぐ作る指定なら期限の前でも作るが、報告していない活動が無ければ作らない", async () => {
	const forced = fakeModel([answer("直した")], "10:05");
	assert.equal((await run(session(), forced, true)).reports.length, 1);
	const nothing = fakeModel([], "10:05");
	assert.deepEqual(await run([...session(), saved("a", "10:00", "10:03")], nothing, true), { reports: [], error: undefined });
});

test("返答が決まりに合わなければ、理由を付けて1回だけ直しを頼む", async () => {
	const model = fakeModel([JSON.stringify({ progress: [] }), answer("直した")], "10:15");
	const result = await run(session(), model);
	assert.equal(result.reports[0].summary.progress[0], "直した");
	assert.equal(model.requests.length, 2);
	assert.match(model.requests[1].user, /progress は 1〜4 件/);
});

test("直しても決まりに合わなければ、レポートを作らず理由を返す", async () => {
	const model = fakeModel([JSON.stringify({ progress: [] }), JSON.stringify({ progress: [] })], "10:15");
	const result = await run(session(), model);
	assert.deepEqual(result.reports, []);
	assert.match(result.error ?? "", /progress は 1〜4 件/);
	assert.equal(model.requests.length, 2);
});

test("JSON として読めない返答は、直しを頼まず失敗にする（元の中身が無いのに直させると、中身の無いレポートができる）", async () => {
	const model = fakeModel(['{"progress":["途中で切れ'], "10:15");
	const result = await run(session(), model);
	assert.deepEqual(result.reports, []);
	assert.match(result.error ?? "", /JSON として読めない/);
	assert.equal(model.requests.length, 1);
});

test("基本のレポートを足した結果、束ねる期限が来ていれば、続けて束ねたレポートを作る", async () => {
	const entries = [saved("a", "10:00", "10:15"), saved("b", "10:15", "10:30"), saved("c", "10:30", "10:45"), user("10:46", "仕上げて"), assistant("10:47", [toolCall("bash", {})])];
	const model = fakeModel([answer("仕上げた"), answer("1時間で不具合を直して仕上げた")], "11:01");
	const result = await run(entries, model);
	assert.deepEqual(result.reports.map((item) => [item.id, item.level]), [["new1", 0], ["new2", 1]]);
	const rollup = result.reports[1];
	assert.deepEqual(rollup.children, ["a", "b", "c", "new1"]);
	assert.deepEqual([rollup.start, rollup.end, rollup.toolCount], [ms("10:00"), ms("10:47"), 7]);
	assert.match(model.requests[1].user, /Child reports[\s\S]*仕上げた/);
	assert.doesNotMatch(model.requests[1].user, /仕上げて/, "束ねるときは元の記録を渡さない");
});

test("報告していない活動が無くても、束ねる期限が来ていれば束ねたレポートだけを作る", async () => {
	const entries = [saved("a", "10:00", "10:15"), saved("b", "10:15", "10:30")];
	const model = fakeModel([answer("まとめ")], "11:00");
	const result = await run(entries, model);
	assert.deepEqual(result.reports.map((item) => [item.level, item.children]), [[1, ["a", "b"]]]);
});

test("束ねる途中でモデルが失敗しても、先に作れた基本のレポートは返す", async () => {
	const entries = [saved("a", "10:00", "10:15"), user("10:46", "仕上げて")];
	const model = fakeModel([answer("仕上げた"), new Error("timeout")], "11:01");
	const result = await run(entries, model);
	assert.deepEqual(result.reports.map((item) => item.level), [0]);
	assert.match(result.error ?? "", /timeout/);
});
