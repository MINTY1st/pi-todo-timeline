// 複数のファイルで使う小さな関数
export type Fields = Record<string, unknown>;

export const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

/** 空白と改行を1つの空白に詰め、上限を超えた分を切って「…」を付ける */
export function clip(value: string, maxChars: number): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}
