// ページとパネルを、今のセッションの状態に合わせる
import type { HostContext } from "./host.ts";
import { renderPage } from "./html.ts";
import { activitySpan, excludeFromGit, pagePath, publishPage } from "./page.ts";
import { renderPanel } from "./panel.ts";
import { reportsFromBranch } from "./records.ts";
import type { Report } from "./records.ts";
import { clockOf, messageOf, settingsOf } from "./session.ts";
import type { Session } from "./session.ts";
import { tasksFromBranch } from "./view.ts";
import type { TaskView } from "./view.ts";

export const PANEL_KEY = "timeline";

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

/** 中身が変わったときだけ送る。タスクもレポートも無ければ、出していたパネルを消す */
function refreshPanel(session: Session, context: HostContext, snapshot: Snapshot, page: string | undefined): void {
	const { config } = settingsOf(session);
	if (!config.panel) return;
	const lines = renderPanel({ ...snapshot, ...clockOf(session), pagePath: page, maxTasks: config.panelMaxTasks });
	const text = lines.length === 0 ? undefined : lines.join("\n");
	if (text === session.panelText) return;
	session.panelText = text;
	context.ui.setWidget(PANEL_KEY, text === undefined ? undefined : lines, { placement: "aboveEditor" });
}

/** ページとパネルを今の状態にし、ページの場所を返す */
export function refreshViews(session: Session, context: HostContext): string | undefined {
	const snapshot = snapshotOf(context);
	const page = refreshPage(session, context, snapshot);
	refreshPanel(session, context, snapshot, page);
	return page;
}

export function clearPanel(session: Session, context: HostContext): void {
	if (session.panelText === undefined) return;
	session.panelText = undefined;
	context.ui.setWidget(PANEL_KEY, undefined);
}
