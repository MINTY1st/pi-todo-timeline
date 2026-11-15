// 1つのセッションの間、持ち続ける状態
import type { LoadedConfig } from "./config.ts";
import type { PatchFiles } from "./files.ts";
import type { TimelineHost } from "./host.ts";
import { periodLabel } from "./shared.ts";

export interface ExtensionOptions {
	files: PatchFiles;
	loadConfig(): LoadedConfig;
	/** 設定ファイルの場所。未設定の案内に出す */
	configLocation: string;
	now(): number;
	newId(): string;
	/** 時刻を表すタイムゾーン。undefined なら実行している環境のもの */
	timeZone: string | undefined;
	/** Pi Web の中で動いているかを見る場所（実行中の作業ディレクトリ）。undefined なら見ない */
	piWebDirectory?: string;
}

export interface Session {
	options: ExtensionOptions;
	host: TimelineHost;
	loaded: LoadedConfig | undefined;
	running: Promise<void> | undefined;
	controller: AbortController | undefined;
	retryAfter: number;
	lastError: string | undefined;
	closed: boolean;
	/** ページの置き場を git の追跡から外す処理を済ませたか */
	excluded: boolean;
	pageError: string | undefined;
	/** 今出しているパネルの中身。キーはパネルの名前。出していないパネルは入っていない */
	panelTexts: Map<string, string>;
	/** Pi Web に当てられなかった理由のうち、最後に知らせたもの。同じ理由を何度も知らせない */
	piWebNotice: string | undefined;
}

export function createSession(options: ExtensionOptions, host: TimelineHost): Session {
	return { options, host, loaded: undefined, running: undefined, controller: undefined, retryAfter: 0, lastError: undefined, closed: false, excluded: false, pageError: undefined, panelTexts: new Map(), piWebNotice: undefined };
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function settingsOf(session: Session): LoadedConfig {
	session.loaded ??= session.options.loadConfig();
	return session.loaded;
}

export function clockOf(session: Session) {
	const { config } = settingsOf(session);
	const levelLabels = [periodLabel(config.intervalMs), periodLabel(config.intervalMs * config.rollupFactor)];
	return { now: session.options.now(), timeZone: session.options.timeZone, levelLabels };
}
