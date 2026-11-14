// タスクの状態と、todo ツールの操作の適用
// 操作の種類・引数・応答の文・状態の移り変わりの決まりは、@juicesharp/rpiv-todo（MIT）と同じにしてある（モデルの使い方と、前の記録を引き継ぐため）
import { isObject, withoutControls } from "./shared.ts";

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
	id: number;
	subject: string;
	status: TaskStatus;
	description?: string;
	activeForm?: string;
	/** このタスクが待っている相手の番号 */
	blockedBy?: number[];
}

export interface TodoState {
	tasks: Task[];
	nextId: number;
}

interface TaskSpec {
	subject?: string;
	description?: string;
	activeForm?: string;
	blockedBy?: number[];
}

export interface TodoParams extends TaskSpec {
	action: "create" | "update" | "list" | "get" | "delete" | "clear";
	status?: TaskStatus;
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	id?: number;
	includeDeleted?: boolean;
	tasks?: TaskSpec[];
}

export interface TodoOutcome {
	state: TodoState;
	/** モデルに返す文 */
	text: string;
	/** 状態が変わったか（変わったときだけ記録する） */
	changed: boolean;
	error: string | undefined;
}

/** この拡張がタスクの状態を書く記録の種類 */
export const TASKS_ENTRY_TYPE = "pi-todo-timeline-tasks";
/** 読むだけの記録の種類。@juicesharp/rpiv-todo が書いたもの */
const LEGACY_ENTRY_TYPE = "rpiv-todo-state";
const STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed", "deleted"]);
/** 完了は消すことしかできず、消したものは戻せない */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = { pending: ["in_progress", "completed", "deleted"], in_progress: ["pending", "completed", "deleted"], completed: ["deleted"], deleted: [] };
const BATCH_ITEM_FIELDS = ["description", "activeForm", "blockedBy"] as const;
const MUTABLE_FIELDS = ["subject", "description", "activeForm", "status"] as const;

export const emptyTodoState = (): TodoState => ({ tasks: [], nextId: 1 });

const fail = (state: TodoState, message: string): TodoOutcome => ({ state, text: `Error: ${message}`, changed: false, error: message });
const succeed = (state: TodoState, text: string, changed: boolean): TodoOutcome => ({ state, text, changed, error: undefined });
/** 画面に出す文なので、覚える前に制御文字を取り除く */
const clean = (value: string): string => withoutControls(value).trim();
const refs = (ids: readonly number[], separator: string): string => ids.map((id) => `#${id}`).join(separator);
const replaceAt = (tasks: readonly Task[], index: number, task: Task): Task[] => tasks.map((existing, position) => (position === index ? task : existing));
/** 作成の1件として使える形か（モデルが文字列などを渡してくることがある） */
const hasSubject = (spec: unknown): spec is TaskSpec & { subject: string } => isObject(spec) && typeof spec.subject === "string" && spec.subject.trim() !== "";

/** 空の欄は持たせない */
function buildTaskFrom(id: number, status: TaskStatus, spec: TaskSpec): Task {
	const task: Task = { id, subject: clean(spec.subject ?? ""), status };
	if (spec.description) task.description = clean(spec.description);
	if (spec.activeForm) task.activeForm = clean(spec.activeForm);
	if (spec.blockedBy?.length) task.blockedBy = [...spec.blockedBy];
	return task;
}

const buildTask = (id: number, spec: TaskSpec): Task => buildTaskFrom(id, "pending", spec);

/** 待つ相手として指定できない番号があれば、その理由を返す */
function blockedByProblem(state: TodoState, ids: readonly number[] | undefined, label: string, siblings: ReadonlySet<number> = new Set()): string | undefined {
	for (const id of ids ?? []) {
		if (siblings.has(id)) return `${label}: #${id} is another item in this batch; create the prerequisite first, then the dependent with blockedBy`;
		const target = state.tasks.find((task) => task.id === id);
		if (target === undefined) return `${label}: #${id} not found`;
		if (target.status === "deleted") return `${label}: #${id} is deleted`;
	}
	return undefined;
}

function batchProblem(state: TodoState, params: TodoParams): string | undefined {
	if (params.tasks === undefined) return undefined;
	if (params.subject !== undefined) return "create requires subject or tasks[], not both";
	const topLevel = BATCH_ITEM_FIELDS.filter((field) => params[field] !== undefined);
	if (topLevel.length > 0) return `create with tasks[] takes ${topLevel.join(", ")} on each item, not at the top level`;
	return params.tasks.length === 0 ? "tasks[] must be non-empty" : undefined;
}

function create(state: TodoState, params: TodoParams): TodoOutcome {
	const problem = batchProblem(state, params);
	if (problem !== undefined) return fail(state, problem);
	const specs: TaskSpec[] = params.tasks ?? [params];
	const siblings = new Set(params.tasks === undefined ? [] : specs.map((_, index) => state.nextId + index));
	for (const [index, spec] of specs.entries()) {
		const where = params.tasks === undefined ? "" : `tasks[${index}]: `;
		if (!hasSubject(spec)) return fail(state, `${where}subject required for create`);
		const blocked = blockedByProblem(state, spec.blockedBy, "blockedBy", siblings);
		if (blocked !== undefined) return fail(state, blocked);
	}
	const created = specs.map((spec, index) => buildTask(state.nextId + index, spec));
	const text = created.map((task) => `Created #${task.id}: ${task.subject} (pending)`).join("\n");
	return succeed({ tasks: [...state.tasks, ...created], nextId: state.nextId + created.length }, text, true);
}

function locate(state: TodoState, id: number | undefined, action: string): { index: number; task: Task } | string {
	if (id === undefined) return `id required for ${action}`;
	const index = state.tasks.findIndex((task) => task.id === id);
	return index < 0 ? `#${id} not found` : { index, task: state.tasks[index] };
}

/** 待つ相手を外し、足した結果を返す。足せない相手がいれば、その理由を返す */
function nextBlockedBy(state: TodoState, current: Task, params: TodoParams): number[] | string {
	const removed = new Set(params.removeBlockedBy ?? []);
	const kept = (current.blockedBy ?? []).filter((id) => !removed.has(id));
	const added = params.addBlockedBy ?? [];
	if (added.includes(current.id)) return `cannot block #${current.id} on itself`;
	// 同じ相手を何度足しても1回だけ入るよう、重なりを除く（先に出た順を保つ）
	return blockedByProblem(state, added, "addBlockedBy") ?? [...new Set([...kept, ...added])];
}

function withChanges(current: Task, params: TodoParams, blockedBy: readonly number[]): Task {
	const updated: Task = { ...current, status: params.status ?? current.status };
	if (params.subject !== undefined) updated.subject = clean(params.subject);
	if (params.description !== undefined) updated.description = clean(params.description);
	if (params.activeForm !== undefined) updated.activeForm = clean(params.activeForm);
	if (blockedBy.length > 0) updated.blockedBy = [...blockedBy];
	else delete updated.blockedBy;
	return updated;
}

const sameTask = (left: Task, right: Task): boolean =>
	left.subject === right.subject && left.status === right.status && left.description === right.description && left.activeForm === right.activeForm && (left.blockedBy ?? []).join(",") === (right.blockedBy ?? []).join(",");

/** 変える欄が1つも無い、または移れない状態への変更なら、その理由を返す */
function updateProblem(current: Task, params: TodoParams): string | undefined {
	const linked = [...(params.addBlockedBy ?? []), ...(params.removeBlockedBy ?? [])];
	const hasChange = MUTABLE_FIELDS.some((field) => params[field] !== undefined) || linked.length > 0;
	if (!hasChange) return "update requires at least one mutable field: subject, description, activeForm, status, addBlockedBy, or removeBlockedBy";
	const target = params.status ?? current.status;
	const allowed = target === current.status || TRANSITIONS[current.status].includes(target);
	return allowed ? undefined : `illegal transition ${current.status} → ${target}`;
}

function update(state: TodoState, params: TodoParams): TodoOutcome {
	const found = locate(state, params.id, "update");
	if (typeof found === "string") return fail(state, found);
	const current = found.task;
	const problem = updateProblem(current, params);
	if (problem !== undefined) return fail(state, problem);
	const blockedBy = nextBlockedBy(state, current, params);
	if (typeof blockedBy === "string") return fail(state, blockedBy);
	const updated = withChanges(current, params, blockedBy);
	if (sameTask(current, updated)) return succeed(state, `No change: #${current.id} already matches the requested values (status: ${current.status})`, false);
	const moved = current.status === updated.status ? "" : ` (${current.status} → ${updated.status})`;
	return succeed({ tasks: replaceAt(state.tasks, found.index, updated), nextId: state.nextId }, `Updated #${current.id}${moved}`, true);
}

function listLine(task: Task): string {
	const doing = task.status === "in_progress" && task.activeForm ? ` (${task.activeForm})` : "";
	const waits = task.blockedBy?.length ? ` ⛓ ${refs(task.blockedBy, ",")}` : "";
	return `[${task.status}] #${task.id} ${task.subject}${doing}${waits}`;
}

function list(state: TodoState, params: TodoParams): TodoOutcome {
	const shown = state.tasks.filter((task) => (params.includeDeleted === true || task.status !== "deleted") && (params.status === undefined || task.status === params.status));
	return succeed(state, shown.length === 0 ? "No tasks" : shown.map(listLine).join("\n"), false);
}

function get(state: TodoState, params: TodoParams): TodoOutcome {
	const found = locate(state, params.id, "get");
	if (typeof found === "string") return fail(state, found);
	const { task } = found;
	const blocks = state.tasks.filter((other) => other.status !== "deleted" && other.blockedBy?.includes(task.id)).map((other) => other.id);
	const lines = [
		`#${task.id} [${task.status}] ${task.subject}`,
		task.description ? `  description: ${task.description}` : "",
		task.activeForm ? `  activeForm: ${task.activeForm}` : "",
		task.blockedBy?.length ? `  blockedBy: ${refs(task.blockedBy, ", ")}` : "",
		blocks.length > 0 ? `  blocks: ${refs(blocks, ", ")}` : "",
	];
	return succeed(state, lines.filter((line) => line !== "").join("\n"), false);
}

function remove(state: TodoState, params: TodoParams): TodoOutcome {
	const found = locate(state, params.id, "delete");
	if (typeof found === "string") return fail(state, found);
	if (found.task.status === "deleted") return fail(state, `#${found.task.id} is already deleted`);
	const tasks = replaceAt(state.tasks, found.index, { ...found.task, status: "deleted" });
	return succeed({ tasks, nextId: state.nextId }, `Deleted #${found.task.id}: ${found.task.subject}`, true);
}

const clear = (state: TodoState): TodoOutcome => succeed(emptyTodoState(), `Cleared ${state.tasks.length} tasks`, true);

const ACTIONS: Record<string, (state: TodoState, params: TodoParams) => TodoOutcome> = { create, update, list, get, delete: remove, clear };

/** 操作を当てた後の状態と、モデルに返す文を返す。できない操作は、状態を変えずに理由を返す */
export function applyTodo(state: TodoState, params: TodoParams): TodoOutcome {
	const action = Object.hasOwn(ACTIONS, params.action) ? ACTIONS[params.action] : undefined;
	return action === undefined ? fail(state, `unknown action: ${String(params.action)}`) : action(state, params);
}

const isIdList = (value: unknown): value is number[] => Array.isArray(value) && value.every((id) => Number.isSafeInteger(id));
const isOptionalText = (value: unknown): boolean => value === undefined || typeof value === "string";

const hasCoreFields = (value: Record<string, unknown>): boolean => Number.isSafeInteger(value.id) && typeof value.subject === "string" && STATUSES.has(value.status as string);
const hasValidExtras = (value: Record<string, unknown>): boolean => isOptionalText(value.description) && isOptionalText(value.activeForm) && (value.blockedBy === undefined || isIdList(value.blockedBy));

/** 記録の中の1件を、この拡張が持つ欄だけにして読む。形が違えば undefined */
function readTask(value: unknown): Task | undefined {
	if (!isObject(value) || !hasCoreFields(value) || !hasValidExtras(value)) return undefined;
	const waits = (value.blockedBy as number[] | undefined) ?? [];
	return buildTaskFrom(value.id as number, value.status as TaskStatus, { subject: value.subject as string, description: value.description as string | undefined, activeForm: value.activeForm as string | undefined, blockedBy: waits });
}

/** タスクの状態の記録（この拡張か rpiv-todo が書いたもの）なら、その中身を返す */
function stateData(entry: unknown): { tasks: unknown[]; nextId: unknown; recordedAt: number } | undefined {
	if (!isObject(entry) || entry.type !== "custom" || !isObject(entry.data) || !Array.isArray(entry.data.tasks)) return undefined;
	if (entry.customType !== TASKS_ENTRY_TYPE && entry.customType !== LEGACY_ENTRY_TYPE) return undefined;
	const recordedAt = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
	return { tasks: entry.data.tasks, nextId: entry.data.nextId, recordedAt };
}

function readState(entry: unknown, upTo: number): TodoState | undefined {
	const data = stateData(entry);
	if (data === undefined || data.recordedAt > upTo) return undefined;
	const tasks = data.tasks.map(readTask);
	if (tasks.some((task) => task === undefined)) return undefined;
	const known = tasks as Task[];
	const nextId = Number.isSafeInteger(data.nextId) ? (data.nextId as number) : Math.max(0, ...known.map((task) => task.id)) + 1;
	return { tasks: known, nextId };
}

/**
 * セッションの記録のうち、最後に書かれた形の正しい状態を返す。無ければ空。
 * upTo を渡すと、その時刻までに書かれた記録に限る（過去の区間のレポートに、後の状態を混ぜないため）。
 */
export function stateFromBranch(entries: Iterable<unknown>, upTo = Number.POSITIVE_INFINITY): TodoState {
	let latest = emptyTodoState();
	for (const entry of entries) latest = readState(entry, upTo) ?? latest;
	return latest;
}
