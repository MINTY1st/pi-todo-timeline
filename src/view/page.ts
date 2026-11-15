// ページの置き場と書き出し
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isObject } from "../core/shared.ts";

export interface FileAccess {
	/** ファイルの中身。無ければ undefined */
	read(path: string): string | undefined;
	write(path: string, content: string): void;
}

export interface PageLocation {
	cwd: string;
	/** ページの置き場。相対パスなら作業ディレクトリから */
	directory: string;
	sessionId: string;
	startedAt: number | null;
	timeZone: string | undefined;
}

const ID_LENGTH = 8;
const FALLBACK_ID = "session";

function startStamp(startedAt: number, timeZone: string | undefined): string {
	const format = new Intl.DateTimeFormat("ja-JP", { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
	const parts = Object.fromEntries(format.formatToParts(startedAt).map((part) => [part.type, part.value]));
	return `${parts.month}${parts.day}-${parts.hour}${parts.minute}-`;
}

/** セッションごとに別のファイルにする。同じ作業ディレクトリで並んで動くセッションが、互いのページを上書きしないため */
export function pagePath(location: PageLocation): string {
	const id = location.sessionId.replace(/[^A-Za-z0-9]/g, "").slice(0, ID_LENGTH) || FALLBACK_ID;
	const stamp = location.startedAt === null ? "" : startStamp(location.startedAt, location.timeZone);
	return join(resolve(location.cwd, location.directory), `${stamp}${id}.html`);
}

/** 中身が変わったときだけ書く。書いたら true */
export function publishPage(files: FileAccess, path: string, html: string): boolean {
	if (files.read(path) === html) return false;
	files.write(path, html);
	return true;
}

/**
 * 作業ディレクトリが git の作業ツリーなら、ページの置き場を .git/info/exclude に足して追跡の対象から外す。
 * 足したら true。置き場が作業ディレクトリの外にあるときと、すでに行があるときは何もしない。
 */
export function excludeFromGit(files: FileAccess, cwd: string, directory: string): boolean {
	const inside = relative(cwd, resolve(cwd, directory));
	if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return false;
	const excludePath = join(cwd, ".git", "info", "exclude");
	const current = files.read(excludePath);
	if (current === undefined) return false;
	const line = `/${inside.split(sep).join("/")}/`;
	if (current.split("\n").some((existing) => existing.trim() === line)) return false;
	const head = current === "" || current.endsWith("\n") ? current : `${current}\n`;
	files.write(excludePath, `${head}${line}\n`);
	return true;
}

/** 発言やツールの結果の、最初と最後の時刻 */
export function activitySpan(entries: Iterable<unknown>): { first: number | null; last: number | null } {
	let first: number | null = null;
	let last: number | null = null;
	for (const entry of entries) {
		if (!isObject(entry) || entry.type !== "message" || typeof entry.timestamp !== "string") continue;
		const time = Date.parse(entry.timestamp);
		if (Number.isNaN(time)) continue;
		first = first === null ? time : Math.min(first, time);
		last = last === null ? time : Math.max(last, time);
	}
	return { first, last };
}
