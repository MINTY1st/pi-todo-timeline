import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBaseRequest, buildRepairRequest, buildRollupRequest, parseSummary } from "../src/prompt.ts";
import type { Report } from "../src/records.ts";
import { ms, report } from "./fixtures.ts";

const summary = { progress: ["備考が消える不具合を直した", "単体テスト 51 件が合格"], uncertainties: ["旧形式の行を移すか未定"], userActions: [] };
const settings = { language: "日本語", maxLineChars: 160, focus: "何が変わり、目的にどう影響するかを書く" };

test("モデルの返した JSON を要約として受け取る（コードの囲みが付いていてもよい）", () => {
	assert.deepEqual(parseSummary(JSON.stringify(summary), 160), summary);
	assert.deepEqual(parseSummary("```json\n" + JSON.stringify(summary) + "\n```", 160), summary);
});

test("JSON の前後に文が付いていても、JSON の部分を読む", () => {
	assert.deepEqual(parseSummary("レポートです。\n" + JSON.stringify(summary) + "\n以上です。", 160), summary);
});

test("各行の改行は空白に、コードの記法は外して受け取り、知らない欄は捨てる", () => {
	const parsed = parseSummary(JSON.stringify({ progress: [" `src/sync.ts` を\n直した "], uncertainties: [], userActions: [], note: "余計" }), 160);
	assert.deepEqual(parsed, { progress: ["src/sync.ts を 直した"], uncertainties: [], userActions: [] });
});

test("欄が省かれていれば空として扱う", () => {
	assert.deepEqual(parseSummary(JSON.stringify({ progress: ["直した"] }), 160), { progress: ["直した"], uncertainties: [], userActions: [] });
});

test("件数や長さの決まりを満たさない要約は、理由を示して拒む", () => {
	assert.throws(() => parseSummary("JSON ではない", 160), /JSON/);
	assert.throws(() => parseSummary(JSON.stringify({ progress: [] }), 160), /progress.*1〜4/);
	assert.throws(() => parseSummary(JSON.stringify({ progress: ["a", "b", "c", "d", "e"] }), 160), /progress.*1〜4/);
	assert.throws(() => parseSummary(JSON.stringify({ progress: ["a"], uncertainties: ["1", "2", "3"] }), 160), /uncertainties.*2/);
	assert.throws(() => parseSummary(JSON.stringify({ progress: ["あ".repeat(161)] }), 160), /progress\[0\].*160/);
	assert.throws(() => parseSummary(JSON.stringify({ progress: [42] }), 160), /progress\[0\]/);
});

test("基本のレポートの依頼には、期間・記録・前回の要約・タスクの状態・言語を入れる", () => {
	const request = buildBaseRequest({
		start: ms("10:00"),
		end: ms("10:15"),
		deltaText: "[10:00] ユーザー: 同期の不具合を直して",
		previous: summary,
		taskLines: ["✓ #1 不具合を再現する"],
		settings,
	});
	assert.match(request.system, /Return only JSON/);
	assert.match(request.system, /日本語/);
	assert.match(request.system, /160/);
	assert.match(request.user, /2030-11-01T10:00:00.000Z to 2030-11-01T10:15:00.000Z/);
	assert.match(request.user, /何が変わり、目的にどう影響するかを書く/);
	assert.match(request.user, /\[10:00\] ユーザー: 同期の不具合を直して/);
	assert.match(request.user, /備考が消える不具合を直した/);
	assert.match(request.user, /✓ #1 不具合を再現する/);
});

test("前回の要約やタスクが無ければ、その見出しごと省く", () => {
	const request = buildBaseRequest({ start: ms("10:00"), end: ms("10:15"), deltaText: "記録", previous: undefined, taskLines: [], settings });
	assert.doesNotMatch(request.user, /Previous summary/);
	assert.doesNotMatch(request.user, /Task list/);
});

test("束ねるレポートの依頼には、子のレポートの期間と要約だけを入れる", () => {
	const children = [report({ id: "a" }), report({ id: "b", start: ms("10:15"), end: ms("10:30"), summary: { progress: ["PR を作った"], uncertainties: [], userActions: [] } })] as Report[];
	const request = buildRollupRequest({ children, settings });
	assert.match(request.system, /Return only JSON/);
	assert.match(request.user, /2030-11-01T10:00:00.000Z to 2030-11-01T10:30:00.000Z/);
	assert.match(request.user, /取り込みで備考が消える不具合を直した/);
	assert.match(request.user, /PR を作った/);
});

test("直しの依頼には、決まりに合わなかった理由と元の草稿を入れる", () => {
	const request = buildRepairRequest({ draft: "{\"progress\":[]}", issue: "progress は 1〜4 件", settings });
	assert.match(request.system, /Return only JSON/);
	assert.match(request.user, /progress は 1〜4 件/);
	assert.match(request.user, /\{\\"progress\\":\[\]\}/);
});
