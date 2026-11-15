// Pi Web の CSS に足す、パネルの高さの上書き
import { applyPatch, patchText } from "./patch.ts";
import type { PatchFiles, PatchOutcome, PatchTarget } from "./patch.ts";

export type CssFiles = PatchFiles;
export type CssOutcome = PatchOutcome;

/** Pi Web が拡張のパネルを入れる枠。元の規則は max-height: min(144px, 18dvh) */
export const PANEL_SELECTOR = ".extension-widget-panels";

export function buildRule(percent: number): string {
	return `${PANEL_SELECTOR}{max-height:${percent}dvh!important}`;
}

/** 規則を末尾に目印つきで入れた中身を返す。rule が undefined なら外す。変わらなければ null */
export const patchCss = patchText;

const PANEL_CSS: PatchTarget = { matchesName: (name) => name.endsWith(".css"), matchesContent: (content) => content.includes(PANEL_SELECTOR) };

/** パネルの規則を含む CSS のファイルにだけ、上書きを足す（rule が undefined なら外す） */
export function applyToDirectory(files: CssFiles, cssDirectory: string, rule: string | undefined): CssOutcome {
	return applyPatch(files, cssDirectory, PANEL_CSS, rule, `${PANEL_SELECTOR} を含む CSS がありません（${cssDirectory}）`);
}
