// pi への配線。ターンの終わりに期限を確かめ、/timeline で表示する
import type { LoadedConfig } from "./config.ts";
import { completeText, findTarget } from "./host.ts";
import type { FileAccess } from "./page.ts";
import type { HostContext, TimelineHost } from "./host.ts";
import type { ModelRequest } from "./prompt.ts";
import { REPORT_ENTRY_TYPE, reportsFromBranch } from "./records.ts";
import type { Report } from "./records.ts";
import { produceReports } from "./reporter.ts";
import { clockOf, createSession, messageOf, settingsOf } from "./session.ts";
import type { Session } from "./session.ts";
import { renderTimeline, reportHead, tasksFromBranch } from "./view.ts";
import { createTodoTool } from "./todo-tool.ts";
import { clearPanels, refreshViews } from "./views.ts";

export interface ExtensionOptions {
	files: FileAccess;
	loadConfig(): LoadedConfig;
	/** 設定ファイルの場所。未設定の案内に出す */
	configLocation: string;
	now(): number;
	newId(): string;
	/** 時刻を表すタイムゾーン。undefined なら実行している環境のもの */
	timeZone: string | undefined;
}

const COMMAND_NAME = "timeline";
const FORCE_ARGUMENT = "now";
/** 失敗した後、ターンの終わりに頼み直すまで空ける時間 */
const RETRY_DELAY_MS = 5 * 60_000;
const MAX_LISTED_REPORTS = 12;

function recordOutcome(session: Session, error: string | undefined): void {
	session.lastError = error;
	session.retryAfter = error === undefined ? 0 : session.options.now() + RETRY_DELAY_MS;
}

function announce(session: Session, context: HostContext, reports: readonly Report[]): void {
	for (const report of reports) {
		context.ui.notify(`タイムライン ${reportHead(report, clockOf(session))}: ${report.summary.progress[0]}`, "info");
	}
}

async function produce(session: Session, context: HostContext, model: object, force: boolean): Promise<void> {
	const { config } = settingsOf(session);
	const controller = new AbortController();
	session.controller = controller;
	const dependencies = {
		now: session.options.now,
		newId: session.options.newId,
		complete: (request: ModelRequest, signal: AbortSignal) => completeText(context.modelRegistry, model, request, config, signal),
	};
	const result = await produceReports({ entries: [...context.sessionManager.getBranch()], config, force }, dependencies, controller.signal);
	if (session.closed || controller.signal.aborted) return;
	for (const report of result.reports) session.host.appendEntry(REPORT_ENTRY_TYPE, report);
	if (result.reports.length > 0) refreshViews(session, context);
	recordOutcome(session, result.error);
	if (config.notify) announce(session, context, result.reports);
}

/** レポートを作り始める。モデルが使えなければ何もしない */
function start(session: Session, context: HostContext, force: boolean): Promise<void> {
	const target = findTarget(settingsOf(session).config, context.modelRegistry, session.options.configLocation);
	if ("reason" in target) return Promise.resolve();
	const task: Promise<void> = produce(session, context, target.model, force)
		.catch((error: unknown) => recordOutcome(session, messageOf(error)))
		.finally(() => {
			if (session.running === task) session.running = undefined;
		});
	session.running = task;
	return task;
}

/** ターンを待たせないよう、作り始めるだけで戻る */
function onTurnEnd(session: Session, context: HostContext): undefined {
	if (session.closed || !context.hasUI) return undefined;
	refreshViews(session, context);
	const busy = session.running !== undefined || session.options.now() < session.retryAfter;
	if (!busy) void start(session, context, false);
	return undefined;
}

function notesOf(session: Session, context: HostContext, page: string | undefined): string[] {
	const { config, problems } = settingsOf(session);
	const target = findTarget(config, context.modelRegistry, session.options.configLocation);
	const blocked = "reason" in target ? [target.reason] : [];
	const failed = session.lastError === undefined ? [] : [`直近のレポートは作れませんでした: ${session.lastError}`];
	const located = page === undefined ? [] : [`ページ: ${page}`];
	const unwritten = session.pageError === undefined ? [] : [`ページを書き出せませんでした: ${session.pageError}`];
	return [...problems, ...blocked, ...failed, ...located, ...unwritten];
}

async function show(session: Session, argumentText: string, context: HostContext): Promise<void> {
	if (argumentText.trim() === FORCE_ARGUMENT) {
		// 待っている間に別の /timeline now が作り始めることがあるので、空くまで確かめ直す
		while (session.running !== undefined) await session.running;
		await start(session, context, true);
	}
	const page = refreshViews(session, context);
	const entries = [...context.sessionManager.getBranch()];
	const view = { tasks: tasksFromBranch(entries), reports: reportsFromBranch(entries), ...clockOf(session), maxReports: MAX_LISTED_REPORTS, notes: notesOf(session, context, page) };
	context.ui.notify(renderTimeline(view), "info");
}

function close(session: Session, context: HostContext): void {
	session.closed = true;
	session.controller?.abort();
	try {
		clearPanels(session, context);
	} catch {
		// 閉じる途中で画面がもう無いことがある。消せなくても、閉じる処理は続ける
	}
}

export function createExtension(options: ExtensionOptions): (host: TimelineHost) => void {
	return (host) => {
		const session = createSession(options, host);
		if (settingsOf(session).config.todoTool) host.registerTool(createTodoTool(session));
		host.on("session_start", (_event, context) => {
			if (context.hasUI) refreshViews(session, context);
		});
		host.on("turn_end", (_event, context) => onTurnEnd(session, context));
		host.on("session_shutdown", (_event, context) => close(session, context));
		host.registerCommand(COMMAND_NAME, {
			description: "タスクと定期レポートを表示する（now を付けると、今までの分のレポートを作ってから表示する）",
			handler: (argumentText, context) => show(session, argumentText, context),
		});
	};
}
