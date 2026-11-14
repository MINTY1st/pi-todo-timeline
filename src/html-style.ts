// ページの見た目と、タブの切り替え。外の資源は読み込まない
const DARK_COLORS = "--bg:#1b1b1d; --panel:#242427; --line:#3a3a3f; --text:#e9e9ec; --muted:#a9a9b2; --dim:#8a8a94; --accent:#8fb4ff; --done:#5fd38d; --warn:#f2c462; --act:#7fd1e0;";
const LIGHT_COLORS = "--bg:#fafafa; --panel:#fff; --line:#e3e3e8; --text:#1d1d22; --muted:#5d5d68; --dim:#85858f; --accent:#2f62d6; --done:#1f9d57; --warn:#a56a00; --act:#0b7f93;";

export const PAGE_STYLE = `
:root { ${DARK_COLORS} }
@media (prefers-color-scheme: light) { :root { ${LIGHT_COLORS} } }
html[data-theme=dark] { ${DARK_COLORS} }
html[data-theme=light] { ${LIGHT_COLORS} }
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--text); font:14px/1.6 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif; padding:18px 18px 40px; max-width:760px; margin:0 auto; }
h1 { font-size:17px; font-weight:650; }
.sub { color:var(--dim); font-size:12px; margin-top:2px; }
.tabs { display:flex; gap:18px; border-bottom:1px solid var(--line); margin:14px 0 16px; }
.tabs button { background:none; border:none; color:var(--muted); font:inherit; padding:8px 0; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tabs button[aria-selected=true] { color:var(--accent); border-bottom-color:var(--accent); }
.count { color:var(--dim); font-size:12px; margin-left:4px; }
.empty { color:var(--dim); padding:18px 4px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.progress-head { display:flex; justify-content:space-between; align-items:baseline; }
.label { font-weight:600; }
.badge { font-size:11px; padding:1px 8px; border-radius:999px; border:1px solid currentColor; }
.badge.active { color:var(--accent); } .badge.done { color:var(--done); } .badge.idle { color:var(--dim); }
.bar-row { display:flex; align-items:center; gap:14px; margin:10px 0 6px; }
.bar { flex:1; height:6px; border-radius:3px; background:var(--line); overflow:hidden; }
.bar .done { display:block; height:100%; background:var(--done); }
.percent { font-size:22px; font-weight:650; font-variant-numeric:tabular-nums; } .percent small { font-size:12px; color:var(--muted); margin-left:1px; }
.progress-foot { display:flex; justify-content:space-between; color:var(--dim); font-size:12px; }
.now { margin-top:10px; padding-top:10px; border-top:1px solid var(--line); font-size:13px; } .now b { color:var(--accent); font-weight:600; }
.tasks { list-style:none; margin-top:10px; }
.tasks li { display:grid; grid-template-columns:22px 1fr; padding:11px 4px; border-bottom:1px solid var(--line); }
.tasks li:last-child { border-bottom:none; }
.completed .mark, .completed .tag { color:var(--done); } .in_progress .mark, .in_progress .tag { color:var(--accent); } .pending .mark { color:var(--dim); }
.title { font-weight:550; } .pending .title { color:var(--muted); font-weight:450; }
.result { grid-column:2; color:var(--muted); font-size:12.5px; margin-top:2px; }
.tag { font-size:10.5px; border-radius:4px; padding:0 5px; margin-right:6px; border:1px solid currentColor; }
.reports { position:relative; margin-left:6px; padding-left:22px; border-left:2px solid var(--line); }
.report { position:relative; margin-bottom:16px; }
.report::before { content:""; position:absolute; left:-29px; top:16px; width:10px; height:10px; border-radius:50%; background:var(--bg); border:2px solid var(--accent); }
.report.rollup::before { background:var(--accent); width:12px; height:12px; left:-30px; }
.report-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px; color:var(--dim); margin-bottom:6px; }
.time { color:var(--text); font-weight:600; font-size:13px; font-variant-numeric:tabular-nums; }
.level { font-size:11px; border-radius:4px; padding:0 6px; background:var(--line); color:var(--muted); }
.rollup .level { background:var(--accent); color:var(--bg); }
.lead { font-weight:550; }
.report ul { margin:6px 0 0 18px; color:var(--muted); font-size:13px; }
.note { margin-top:8px; font-size:13px; display:grid; grid-template-columns:auto 1fr; gap:2px 8px; }
.note dt { font-size:11px; border-radius:4px; padding:0 6px; height:19px; line-height:19px; margin-top:2px; border:1px solid currentColor; white-space:nowrap; }
.note .open { color:var(--warn); } .note .todo { color:var(--act); }
details { margin-top:8px; font-size:12.5px; color:var(--muted); } summary { cursor:pointer; color:var(--dim); } details li { margin-top:3px; }
.updated { color:var(--dim); font-size:11px; margin-top:22px; text-align:right; }
[hidden] { display:none !important; }
`;

/**
 * 選んだタブは window.name に覚え、ファイルの更新で描き直されても同じタブを開く。
 * html の要素に data-tab があれば、そちらを優先する（小窓が、押されたボタンに合わせて指定する）。
 */
export const PAGE_SCRIPT = `
(function () {
	var prefix = "pi-timeline:";
	var buttons = document.querySelectorAll(".tabs button");
	function show(tab) {
		buttons.forEach(function (button) { button.setAttribute("aria-selected", String(button.dataset.tab === tab)); });
		document.querySelectorAll("section").forEach(function (section) { section.hidden = section.id !== tab; });
		try { window.name = prefix + tab; } catch (error) {}
	}
	buttons.forEach(function (button) { button.addEventListener("click", function () { show(button.dataset.tab); }); });
	var saved = "";
	try { saved = window.name || ""; } catch (error) {}
	var requested = document.documentElement.getAttribute("data-tab") || "";
	if (requested === "reports" || (requested === "" && saved === prefix + "reports")) show("reports");
})();
`;
