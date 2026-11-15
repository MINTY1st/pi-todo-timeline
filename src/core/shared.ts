// 複数のファイルで使う小さな関数
export type Fields = Record<string, unknown>;

export const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

const CONTROL_CHARACTERS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`, "g");
const WHITESPACE_CONTROLS = new Set(["\n", "\r", "\t"]);

/** 端末に出す文から制御文字を取り除く（色や画面の制御を紛れ込ませないため）。改行とタブは空白にする */
export function withoutControls(value: string): string {
	return value.replace(CONTROL_CHARACTERS, (character) => (WHITESPACE_CONTROLS.has(character) ? " " : ""));
}

/** 空白と改行を1つの空白に詰め、上限を超えた分を切って「…」を付ける */
export function clip(value: string, maxChars: number): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

/** 間隔の呼び名（15分、1時間など） */
export function periodLabel(periodMs: number): string {
	const minutes = Math.round(periodMs / 60_000);
	return minutes % 60 === 0 ? `${minutes / 60}時間` : `${minutes}分`;
}
