// Pi Web の画面に足す、小窓のスクリプト。
// 下の関数はブラウザの中で動く。buildPopupScript が関数の中身をそのまま文字にして並べるので、
// それぞれの関数は、ここに並ぶ関数と SETTINGS のほかは、モジュールの外のものを使わない。

const SETTINGS = {
	/** パネルの名前と、小窓で開く面 */
	tabs: { timeline: "tasks", reports: "reports" } as Record<string, "tasks" | "reports">,
	trigger: ".extension-widget-trigger",
	key: ".extension-widget-key",
	boxId: "pi-todo-timeline-popup",
	/** ページの置き場（作業ディレクトリから）。設定の pageDirectory を変えていると見つからない */
	pageDirectory: ".pi/timeline",
	refreshMs: 4000,
	boxStyle: "position:fixed;right:16px;bottom:52px;width:min(460px,calc(100vw - 24px));height:min(72vh,760px);z-index:2147483000;border:1px solid var(--border,#454545);border-radius:12px;overflow:hidden;background:var(--bg,#1a1a1a);box-shadow:0 16px 48px rgba(0,0,0,.5);display:none",
	frameStyle: "width:100%;height:100%;border:0;display:block",
	closeStyle: "position:absolute;top:8px;right:10px;width:26px;height:26px;border:0;border-radius:6px;background:var(--bg-hover,#2e2e2e);color:var(--text,#e8e8e8);font-size:16px;line-height:1;cursor:pointer",
};

type Tab = "tasks" | "reports";
interface PopupState {
	tab: Tab | undefined;
	sessionId: string;
	path: string;
	version: string;
	shown: string;
	timer: number;
}

export function sessionIdFrom(search: string): string {
	return new URLSearchParams(search).get("session") ?? "";
}

/** Pi Web のファイルの API に渡す形。区切りごとに符号化する */
export function apiPath(filePath: string): string {
	return filePath.replace(/\\/g, "/").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/** 置き場のファイル名から、このセッションのページを選ぶ。名前は「開始の日時-ID の英数字の先頭8桁.html」 */
export function pageNameFor(sessionId: string, names: readonly string[]): string | undefined {
	const id = sessionId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
	if (id === "") return undefined;
	const matched = names.filter((name) => name === `${id}.html` || name.endsWith(`-${id}.html`)).sort();
	return matched[matched.length - 1];
}

/** 押されたのが timeline か reports のボタンなら、開く面を返す。Shift つきは元の文字のパネルに任せる */
export function tabForClick(event: { shiftKey: boolean; target: unknown }): Tab | undefined {
	const target = event.target as { closest?(selector: string): { querySelector(selector: string): { textContent: string | null } | null } | null } | null;
	if (event.shiftKey || !target || !target.closest) return undefined;
	const trigger = target.closest(SETTINGS.trigger);
	const label = trigger ? trigger.querySelector(SETTINGS.key) : null;
	const key = label && label.textContent ? label.textContent.trim() : "";
	return Object.prototype.hasOwnProperty.call(SETTINGS.tabs, key) ? SETTINGS.tabs[key] : undefined;
}

/** ページの html の要素に、開く面と配色の指定を足す。ページの側のスクリプトとスタイルがこれを見る */
export function withPageOptions(html: string, options: { tab: string; theme: string }): string {
	const theme = options.theme === "" ? "" : ` data-theme="${options.theme}"`;
	return html.replace('<html lang="ja">', `<html lang="ja" data-tab="${options.tab}"${theme}>`);
}

/** Pi Web の今の配色。分からなければ空（ページは OS の設定に従う） */
function themeOf(view: Window): string {
	const scheme = view.getComputedStyle(view.document.documentElement).colorScheme || "";
	if (scheme.includes("dark")) return "dark";
	return scheme.includes("light") ? "light" : "";
}

async function getJson(view: Window, url: string): Promise<Record<string, any>> {
	const response = await view.fetch(url, { credentials: "same-origin" });
	if (!response.ok) throw new Error(`読めませんでした（${response.status}）`);
	return response.json();
}

/** セッションの作業ディレクトリを調べ、置き場の一覧からこのセッションのページの場所を決める */
async function findPage(view: Window, sessionId: string): Promise<string> {
	const session = await getJson(view, `/api/sessions/${encodeURIComponent(sessionId)}?tail=1&tree=summary`);
	const directory = `${session.info.cwd}/${SETTINGS.pageDirectory}`;
	const listing = await getJson(view, `/api/files/${apiPath(directory)}?type=list&hidden=1`);
	const name = pageNameFor(sessionId, listing.entries.map((entry: { name: string }) => entry.name));
	if (name === undefined) throw new Error("このセッションのページがまだありません");
	return `${directory}/${name}`;
}

/** 大きいファイルは何回かに分けて返ってくるので、終わりまでつなぐ */
async function readPage(view: Window, path: string): Promise<string> {
	let content = "";
	let offset = 0;
	for (let round = 0; round < 20; round++) {
		const chunk = await getJson(view, `/api/files/${apiPath(path)}?type=read&offset=${offset}`);
		content += chunk.content;
		if (!chunk.truncated) return content;
		offset = chunk.nextOffset;
	}
	return content;
}

async function pageVersion(view: Window, path: string): Promise<string> {
	const meta = await getJson(view, `/api/files/${apiPath(path)}?type=meta`);
	return `${meta.size}:${meta.mtime}`;
}

function messageDocument(text: string): string {
	const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return `<!DOCTYPE html><html lang="ja"><body style="margin:0;padding:48px 20px;font:14px/1.6 system-ui,sans-serif;color:#a9a9b2;background:#1b1b1d">${safe}</body></html>`;
}

/** 小窓の枠を返す。無ければ作る。中のページは、Pi Web のプレビューと同じ制限つきの枠に描く */
function ensureBox(view: Window, onClose: () => void): { box: HTMLElement; frame: HTMLIFrameElement } {
	const existing = view.document.getElementById(SETTINGS.boxId);
	if (existing) return { box: existing, frame: existing.querySelector("iframe") as HTMLIFrameElement };
	const box = view.document.createElement("div");
	box.id = SETTINGS.boxId;
	box.style.cssText = SETTINGS.boxStyle;
	const frame = view.document.createElement("iframe");
	frame.setAttribute("sandbox", "allow-scripts");
	frame.title = "タイムライン";
	frame.style.cssText = SETTINGS.frameStyle;
	const close = view.document.createElement("button");
	close.type = "button";
	close.textContent = "×";
	close.setAttribute("aria-label", "閉じる");
	close.style.cssText = SETTINGS.closeStyle;
	close.addEventListener("click", onClose);
	box.append(frame, close);
	view.document.body.append(box);
	return { box, frame };
}

function closePopup(view: Window, state: PopupState): void {
	const box = view.document.getElementById(SETTINGS.boxId);
	if (box) box.style.display = "none";
	view.clearInterval(state.timer);
	state.tab = undefined;
}

/** ページが変わっていれば読み直して描く。セッションが変わっていれば、場所から調べ直す */
async function loadInto(view: Window, state: PopupState, frame: HTMLIFrameElement): Promise<void> {
	const sessionId = sessionIdFrom(view.location.search);
	if (sessionId === "") throw new Error("セッションが選ばれていません");
	if (state.path === "" || state.sessionId !== sessionId) {
		state.path = await findPage(view, sessionId);
		state.sessionId = sessionId;
		state.version = "";
	}
	const version = await pageVersion(view, state.path);
	if (version === state.version) return;
	const html = await readPage(view, state.path);
	state.version = version;
	state.shown = "";
	frame.srcdoc = withPageOptions(html, { tab: state.tab ?? "tasks", theme: themeOf(view) });
}

function openPopup(view: Window, state: PopupState, tab: Tab): void {
	const { box, frame } = ensureBox(view, () => closePopup(view, state));
	state.tab = tab;
	state.version = "";
	box.style.display = "block";
	const update = (): void => {
		loadInto(view, state, frame).catch((error: unknown) => {
			const text = `ページを表示できません: ${error instanceof Error ? error.message : String(error)}`;
			state.path = "";
			if (state.shown === text) return;
			state.shown = text;
			frame.srcdoc = messageDocument(text);
		});
	};
	update();
	view.clearInterval(state.timer);
	state.timer = view.setInterval(update, SETTINGS.refreshMs);
}

/**
 * timeline と reports のボタンの押下を小窓に回す。同じボタンをもう一度押すか、× で閉じる。
 * キーは見張らない。Pi Web では Esc が実行の中断なので、小窓を閉じるつもりの Esc が作業を止めてしまう。
 */
export function installPopup(view: Window): void {
	const state: PopupState = { tab: undefined, sessionId: "", path: "", version: "", shown: "", timer: 0 };
	view.document.addEventListener("click", (event) => {
		const tab = tabForClick(event);
		if (tab === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		if (state.tab === tab) closePopup(view, state);
		else openPopup(view, state, tab);
	}, true);
}

const EMBEDDED = [sessionIdFrom, apiPath, pageNameFor, tabForClick, withPageOptions, themeOf, getJson, findPage, readPage, pageVersion, messageDocument, ensureBox, closePopup, loadInto, openPopup, installPopup];
const LAYOUT_NAME = /^layout-[^.]+\.js$/;
const CHUNK_PREFIX = "(self.webpackChunk_N_E";

/** Pi Web の画面の共通部分のチャンクか。足す先をこれに限る */
export function isLayoutChunk(name: string, content: string): boolean {
	return LAYOUT_NAME.test(name) && content.startsWith(CHUNK_PREFIX);
}

/** チャンクの末尾に足すスクリプト。失敗しても、Pi Web の画面は元のまま動く */
export function buildPopupScript(): string {
	const definitions = EMBEDDED.map((embedded) => `var ${embedded.name} = ${embedded.toString()};`);
	return [";(function () {", "try {", `var SETTINGS = ${JSON.stringify(SETTINGS)};`, ...definitions, "installPopup(window);", "} catch (error) {", 'if (window.console) window.console.warn("[pi-todo-timeline]", error);', "}", "})();"].join("\n");
}
