// 1つのセッションの間、持ち続ける状態
import type { ExtensionOptions } from "./extension.ts";
import type { LoadedConfig } from "./config.ts";
import type { TimelineHost } from "./host.ts";
import { periodLabel } from "./view.ts";

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
	/** 最後に送ったパネルの中身。出していなければ undefined */
	panelText: string | undefined;
}

export function createSession(options: ExtensionOptions, host: TimelineHost): Session {
	return { options, host, loaded: undefined, running: undefined, controller: undefined, retryAfter: 0, lastError: undefined, closed: false, excluded: false, pageError: undefined, panelText: undefined };
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
