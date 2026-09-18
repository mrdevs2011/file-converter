const drop = document.getElementById("drop");
const input = document.getElementById("file");
const fileName = document.getElementById("fileName");
const go = document.getElementById("go");
const result = document.getElementById("result");
const fmt = document.getElementById("fmt");

let files = [];

function setFiles(list, note) {
  const next = Array.from(list || []).filter(Boolean);
  if (!next.length) return;
  files = next;
  fileName.textContent = files.map((f) => f.name).join(", ") + (note ? " — " + note : "");
  go.disabled = false;
}

drop.addEventListener("click", () => input.click());
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
});
input.addEventListener("change", () => { if (input.files.length) setFiles(input.files); });

window.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const pasted = [];
  for (const item of items) {
    if (item.kind === "file") pasted.push(item.getAsFile());
  }
  if (pasted.length) {
    e.preventDefault();
    setFiles(pasted, "CTRL V");
    return;
  }
  const text = e.clipboardData.getData("text");
  if (text && text.trim()) {
    e.preventDefault();
    const name = text.trim().charAt(0) === "<" ? "pasted.xml" : "pasted.json";
    setFiles([new File([text], name, { type: "text/plain" })], "CTRL V");
  }
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function showPreview(table, filename) {
  const max = Math.min(table.rows.length, 20);
  let html = '<div class="name">' + escapeHtml(filename) + "</div>";
  html += '<div class="status">Ready — ' + table.rows.length + " x " + table.columns.length + "</div>";
  html += "<table><thead><tr>" + table.columns.map((c) => "<th>" + escapeHtml(c) + "</th>").join("") + "</tr></thead><tbody>";
  for (let i = 0; i < max; i++) {
    html += "<tr>" + table.rows[i].map((v) => "<td>" + escapeHtml(v) + "</td>").join("") + "</tr>";
  }
  html += "</tbody></table>";
  result.innerHTML = html;
}

go.addEventListener("click", async () => {
  if (!files.length) {
    result.innerHTML = '<div class="status err">Choose a file first</div>';
    return;
  }
  go.disabled = true;
  result.innerHTML = '<div class="status">Converting...</div>';
  try {
    const parts = [];
    for (const f of files) parts.push(await FileConvert.readFile(f));
    const table = FileConvert.mergeTables(parts);
    const format = fmt.value;
    const out = FileConvert.write(table, format);
    const stem = (files[0].name || "file").replace(/\.[^.]+$/, "") || "file";
    const extra = files.length > 1 ? "-merged" : "";
    const filename = stem + extra + "." + out.ext;
    FileConvert.download(filename, out.mime, out.data);
    showPreview(table, filename);
  } catch (err) {
    result.innerHTML = '<div class="status err">' + escapeHtml(err.message || String(err)) + "</div>";
  } finally {
    go.disabled = false;
  }
});
