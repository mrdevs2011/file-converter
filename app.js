const drop = document.getElementById("drop");
const input = document.getElementById("file");
const fileName = document.getElementById("fileName");
const fileChips = document.getElementById("fileChips");
const go = document.getElementById("go");
const result = document.getElementById("result");
const fmt = document.getElementById("fmt");

let files = [];
let lastTable = null;
let lastFilename = "";

/* ========== Custom Dropdown ========== */
(function initCustomDropdown() {
  const cdd = document.getElementById("fmtCdd");
  const trigger = document.getElementById("fmtTrigger");
  const panel = document.getElementById("fmtPanel");
  const list = document.getElementById("fmtList");
  const valueEl = document.getElementById("fmtValue");
  if (!cdd || !trigger || !panel || !list) return;

  const options = Array.from(list.querySelectorAll('[role="option"]'));
  let activeIndex = options.findIndex((o) => o.getAttribute("aria-selected") === "true");
  if (activeIndex < 0) activeIndex = 0;

  function syncNative(value) {
    if (fmt) {
      fmt.value = value;
      // keep selected attribute in sync for form consistency
      Array.from(fmt.options).forEach((opt) => {
        opt.selected = opt.value === value;
      });
    }
  }

  function setValue(optionEl, close) {
    if (!optionEl) return;
    const value = optionEl.getAttribute("data-value");
    const label = optionEl.textContent.trim();
    options.forEach((o) => {
      o.setAttribute("aria-selected", o === optionEl ? "true" : "false");
      o.classList.remove("cdd-highlight");
    });
    optionEl.setAttribute("aria-selected", "true");
    valueEl.textContent = label;
    syncNative(value);
    activeIndex = options.indexOf(optionEl);
    if (close !== false) closeDropdown();
  }

  function openDropdown() {
    if (cdd.classList.contains("open")) return;
    panel.hidden = false;
    // force reflow so transition runs
    void panel.offsetHeight;
    cdd.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    // highlight current selection
    options.forEach((o, i) => {
      o.classList.toggle("cdd-highlight", i === activeIndex);
    });
    // scroll selected into view
    const selected = options[activeIndex];
    if (selected) {
      requestAnimationFrame(() => {
        selected.scrollIntoView({ block: "nearest" });
      });
    }
    // focus list for keyboard
    list.focus({ preventScroll: true });
  }

  function closeDropdown() {
    if (!cdd.classList.contains("open")) return;
    cdd.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    // wait for transition then hide
    setTimeout(() => {
      if (!cdd.classList.contains("open")) panel.hidden = true;
    }, 220);
    options.forEach((o) => o.classList.remove("cdd-highlight"));
  }

  function toggleDropdown() {
    if (cdd.classList.contains("open")) closeDropdown();
    else openDropdown();
  }

  // Trigger click
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDropdown();
  });

  // Option click (use pointerup for better mobile)
  list.addEventListener("click", (e) => {
    const opt = e.target.closest('[role="option"]');
    if (opt) {
      e.preventDefault();
      e.stopPropagation();
      setValue(opt);
    }
  });

  // Keyboard on trigger
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!cdd.classList.contains("open")) {
        openDropdown();
      } else if (e.key === "Enter" || e.key === " ") {
        setValue(options[activeIndex]);
      } else if (e.key === "ArrowDown") {
        moveHighlight(1);
      } else if (e.key === "ArrowUp") {
        moveHighlight(-1);
      }
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  });

  // Keyboard inside list
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveHighlight(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      moveHighlight(options.length - 1, true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setValue(options[activeIndex]);
    } else if (e.key === "Escape" || e.key === "Tab") {
      closeDropdown();
      if (e.key === "Escape") trigger.focus();
    } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
      // type-ahead
      const ch = e.key.toLowerCase();
      const start = activeIndex + 1;
      let found = -1;
      for (let i = 0; i < options.length; i++) {
        const idx = (start + i) % options.length;
        if (options[idx].textContent.trim().toLowerCase().startsWith(ch)) {
          found = idx;
          break;
        }
      }
      if (found >= 0) {
        e.preventDefault();
        activeIndex = found;
        options.forEach((o, i) => o.classList.toggle("cdd-highlight", i === activeIndex));
        options[activeIndex].scrollIntoView({ block: "nearest" });
      }
    }
  });

  function moveHighlight(delta, absolute) {
    if (absolute) {
      activeIndex = delta;
    } else {
      activeIndex = (activeIndex + delta + options.length) % options.length;
    }
    options.forEach((o, i) => o.classList.toggle("cdd-highlight", i === activeIndex));
    options[activeIndex].scrollIntoView({ block: "nearest" });
  }

  // Close on outside click / touch
  document.addEventListener("pointerdown", (e) => {
    if (cdd.classList.contains("open") && !cdd.contains(e.target)) {
      closeDropdown();
    }
  });

  // Close on Escape globally
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && cdd.classList.contains("open")) {
      closeDropdown();
      trigger.focus();
    }
  });

  // Prevent scroll bleed on mobile when panel is open
  panel.addEventListener("touchmove", (e) => {
    // allow scroll inside list only
    if (!list.contains(e.target) && e.target !== list) {
      e.preventDefault();
    }
  }, { passive: false });

  // Initial sync
  const initial = options.find((o) => o.getAttribute("aria-selected") === "true") || options[0];
  if (initial) {
    valueEl.textContent = initial.textContent.trim();
    syncNative(initial.getAttribute("data-value"));
  }
})();

/* ========== File handling ========== */
function setFiles(list, note) {
  const next = Array.from(list || []).filter(Boolean);
  if (!next.length) return;
  files = next;
  fileName.textContent = files.map((f) => f.name).join(", ") + (note ? " — " + note : "");
  fileChips.innerHTML = files.map((f, i) => {
    const name = escapeHtml(f.name);
    return '<span class="chip" style="animation-delay:' + (i * 40) + 'ms"><span title="' + name + '">' + name + "</span></span>";
  }).join("");
  go.disabled = false;
  drop.classList.add("has-files");
}

drop.addEventListener("click", () => input.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    input.click();
  }
});
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
});
input.addEventListener("change", () => {
  if (input.files.length) setFiles(input.files);
});

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
    const t = text.trim();
    let name = "pasted.json";
    if (t.charAt(0) === "<") name = /<html/i.test(t) ? "pasted.html" : "pasted.xml";
    else if (t.indexOf("|") !== -1 && t.indexOf("\n") !== -1) name = "pasted.md";
    else if (/^[\w.-]+:\s+/m.test(t) || t.indexOf("---") === 0) name = "pasted.yaml";
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

function buildTableHtml(table, maxRows) {
  const max = Math.min(table.rows.length, maxRows == null ? table.rows.length : maxRows);
  let html = "<table><thead><tr>" + table.columns.map((c) => "<th>" + escapeHtml(c) + "</th>").join("") + "</tr></thead><tbody>";
  for (let i = 0; i < max; i++) {
    html += "<tr>" + table.rows[i].map((v) => "<td>" + escapeHtml(v) + "</td>").join("") + "</tr>";
  }
  html += "</tbody></table>";
  if (maxRows != null && table.rows.length > max) {
    html += '<div class="more-hint">… va yana ' + (table.rows.length - max) + " qator · Full screen da hammasi</div>";
  }
  return html;
}

function showPreview(table, filename) {
  lastTable = table;
  lastFilename = filename;
  result.classList.add("has-data");
  let html = '<div class="preview-header">';
  html += '<div class="name" title="' + escapeHtml(filename) + '">' + escapeHtml(filename) + "</div>";
  html += '<button type="button" class="fs-btn" id="fsBtn" title="To\'liq ekran">⛶ Full screen</button>';
  html += "</div>";
  html += '<div class="preview-meta">Tayyor — ' + table.rows.length + " × " + table.columns.length + " · preview: birinchi 30 qator</div>";
  html += '<div class="preview-scroll">' + buildTableHtml(table, 30) + "</div>";
  result.innerHTML = html;

  const fsBtn = document.getElementById("fsBtn");
  if (fsBtn) fsBtn.addEventListener("click", openFullscreen);
}

function openFullscreen() {
  if (!lastTable) return;
  let overlay = document.getElementById("fsOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "fsOverlay";
    overlay.className = "fs-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.body.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div class="fs-panel">' +
    '<div class="fs-top">' +
    '<div class="fs-title">' + escapeHtml(lastFilename) + " — " + lastTable.rows.length + " × " + lastTable.columns.length + "</div>" +
    '<button type="button" class="fs-close" id="fsClose">✕ Yopish</button>' +
    "</div>" +
    '<div class="fs-body">' + buildTableHtml(lastTable, null) + "</div>" +
    "</div>";

  requestAnimationFrame(() => {
    overlay.classList.add("open");
  });
  document.body.style.overflow = "hidden";

  document.getElementById("fsClose").onclick = closeFullscreen;
  overlay.onclick = function (e) {
    if (e.target === overlay) closeFullscreen();
  };
}

function closeFullscreen() {
  const overlay = document.getElementById("fsOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.style.overflow = "";
  setTimeout(() => {
    if (!overlay.classList.contains("open")) overlay.innerHTML = "";
  }, 300);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeFullscreen();
});

go.addEventListener("click", async () => {
  if (!files.length) {
    result.classList.remove("has-data");
    result.innerHTML = '<div class="status err">Avval fayl tanlang</div>';
    return;
  }
  go.disabled = true;
  go.classList.add("loading");
  result.classList.remove("has-data");
  result.innerHTML = '<div class="empty-hint"><p>Converting…</p></div>';
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
    result.classList.remove("has-data");
    result.innerHTML = '<div class="status err">' + escapeHtml(err.message || String(err)) + "</div>";
  } finally {
    go.classList.remove("loading");
    go.disabled = false;
  }
});
