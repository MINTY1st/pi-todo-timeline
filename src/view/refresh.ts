// ページとパネルを、今のセッションの状態に合わせる
import type { HostContext } from "../core/host.ts";
import { renderPage } from "./html.ts";
import { activitySpan, excludeFromGit, pagePath, publishPage } from "./page.ts";
import { renderReportsPanel, renderTasksPanel } from "./panel.ts";
import { reportsFromBranch } from "../report/records.ts";
import type { Report } from "../report/records.ts";
import { clockOf, messageOf, settingsOf } from "../core/session.ts";
import type { Session } from "../core/session.ts";
import { tasksFromBranch } from "./format.ts";
import type { TaskView } from "./format.ts";

/** パネルの名前。Pi Web では、この名前のボタンが画面の下に並び、押したものだけが開く */
export const PANEL_KEYS = { tasks: "timeline", reports: "reports" } as const;

interface Snapshot {
	tasks: TaskView[];
	reports: Report[];
	firstActivity: number | null;
	lastActivity: number | null;
}

function snapshotOf(context: HostContext): Snapshot {
	const entries = [...context.sessionManager.getBranch()];
	const span = activitySpan(entries);
	return { tasks: tasksFromBranch(entries), reports: reportsFromBranch(entries), firstActivity: span.first, lastActivity: span.last };
}

function writePage(session: Session, context: HostContext, snapshot: Snapshot): string | undefined {
	const { config } = settingsOf(session);
	if (!config.page) return undefined;
	const { files, timeZone } = session.options;
	const manager = context.sessionManager;
	const startedAt = Date.parse(manager.getHeader()?.timestamp ?? "");
	const path = pagePath({ cwd: context.cwd, directory: config.pageDirectory, sessionId: manager.getSessionId(), startedAt: Number.isNaN(startedAt) ? null : startedAt, timeZone });
	if (!session.excluded) {
		session.excluded = true;
		try {
			excludeFromGit(files, context.cwd, config.pageDirectory);
		} catch {
			// 追跡の対象から外せないだけなので、ページは書く
		}
	}
	publishPage(files, path, renderPage({ title: manager.getSessionName?.(), ...snapshot, ...clockOf(session) }));
	return path;
}

/** 書けなくても、ほかの処理は止めない */
function refreshPage(session: Session, context: HostContext, snapshot: Snapshot): string | undefined {
	try {
		const path = writePage(session, context, snapshot);
		session.pageError = undefined;
		return path;
	} catch (error) {
		session.pageError = messageOf(error);
		return undefined;
	}
}

/** 中身が変わったときだけ送る。行が無ければ、出していたパネルを消す */
function sendPanel(session: Session, context: HostContext, key: string, lines: string[]): void {
	const text = lines.length === 0 ? undefined : lines.join("\n");
	if (text === session.panelTexts.get(key)) return;
	context.ui.setWidget(key, text === undefined ? undefined : lines, { placement: "aboveEditor" });
	// 送れたときだけ覚える。送れなかったら、次の機会に送り直す
	if (text === undefined) session.panelTexts.delete(key);
	else session.panelTexts.set(key, text);
}

function refreshPanels(session: Session, context: HostContext, snapshot: Snapshot, page: string | undefined): void {
	const { config } = settingsOf(session);
	if (!config.panel) return;
	const input = { ...snapshot, ...clockOf(session), pagePath: page, maxTasks: config.panelMaxTasks };
	sendPanel(session, context, PANEL_KEYS.tasks, renderTasksPanel(input));
	sendPanel(session, context, PANEL_KEYS.reports, renderReportsPanel(input));
}

/**
 * ページとパネルを今の状態にし、ページの場所を返す。
 * 表示の更新なので、記録を読めない・画面に送れないといった失敗では例外にせず、レポートの作成を止めない。
 * 閉じたセッションでは何もしない（消したパネルを出し直さないため）。
 */
export function refreshViews(session: Session, context: HostContext): string | undefined {
	if (session.closed) return undefined;
	let page: string | undefined;
	try {
		const snapshot = snapshotOf(context);
		page = refreshPage(session, context, snapshot);
		refreshPanels(session, context, snapshot, page);
	} catch {
		// 次のターンの終わりにまた試す
	}
	return page;
}

/** 出しているパネルをすべて消す */
export function clearPanels(session: Session, context: HostContext): void {
	for (const key of [...session.panelTexts.keys()]) {
		session.panelTexts.delete(key);
		context.ui.setWidget(key, undefined);
	}
}
