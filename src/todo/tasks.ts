// 記録から読んだタスクの一覧と、それを文字の行にしたもの（表示とレポートの依頼の両方が使う）
import { clip } from "../core/shared.ts";
import { stateFromBranch } from "./state.ts";
import type { Task } from "./state.ts";

/** 表示するタスク。消したものは含めない */
export type TaskView = Task & { status: "pending" | "in_progress" | "completed" };

const STATUS_MARKS = { completed: "✓", in_progress: "◐", pending: "○" } as const;
const RESULT_MAX_CHARS = 200;

/**
 * 最後に記録されたタスクの状態から、消したものを除いて返す。
 * upTo を渡すと、その時刻までに記録された状態に限る（過去の区間のレポートに、後の状態を混ぜないため）。
 */
export function tasksFromBranch(entries: Iterable<unknown>, upTo = Number.POSITIVE_INFINITY): TaskView[] {
	return stateFromBranch(entries, upTo).tasks.filter((task): task is TaskView => task.status !== "deleted");
}

export function taskLines(tasks: readonly TaskView[]): string[] {
	return tasks.flatMap((task) => {
		const active = task.status === "in_progress" && task.activeForm ? `（${task.activeForm}）` : "";
		const head = `${STATUS_MARKS[task.status]} #${task.id} ${task.subject}${active}`;
		const result = task.status === "completed" && task.description ? [`    ${clip(task.description, RESULT_MAX_CHARS)}`] : [];
		return [head, ...result];
	});
}
