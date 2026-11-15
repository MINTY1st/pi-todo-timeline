// Pi Web の配布物に、パネルの高さの上書きと小窓のスクリプトを足す・外す。コマンドと、Pi Web の中で動く拡張の両方が使う
import { join } from "node:path";
import { applyToDirectory, buildRule } from "./css.ts";
import { applyPatch } from "./patch.ts";
import type { PatchFiles, PatchOutcome } from "./patch.ts";
import { buildPopupScript, LAYOUT_TARGET } from "./popup.ts";

export type Action = "apply" | "remove";

export interface PatchSettings {
	files: PatchFiles;
	/** 設定の panelMaxHeightPercent */
	percent(): number;
	/** 設定の webPopup */
	popup(): boolean;
}

const PI_WEB_PACKAGE = "@agegr/pi-web";
const POPUP_TARGET_MISSING = "小窓のスクリプトを足す先がありません（Pi Web の画面の共通部分のチャンクが見つかりません）";
export const RELOAD_HINT = "ブラウザでキャッシュを使わない再読み込み（Ctrl+Shift+R）をすると反映されます";

export const cssDirectoryOf = (piWeb: string): string => join(piWeb, ".next", "static", "css");

/** そのディレクトリが Pi Web のパッケージか。Pi Web は、自分のパッケージの置き場を作業ディレクトリにして動く */
export function isPiWeb(directory: string, files: PatchFiles): boolean {
	try {
		const manifest: unknown = JSON.parse(files.read(join(directory, "package.json")) ?? "null");
		return typeof manifest === "object" && manifest !== null && (manifest as { name?: unknown }).name === PI_WEB_PACKAGE;
	} catch {
		return false;
	}
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
function patchPopup(piWeb: string, action: Action, context: PatchSettings): { wanted: boolean; outcome: PatchOutcome } {
	const wanted = action === "apply" && context.popup();
	const directory = join(piWeb, ".next", "static", "chunks", "app");
	return { wanted, outcome: applyPatch(context.files, directory, LAYOUT_TARGET, wanted ? buildPopupScript() : undefined, POPUP_TARGET_MISSING) };
}

/** 見つかった Pi Web に、高さの上書きと小窓のスクリプトを足す（外す） */
/** failure は、失敗したときの理由だけ（経過の行を含めない。同じ理由を何度も知らせないための鍵にもなる） */
export function patchPiWeb(piWeb: string, action: Action, context: PatchSettings): { exitCode: number; lines: string[]; failure?: string } {
	const percent = action === "apply" ? context.percent() : undefined;
	const css = applyToDirectory(context.files, cssDirectoryOf(piWeb), percent === undefined ? undefined : buildRule(percent));
	if (!css.ok) return { exitCode: 1, lines: [css.message], failure: css.message };
	const popup = patchPopup(piWeb, action, context);
	const changed = [css, popup.outcome].some((outcome) => outcome.ok && outcome.changed.length > 0);
	const lines = [...reportCss(action, css, percent), ...reportPopup(popup.wanted, popup.outcome)];
	const failed = popup.wanted && !popup.outcome.ok;
	return { exitCode: failed ? 1 : 0, lines: changed ? [...lines, RELOAD_HINT] : lines, ...(failed ? { failure: POPUP_TARGET_MISSING } : {}) };
}
