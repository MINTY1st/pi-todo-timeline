import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTodo, emptyTodoState, stateFromBranch, TASKS_ENTRY_TYPE } from "../src/todo/state.ts";
import type { TodoParams, TodoState } from "../src/todo/state.ts";
import { custom, ESCAPE, ms } from "./fixtures.ts";

/** 操作を順に当てた後の状態と、最後の操作の結果 */
function play(steps: TodoParams[], start: TodoState = emptyTodoState()) {
	let state = start;
	let last = applyTodo(state, { action: "list" });
	for (const step of steps) {
		last = applyTodo(state, step);
		state = last.state;
	}
	return last;
}
const three: TodoParams = { action: "create", tasks: [{ subject: "再現する" }, { subject: "直す" }, { subject: "PR を作る" }] };

test("作成は番号を順に振り、未着手で足す。1件ずつでも、まとめてでも作れる", () => {
	const single = applyTodo(emptyTodoState(), { action: "create", subject: "再現する", description: "手順を残す" });
	assert.deepEqual(single.state, { tasks: [{ id: 1, subject: "再現する", status: "pending", description: "手順を残す" }], nextId: 2 });
	assert.deepEqual([single.text, single.changed, single.error], ["Created #1: 再現する (pending)", true, undefined]);
	const batch = applyTodo(single.state, { action: "create", tasks: [{ subject: "直す", activeForm: "修正中" }, { subject: "PR を作る" }] });
	assert.equal(batch.text, "Created #2: 直す (pending)\nCreated #3: PR を作る (pending)");
	assert.deepEqual(batch.state.tasks.map((task) => [task.id, task.activeForm]), [[1, undefined], [2, "修正中"], [3, undefined]]);
	assert.equal(batch.state.nextId, 4);
});

test("作成の指定が足りない・食い違うときは、状態を変えずに理由を返す", () => {
	const cases: Array<[TodoParams, RegExp]> = [
		[{ action: "create" }, /^Error: subject required for create$/],
		[{ action: "create", subject: "  " }, /subject required for create/],
		[{ action: "create", subject: "a", tasks: [{ subject: "b" }] }, /subject or tasks\[\], not both/],
		[{ action: "create", tasks: [] }, /tasks\[\] must be non-empty/],
		[{ action: "create", tasks: [{ subject: "a" }, { subject: "" }] }, /tasks\[1\]: subject required for create/],
		[{ action: "create", description: "上に書いた", tasks: [{ subject: "a" }] }, /takes description on each item, not at the top level/],
	];
	for (const [params, expected] of cases) {
		const outcome = applyTodo(emptyTodoState(), params);
		assert.match(outcome.text, expected);
		assert.deepEqual([outcome.changed, outcome.state, outcome.error !== undefined], [false, emptyTodoState(), true]);
	}
});

test("更新は状態の移り変わりを伝え、ほかの欄だけの変更や、変更が無いことも区別して伝える", () => {
	const started = play([three, { action: "update", id: 2, status: "in_progress", activeForm: "修正中" }]);
	assert.equal(started.text, "Updated #2 (pending → in_progress)");
	assert.deepEqual(started.state.tasks[1], { id: 2, subject: "直す", status: "in_progress", activeForm: "修正中" });
	const renamed = applyTodo(started.state, { action: "update", id: 2, subject: "直してテストする" });
	assert.equal(renamed.text, "Updated #2");
	const same = applyTodo(renamed.state, { action: "update", id: 2, status: "in_progress" });
	assert.deepEqual([same.text, same.changed], ["No change: #2 already matches the requested values (status: in_progress)", false]);
	const done = applyTodo(renamed.state, { action: "update", id: 2, status: "completed", description: "51 件が合格" });
	assert.equal(done.text, "Updated #2 (in_progress → completed)");
	assert.equal(done.state.tasks[1].description, "51 件が合格");
});

test("更新できないとき（番号が無い、変える欄が無い、戻せない状態）は、理由を返す", () => {
	const done = play([three, { action: "update", id: 1, status: "completed" }, { action: "delete", id: 3 }]).state;
	const cases: Array<[TodoParams, RegExp]> = [
		[{ action: "update", status: "completed" }, /id required for update/],
		[{ action: "update", id: 9, status: "completed" }, /#9 not found/],
		[{ action: "update", id: 2 }, /update requires at least one mutable field: subject, description, activeForm, status, addBlockedBy, or removeBlockedBy/],
		[{ action: "update", id: 1, status: "in_progress" }, /illegal transition completed → in_progress/],
		[{ action: "update", id: 3, status: "pending" }, /illegal transition deleted → pending/],
	];
	for (const [params, expected] of cases) {
		const outcome = applyTodo(done, params);
		assert.match(outcome.text, expected);
		assert.deepEqual([outcome.changed, outcome.state], [false, done]);
	}
	assert.equal(applyTodo(done, { action: "update", id: 1, status: "deleted" }).text, "Updated #1 (completed → deleted)");
});

test("待つ相手は、作成のときに決め、更新で足したり外したりできる。無い相手・消した相手・自分自身は指定できない", () => {
	const linked = play([three, { action: "update", id: 3, addBlockedBy: [1, 2] }, { action: "update", id: 3, removeBlockedBy: [1] }]);
	assert.deepEqual(linked.state.tasks[2].blockedBy, [2]);
	const created = applyTodo(linked.state, { action: "create", subject: "公開する", blockedBy: [3] });
	assert.deepEqual(created.state.tasks[3].blockedBy, [3]);
	const cleared = applyTodo(linked.state, { action: "update", id: 3, removeBlockedBy: [2] });
	assert.equal("blockedBy" in cleared.state.tasks[2], false);
	const deleted = applyTodo(linked.state, { action: "delete", id: 1 }).state;
	const cases: Array<[TodoParams, RegExp]> = [
		[{ action: "update", id: 2, addBlockedBy: [2] }, /cannot block #2 on itself/],
		[{ action: "update", id: 2, addBlockedBy: [9] }, /addBlockedBy: #9 not found/],
		[{ action: "update", id: 2, addBlockedBy: [1] }, /addBlockedBy: #1 is deleted/],
		[{ action: "create", subject: "x", blockedBy: [9] }, /blockedBy: #9 not found/],
		[{ action: "create", tasks: [{ subject: "x" }, { subject: "y", blockedBy: [4] }] }, /blockedBy: #4 is another item in this batch/],
	];
	for (const [params, expected] of cases) assert.match(applyTodo(deleted, params).text, expected);
});

test("同じ相手を何度足しても、待つ相手には1回だけ入る", () => {
	const twice = play([three, { action: "update", id: 2, addBlockedBy: [3, 3] }]);
	assert.deepEqual(twice.state.tasks[1].blockedBy, [3]);
	const again = applyTodo(twice.state, { action: "update", id: 2, addBlockedBy: [3] });
	assert.deepEqual([again.changed, again.text], [false, "No change: #2 already matches the requested values (status: pending)"]);
	assert.deepEqual(applyTodo(twice.state, { action: "update", id: 2, addBlockedBy: [1, 3, 1] }).state.tasks[1].blockedBy, [3, 1]);
});

test("一覧は消したものを除いて並べ、状態で絞れる。進行中の作業と待つ相手を添える", () => {
	const state = play([three, { action: "update", id: 2, status: "in_progress", activeForm: "修正中" }, { action: "update", id: 3, addBlockedBy: [2] }, { action: "delete", id: 1 }]).state;
	const listed = applyTodo(state, { action: "list" });
	assert.deepEqual([listed.text, listed.changed], ["[in_progress] #2 直す (修正中)\n[pending] #3 PR を作る ⛓ #2", false]);
	assert.equal(applyTodo(state, { action: "list", status: "pending" }).text, "[pending] #3 PR を作る ⛓ #2");
	assert.match(applyTodo(state, { action: "list", includeDeleted: true }).text, /^\[deleted\] #1 再現する/);
	assert.equal(applyTodo(emptyTodoState(), { action: "list" }).text, "No tasks");
});

test("1件の詳細は、説明・今の作業・待つ相手・待たせている相手を出す", () => {
	const state = play([three, { action: "update", id: 2, status: "in_progress", activeForm: "修正中", description: "同期の処理" }, { action: "update", id: 2, addBlockedBy: [1] }, { action: "update", id: 3, addBlockedBy: [2] }]).state;
	assert.equal(applyTodo(state, { action: "get", id: 2 }).text, "#2 [in_progress] 直す\n  description: 同期の処理\n  activeForm: 修正中\n  blockedBy: #1\n  blocks: #3");
	assert.match(applyTodo(state, { action: "get" }).text, /id required for get/);
	assert.match(applyTodo(state, { action: "get", id: 9 }).text, /#9 not found/);
});

test("削除は消した印を付けて残し、全消しは空にして番号を1から振り直す", () => {
	const removed = play([three, { action: "delete", id: 2 }]);
	assert.deepEqual([removed.text, removed.state.tasks[1].status, removed.state.nextId], ["Deleted #2: 直す", "deleted", 4]);
	assert.match(applyTodo(removed.state, { action: "delete", id: 2 }).text, /#2 is already deleted/);
	assert.match(applyTodo(removed.state, { action: "delete" }).text, /id required for delete/);
	const cleared = applyTodo(removed.state, { action: "clear" });
	assert.deepEqual([cleared.text, cleared.state, cleared.changed], ["Cleared 3 tasks", emptyTodoState(), true]);
});

test("件名や説明に混ざった制御文字は、覚える前に取り除く", () => {
	const outcome = applyTodo(emptyTodoState(), { action: "create", subject: `危険${ESCAPE}[31mな件名`, description: "1行目\n2行目", activeForm: `作業${ESCAPE}[2J中` });
	assert.deepEqual(outcome.state.tasks[0], { id: 1, subject: "危険[31mな件名", status: "pending", description: "1行目 2行目", activeForm: "作業[2J中" });
});

test("知らない操作は、理由を返す", () => {
	assert.match(applyTodo(emptyTodoState(), { action: "rename" } as unknown as TodoParams).text, /^Error: unknown action: rename$/);
});

test("状態は、セッションの記録のうち最後に書かれた形の正しいものから読む。rpiv-todo の記録も読める", () => {
	const rpiv = custom("10:00", "rpiv-todo-state", { action: "create", params: {}, tasks: [{ id: 1, subject: "前の拡張で作った", status: "completed", owner: "x", metadata: { a: 1 } }], nextId: 2 });
	const own = custom("10:05", TASKS_ENTRY_TYPE, { action: "create", params: {}, tasks: [{ id: 1, subject: "前の拡張で作った", status: "completed" }, { id: 2, subject: "続き", status: "pending", blockedBy: [1] }], nextId: 3 });
	const broken = custom("10:06", TASKS_ENTRY_TYPE, { tasks: [{ id: "2", subject: 3 }], nextId: 9 });
	assert.deepEqual(stateFromBranch([rpiv]), { tasks: [{ id: 1, subject: "前の拡張で作った", status: "completed" }], nextId: 2 });
	assert.deepEqual(stateFromBranch([rpiv, own, broken]).tasks.map((task) => task.id), [1, 2]);
	assert.equal(stateFromBranch([rpiv, own, broken]).nextId, 3);
	assert.deepEqual(stateFromBranch([]), emptyTodoState());
	assert.deepEqual(stateFromBranch([rpiv, own], ms("10:02")).tasks.map((task) => task.id), [1], "時刻を渡すと、それまでに書かれた記録に限る");
});

test("記録に次の番号が無ければ、いちばん大きい番号の次から振る", () => {
	const entry = custom("10:00", TASKS_ENTRY_TYPE, { tasks: [{ id: 4, subject: "a", status: "pending" }, { id: 7, subject: "b", status: "deleted" }] });
	assert.equal(stateFromBranch([entry]).nextId, 8);
});
