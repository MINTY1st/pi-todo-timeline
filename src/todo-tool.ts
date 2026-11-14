// todo ツールの定義。名前と引数の形は @juicesharp/rpiv-todo（MIT）と同じにしてある
import type { HostContext, ToolDefinition, ToolResult } from "./host.ts";
import { settingsOf } from "./session.ts";
import type { Session } from "./session.ts";
import { isObject } from "./shared.ts";
import { applyTodo, stateFromBranch, TASKS_ENTRY_TYPE } from "./todo-state.ts";
import type { TodoParams } from "./todo-state.ts";
import { refreshViews } from "./views.ts";

export const TODO_TOOL_NAME = "todo";

const TASK_FIELDS = {
	subject: { type: "string", description: "Short imperative task title" },
	description: { type: "string", description: "Details of the task. When the task is completed, the one-line result" },
	activeForm: { type: "string", description: "Present-continuous label shown while the task is in_progress (e.g. 'writing tests')" },
	blockedBy: { type: "array", items: { type: "number" }, description: "Ids of existing tasks this task waits on (create only)" },
};

const PARAMETERS = {
	type: "object",
	properties: {
		action: { type: "string", enum: ["create", "update", "list", "get", "delete", "clear"] },
		...TASK_FIELDS,
		status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"], description: "New status (update), or a filter (list)" },
		addBlockedBy: { type: "array", items: { type: "number" }, description: "Task ids to add to blockedBy (update only)" },
		removeBlockedBy: { type: "array", items: { type: "number" }, description: "Task ids to remove from blockedBy (update only)" },
		id: { type: "number", description: "Task id (required for update, get, delete)" },
		includeDeleted: { type: "boolean", description: "If true, list also returns deleted tasks" },
		tasks: {
			type: "array",
			items: { type: "object", properties: TASK_FIELDS, required: ["subject"] },
			description: "Batch create: several independent tasks in one call. Use instead of subject. Items cannot be blockedBy each other",
		},
	},
	required: ["action"],
};

const DESCRIPTION =
	"Manage the task list the user sees in the timeline panel. Actions: create (one task, or several with tasks[]), update (status, fields, dependencies), list, get, delete (keeps a tombstone), clear (reset all). Status: pending → in_progress → completed; a completed task can only be deleted.";

function guidelines(language: string): string[] {
	return [
		"Use `todo` for work with 3+ steps, when the user gives you a list of tasks, or right after new instructions. Skip it for single trivial tasks and for conversation.",
		"Mark a task in_progress BEFORE starting it and pass activeForm, a present-continuous label. Mark it completed IMMEDIATELY when done; never batch completions. Keep exactly one task in_progress.",
		"Do not mark a task completed while tests fail, the work is partial, or errors remain. Keep it in_progress and create a task for the blocker.",
		`When marking a task completed, also set description to a one-line result in ${language} (at most 160 characters): what was done and the verified outcome, with concrete evidence such as test counts, file paths, or commit ids. State only what was actually verified.`,
		'Change a task with update and its id, e.g. {"action":"update","id":3,"status":"completed","description":"..."}. Create several tasks at once with create and tasks: [{"subject":"..."}, ...].',
		"Completed tasks stay visible to the user with their results. Use clear only when starting unrelated work.",
	];
}

/** モデルが tasks を JSON の文字列で渡してくることがあるので、配列に直せるなら直す */
function prepareArguments(raw: unknown): unknown {
	if (!isObject(raw) || typeof raw.tasks !== "string") return raw;
	try {
		const parsed: unknown = JSON.parse(raw.tasks);
		return Array.isArray(parsed) ? { ...raw, tasks: parsed } : raw;
	} catch {
		return raw;
	}
}

/** 今の状態に操作を当て、変わったら記録して表示を更新する */
function execute(session: Session, params: TodoParams, context: HostContext): ToolResult {
	const outcome = applyTodo(stateFromBranch(context.sessionManager.getBranch()), params);
	const failed = outcome.error === undefined ? {} : { error: outcome.error };
	const details = { action: params.action, params, tasks: outcome.state.tasks, nextId: outcome.state.nextId, ...failed };
	if (outcome.changed) {
		session.host.appendEntry(TASKS_ENTRY_TYPE, details);
		if (context.hasUI) refreshViews(session, context);
	}
	return { content: [{ type: "text", text: outcome.text }], details, ...(outcome.error === undefined ? {} : { isError: true }) };
}

export function createTodoTool(session: Session): ToolDefinition {
	return {
		name: TODO_TOOL_NAME,
		label: "Todo",
		description: DESCRIPTION,
		promptSnippet: "Track multi-step work as a task list the user can see",
		promptGuidelines: guidelines(settingsOf(session).config.language),
		parameters: PARAMETERS,
		// 状態をセッションの記録から読んで書き戻すので、同じターンの中でも1つずつ実行する
		executionMode: "sequential",
		prepareArguments,
		execute: async (_toolCallId, params, _signal, _onUpdate, context) => execute(session, params as TodoParams, context),
	};
}
