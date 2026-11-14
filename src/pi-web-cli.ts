// Pi Web に、パネルの高さの上書きと小窓のスクリプトを足す・外すコマンド。使い方は README.md
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configPath, loadConfig } from "./config.ts";
import { createFileAccess } from "./files.ts";
import { applyToDirectory, buildRule } from "./web-css.ts";
import { applyPatch } from "./web-patch.ts";
import type { PatchFiles, PatchOutcome } from "./web-patch.ts";
import { buildPopupScript, isLayoutChunk } from "./web-popup.ts";

export interface CliContext {
	files: PatchFiles;
	environment: Record<string, string | undefined>;
	/** 実行している node の場所。Pi Web の既定の場所を決めるのに使う */
	execPath: string;
	/** 設定の panelMaxHeightPercent */
	percent(): number;
	/** 設定の webPopup */
	popup(): boolean;
}

type Action = "apply" | "remove";

const USAGE = [
	"使い方: node src/pi-web-cli.ts <apply|remove> [--dir <Pi Web のディレクトリ>]",
	"  apply   パネルの高さの上限を設定の panelMaxHeightPercent にし、小窓のスクリプトを足す（設定の webPopup が false なら足さない）",
	"  remove  足したものを外す",
	"  Pi Web の場所は、--dir、環境変数 PI_WEB_DIR の順に決め、どちらも無ければ npm が全体に入れた場所を探す",
];
const POPUP_TARGET_MISSING = "小窓のスクリプトを足す先がありません（Pi Web の画面の共通部分のチャンクが見つかりません）";
const RELOAD_HINT = "ブラウザでキャッシュを使わない再読み込み（Ctrl+Shift+R）をすると反映されます";

function parse(argv: readonly string[]): { action: Action; directory: string | undefined } | undefined {
	const [action, flag, directory, ...rest] = argv;
	if (action !== "apply" && action !== "remove") return undefined;
	if (flag === undefined) return { action, directory: undefined };
	if (flag !== "--dir" || !directory || rest.length > 0) return undefined;
	return { action, directory };
}

const cssDirectoryOf = (piWeb: string): string => join(piWeb, ".next", "static", "css");

/** 場所の指定が無いときに探す所。npm が全体に入れたパッケージの置き場は、OS と Node の入れ方で違う */
function defaultLocations(context: CliContext): string[] {
	const besideNode = dirname(context.execPath);
	const appData = context.environment.APPDATA;
	return [
		join(besideNode, "..", "lib", "node_modules", "@agegr", "pi-web"), // Linux と macOS
		join(besideNode, "node_modules", "@agegr", "pi-web"), // Windows で、node と同じ場所に入れる構成
		...(appData ? [join(appData, "npm", "node_modules", "@agegr", "pi-web")] : []), // Windows の npm の既定
	];
}

/** Pi Web の場所を決める。指定があればそれを使い、無ければ CSS の置き場がある最初の候補を使う */
function locate(directory: string | undefined, context: CliContext): string | string[] {
	const chosen = directory ?? (context.environment.PI_WEB_DIR || undefined);
	if (chosen !== undefined) return chosen;
	const candidates = defaultLocations(context);
	return candidates.find((candidate) => context.files.list(cssDirectoryOf(candidate)) !== undefined) ?? candidates;
}

function reportCss(action: Action, outcome: PatchOutcome, percent: number | undefined): string[] {
	if (action === "remove") return [outcome.changed.length > 0 ? `高さの上書きを外しました: ${outcome.changed.join(", ")}` : "高さの上書きは入っていません"];
	const height = `画面の高さの ${percent}%`;
	if (outcome.changed.length === 0) return [`高さの上書きはすでに入っています（${height}）: ${outcome.unchanged.join(", ")}`];
	return [`パネルの高さの上限を${height} にする上書きを足しました: ${outcome.changed.join(", ")}`];
}

/** wanted は、小窓のスクリプトを足すつもりか（apply で、設定の webPopup が true のとき）。足さないときは、入っていれば外す */
function reportPopup(wanted: boolean, outcome: PatchOutcome): string[] {
	// 足す先のディレクトリが無いときも、チャンクが無いときも、同じ理由として伝える
	if (!outcome.ok) return wanted ? [POPUP_TARGET_MISSING] : [];
	const names = [...outcome.changed, ...outcome.unchanged].join(", ");
	if (!wanted) return outcome.changed.length > 0 ? [`小窓のスクリプトを外しました: ${names}`] : [];
	return [outcome.changed.length > 0 ? `小窓のスクリプトを足しました: ${names}` : `小窓のスクリプトはすでに入っています: ${names}`];
}

/** 小窓のスクリプトを足す。足さないとき（remove か、設定で切ってあるとき）は、入っていれば外す */
function patchPopup(piWeb: string, action: Action, context: CliContext): { wanted: boolean; outcome: PatchOutcome } {
	const wanted = action === "apply" && context.popup();
	const directory = join(piWeb, ".next", "static", "chunks", "app");
	return { wanted, outcome: applyPatch(context.files, directory, isLayoutChunk, wanted ? buildPopupScript() : undefined, POPUP_TARGET_MISSING) };
}

/** 見つかった Pi Web に、高さの上書きと小窓のスクリプトを足す（外す） */
function patchPiWeb(piWeb: string, action: Action, context: CliContext): { exitCode: number; lines: string[] } {
	const percent = action === "apply" ? context.percent() : undefined;
	const css = applyToDirectory(context.files, cssDirectoryOf(piWeb), percent === undefined ? undefined : buildRule(percent));
	if (!css.ok) return { exitCode: 1, lines: [css.message] };
	const popup = patchPopup(piWeb, action, context);
	const changed = [css, popup.outcome].some((outcome) => outcome.ok && outcome.changed.length > 0);
	const lines = [...reportCss(action, css, percent), ...reportPopup(popup.wanted, popup.outcome)];
	return { exitCode: popup.wanted && !popup.outcome.ok ? 1 : 0, lines: changed ? [...lines, RELOAD_HINT] : lines };
}

export function run(argv: readonly string[], context: CliContext): { exitCode: number; lines: string[] } {
	const parsed = parse(argv);
	if (parsed === undefined) return { exitCode: 1, lines: USAGE };
	const piWeb = locate(parsed.directory, context);
	if (typeof piWeb === "string") return patchPiWeb(piWeb, parsed.action, context);
	return { exitCode: 1, lines: ["Pi Web が見つかりません。探した場所:", ...piWeb.map((candidate) => `  ${candidate}`), "--dir <Pi Web のディレクトリ> で場所を指定してください"] };
}

if (import.meta.main) {
	const settings = (): ReturnType<typeof loadConfig>["config"] => loadConfig(configPath(process.env, homedir()), (path) => readFileSync(path, "utf8")).config;
	const result = run(process.argv.slice(2), { files: createFileAccess(), environment: process.env, execPath: process.execPath, percent: () => settings().panelMaxHeightPercent, popup: () => settings().webPopup });
	for (const line of result.lines) console.log(line);
	process.exitCode = result.exitCode;
}
