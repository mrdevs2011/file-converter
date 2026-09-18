/**
 * Offline tests for File Converter — Node, vendor libs only.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = (() => {
  try { return require("jsdom"); } catch (e) { return { JSDOM: null }; }
})();

// Load vendors
const XLSX = require(path.join(__dirname, "../vendor/xlsx.full.min.js"));
global.XLSX = XLSX;
// papaparse & jsyaml as browser umd
const vm = require("vm");
function loadUmd(code) {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  sandbox.module = { exports: {} };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.module.exports;
}
const Papa = loadUmd(fs.readFileSync(path.join(__dirname, "../vendor/papaparse.min.js"), "utf8"));
const jsyaml = loadUmd(fs.readFileSync(path.join(__dirname, "../vendor/js-yaml.min.js"), "utf8"));
if (!Papa || !Papa.parse) throw new Error("Papa not loaded");
if (!jsyaml || !jsyaml.load) throw new Error("jsyaml not loaded");
console.log("libs: Papa + jsyaml OK");

// Minimal DOMParser for XML/HTML if no jsdom
function makeDOMParser() {
  if (JSDOM) {
    return class {
      parseFromString(str, type) {
        const dom = new JSDOM(str, { contentType: type.includes("xml") ? "text/xml" : "text/html" });
        return dom.window.document;
      }
    };
  }
  // Very minimal fallback for our test XML/HTML only
  const { parse } = require("node:util"); // won't work
  return null;
}

// ---- Core logic extracted / simplified from converter.js ----
const READ_EXT = {
  json: "json", jsonl: "jsonl", ndjson: "jsonl",
  csv: "csv", tsv: "tsv", txt: "txt",
  xlsx: "xlsx", xls: "xlsx", xlsm: "xlsx", xlsb: "xlsx", ods: "xlsx",
  yaml: "yaml", yml: "yaml",
  xml: "xml", html: "html", htm: "html",
  md: "md", markdown: "md"
};

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function isScalar(v) {
  return v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function asText(v) {
  if (v === null || v === undefined) return "";
  if (isScalar(v)) return String(v);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function flatten(obj, prefix, out) {
  prefix = prefix || "";
  out = out || {};
  if (isScalar(obj)) {
    out[prefix || "value"] = obj === null || obj === undefined ? "" : obj;
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.every(isScalar)) {
      out[prefix || "value"] = obj.map(asText).join(", ");
      return out;
    }
    out[prefix || "value"] = asText(obj);
    return out;
  }
  const keys = Object.keys(obj);
  if (!keys.length) {
    if (prefix) out[prefix] = "";
    return out;
  }
  keys.forEach(function (k) {
    flatten(obj[k], prefix ? prefix + "." + k : k, out);
  });
  return out;
}

function recordsFrom(obj) {
  if (obj === null || obj === undefined) return [];
  if (Array.isArray(obj)) {
    if (!obj.length) return [];
    if (obj.every(function (x) { return x && typeof x === "object" && !Array.isArray(x); })) {
      return obj.map(function (row) { return flatten(row); });
    }
    if (obj.every(isScalar)) {
      return obj.map(function (x) { return { value: x }; });
    }
    if (obj.every(Array.isArray)) {
      var width = obj.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      return obj.map(function (r) {
        var row = {};
        for (var i = 0; i < width; i++) row["col_" + (i + 1)] = r[i] === undefined ? "" : r[i];
        return row;
      });
    }
    return obj.map(function (x) { return flatten(x); });
  }
  if (typeof obj === "object") {
    var keys = Object.keys(obj);
    var listKeys = keys.filter(function (k) { return Array.isArray(obj[k]); });
    if (keys.length === 1 && listKeys.length === 1) return recordsFrom(obj[listKeys[0]]);
    if (listKeys.length === 1 && obj[listKeys[0]].every(function (x) { return x && typeof x === "object"; })) {
      return recordsFrom(obj[listKeys[0]]);
    }
    if (keys.length && keys.every(function (k) { return Array.isArray(obj[k]) && obj[k].every(isScalar); })) {
      var n = obj[keys[0]].length;
      if (keys.every(function (k) { return obj[k].length === n; })) {
        var rows = [];
        for (var i = 0; i < n; i++) {
          var row = {};
          keys.forEach(function (k) { row[k] = obj[k][i]; });
          rows.push(row);
        }
        return rows;
      }
    }
    return [flatten(obj)];
  }
  return [{ value: obj }];
}

function unionColumns(records) {
  var seen = {};
  var cols = [];
  records.forEach(function (r) {
    Object.keys(r || {}).forEach(function (k) {
      if (!seen[k]) { seen[k] = 1; cols.push(k); }
    });
  });
  return cols;
}

function normalizeTable(records) {
  var columns = unionColumns(records);
  var rows = records.map(function (r) {
    return columns.map(function (c) {
      var v = r && r[c];
      return v === null || v === undefined ? "" : v;
    });
  });
  return { columns: columns, rows: rows, records: records };
}

function parseJsonFlexible(text) {
  var raw = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return [];
  try { return recordsFrom(JSON.parse(raw)); } catch (e1) {}
  var recs = [];
  var lines = raw.split(/\r?\n/);
  var ok = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try { recs = recs.concat(recordsFrom(JSON.parse(line))); ok++; }
    catch (e2) { if (ok) continue; }
  }
  if (recs.length) return recs;
  throw new Error("JSON o'qilmadi");
}

function parseCsv(text, delim) {
  var parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: delim || "",
    dynamicTyping: false
  });
  return (parsed.data || []).map(function (row) {
    var out = {};
    Object.keys(row).forEach(function (k) { out[String(k).trim() || "col"] = row[k]; });
    return out;
  });
}

function parseWorkbook(buf) {
  var wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
  var recs = [];
  wb.SheetNames.forEach(function (name) {
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false });
    rows.forEach(function (row) {
      var rec = flatten(row);
      if (wb.SheetNames.length > 1) rec.sheet = name;
      recs.push(rec);
    });
  });
  return recs;
}

function mdToRecords(text) {
  var lines = String(text).split(/\r?\n/).filter(function (l) { return l.indexOf("|") !== -1; });
  if (lines.length < 2) return [];
  function splitRow(line) {
    return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (s) { return s.trim(); });
  }
  var header = splitRow(lines[0]);
  var start = /^\s*:?-+:?\s*$/.test(splitRow(lines[1]).join("").replace(/[|\s]/g, "") ) || splitRow(lines[1]).every(function (c) { return /^:?-+:?$/.test(c); }) ? 2 : 1;
  var recs = [];
  for (var i = start; i < lines.length; i++) {
    var cells = splitRow(lines[i]);
    var rec = {};
    header.forEach(function (h, idx) { rec[h || ("col_" + (idx + 1))] = cells[idx] || ""; });
    recs.push(rec);
  }
  return recs;
}

// Simple XML to records for our test shape: <data><row><ism>..</ism>...</row></data>
function parseSimpleXml(text) {
  const rows = [];
  const rowRe = /<row>([\s\S]*?)<\/row>/gi;
  let m;
  while ((m = rowRe.exec(text))) {
    const inner = m[1];
    const rec = {};
    const tagRe = /<([A-Za-z0-9_:-]+)>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tagRe.exec(inner))) {
      rec[t[1]] = t[2].trim();
    }
    if (Object.keys(rec).length) rows.push(rec);
  }
  if (rows.length) return rows;
  // fallback single object
  return recordsFrom({ xml: text.slice(0, 200) });
}

function parseSimpleHtml(text) {
  // extract first table
  const trs = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(text))) trs.push(m[1]);
  if (trs.length < 2) return [];
  function cells(html) {
    const out = [];
    const cRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let c;
    while ((c = cRe.exec(html))) out.push(c[1].replace(/<[^>]+>/g, "").trim());
    return out;
  }
  const header = cells(trs[0]);
  const recs = [];
  for (let i = 1; i < trs.length; i++) {
    const vals = cells(trs[i]);
    const rec = {};
    header.forEach((h, idx) => { rec[h || ("col_" + (idx + 1))] = vals[idx] || ""; });
    recs.push(rec);
  }
  return recs;
}

function parseByKind(kind, text, buf) {
  if (kind === "xlsx") return parseWorkbook(buf);
  if (kind === "json" || kind === "jsonl") return parseJsonFlexible(text);
  if (kind === "yaml") {
    if (!jsyaml) throw new Error("jsyaml not loaded");
    return recordsFrom(jsyaml.load(text));
  }
  if (kind === "xml") return parseSimpleXml(text);
  if (kind === "html") {
    const recs = parseSimpleHtml(text);
    if (recs.length) return recs;
    return recordsFrom({ text: text });
  }
  if (kind === "md") {
    const md = mdToRecords(text);
    if (md.length) return md;
    throw new Error("Markdown jadval topilmadi");
  }
  if (kind === "tsv") return parseCsv(text, "\t");
  if (kind === "csv" || kind === "txt") return parseCsv(text);
  throw new Error("Bu format ochilmaydi: " + kind);
}

function write(table, fmt) {
  fmt = String(fmt || "xlsx").toLowerCase();
  var nameExt = fmt;
  var mime = "application/octet-stream";
  var data;
  if (fmt === "xlsx" || fmt === "ods") {
    var wb = XLSX.utils.book_new();
    var aoa = [table.columns].concat(table.rows.map(function (r) {
      return r.map(function (v) { return v === null || v === undefined ? "" : v; });
    }));
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    var bookType = fmt === "ods" ? "ods" : "xlsx";
    data = XLSX.write(wb, { bookType: bookType, type: "buffer" });
    mime = fmt === "ods"
      ? "application/vnd.oasis.opendocument.spreadsheet"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else if (fmt === "csv") {
    data = Papa.unparse({ fields: table.columns, data: table.rows });
    if (data.charCodeAt(0) !== 65279) data = "\ufeff" + data;
    mime = "text/csv;charset=utf-8";
  } else if (fmt === "tsv") {
    data = Papa.unparse({ fields: table.columns, data: table.rows }, { delimiter: "\t" });
    mime = "text/tab-separated-values;charset=utf-8";
  } else if (fmt === "json") {
    data = JSON.stringify(table.records.map(function (r) {
      var o = {};
      table.columns.forEach(function (c) { o[c] = r[c] === undefined || r[c] === null ? "" : r[c]; });
      return o;
    }), null, 2);
    mime = "application/json;charset=utf-8";
  } else if (fmt === "jsonl") {
    data = table.records.map(function (r) {
      var o = {};
      table.columns.forEach(function (c) { o[c] = r[c] === undefined || r[c] === null ? "" : r[c]; });
      return JSON.stringify(o);
    }).join("\n") + "\n";
    mime = "application/x-ndjson;charset=utf-8";
  } else if (fmt === "yaml") {
    if (!jsyaml) throw new Error("jsyaml missing");
    data = jsyaml.dump(table.records.map(function (r) {
      var o = {};
      table.columns.forEach(function (c) { o[c] = r[c] === undefined || r[c] === null ? "" : r[c]; });
      return o;
    }), { lineWidth: 100 });
    mime = "text/yaml;charset=utf-8";
  } else if (fmt === "xml") {
    data = '<?xml version="1.0" encoding="UTF-8"?>\n<data>\n' +
      table.records.map(function (r) {
        return "  <row>\n" + table.columns.map(function (c) {
          var tag = String(c).replace(/[^A-Za-z0-9_\-]/g, "_") || "col";
          if (/^[0-9]/.test(tag)) tag = "c_" + tag;
          var val = String(r[c] == null ? "" : r[c]).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          return "    <" + tag + ">" + val + "</" + tag + ">";
        }).join("\n") + "\n  </row>";
      }).join("\n") + "\n</data>\n";
    mime = "application/xml;charset=utf-8";
  } else if (fmt === "html") {
    data = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Table</title></head><body><table border=\"1\">\n<thead><tr>" +
      table.columns.map(function (c) { return "<th>" + String(c).replace(/&/g,"&amp;").replace(/</g,"&lt;") + "</th>"; }).join("") +
      "</tr></thead>\n<tbody>\n" +
      table.rows.map(function (r) {
        return "<tr>" + r.map(function (v) { return "<td>" + String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;") + "</td>"; }).join("") + "</tr>";
      }).join("\n") + "\n</tbody></table></body></html>";
    mime = "text/html;charset=utf-8";
  } else if (fmt === "md") {
    data = "| " + table.columns.join(" | ") + " |\n| " + table.columns.map(function () { return "---"; }).join(" | ") + " |\n" +
      table.rows.map(function (r) {
        return "| " + r.map(function (v) { return String(v == null ? "" : v).replace(/\|/g, "\\|"); }).join(" | ") + " |";
      }).join("\n") + "\n";
    mime = "text/markdown;charset=utf-8";
  } else {
    throw new Error("Chiqish formati yo'q: " + fmt);
  }
  return { data: data, mime: mime, ext: nameExt };
}

// ---- RUN TESTS ----
const samplesDir = path.join(__dirname, "samples");
const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });

const INPUTS = [
  "data.json", "nested.json", "data.jsonl", "data.csv", "data.tsv", "data.txt",
  "data.yaml", "data.xml", "data.html", "data.md", "data.xlsx", "data.ods"
];

const OUTPUTS = ["xlsx", "ods", "csv", "tsv", "json", "jsonl", "yaml", "xml", "html", "md"];

let passed = 0;
let failed = 0;
const results = [];

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log("=== READ tests ===");
for (const file of INPUTS) {
  const full = path.join(samplesDir, file);
  if (!fs.existsSync(full)) {
    console.log("SKIP missing", file);
    continue;
  }
  try {
    const ext = extOf(file);
    const kind = READ_EXT[ext] || "csv";
    const binary = /^(xlsx|xls|xlsm|xlsb|ods)$/.test(ext);
    let text = "", buf = null;
    if (binary) {
      buf = fs.readFileSync(full);
    } else {
      text = fs.readFileSync(full, "utf8");
    }
    const records = parseByKind(kind, text, buf);
    const table = normalizeTable(records);
    expect(table.rows.length >= 1, "no rows");
    expect(table.columns.length >= 1, "no cols");
    // should contain ism-like data for our samples
    const flat = JSON.stringify(table).toLowerCase();
    expect(flat.includes("ali") || flat.includes("ism"), "expected sample data content");
    console.log("OK READ", file, "→", table.rows.length + "x" + table.columns.length, "cols:", table.columns.join(","));
    results.push({ type: "read", file, ok: true, rows: table.rows.length, cols: table.columns.length });
    passed++;

    // write all formats from this table
    for (const fmt of OUTPUTS) {
      try {
        const out = write(table, fmt);
        const outName = path.basename(file, path.extname(file)) + "_from_" + ext + "." + out.ext;
        const outPath = path.join(outDir, outName);
        fs.writeFileSync(outPath, out.data);
        // re-read text outputs
        if (!/^(xlsx|ods)$/.test(fmt)) {
          const back = parseByKind(READ_EXT[fmt] || fmt, String(out.data), null);
          const backTable = normalizeTable(back);
          expect(backTable.rows.length === table.rows.length, "row count mismatch after " + fmt);
        } else {
          const back = parseByKind("xlsx", "", out.data);
          const backTable = normalizeTable(back);
          expect(backTable.rows.length === table.rows.length, "row count mismatch after " + fmt);
        }
        console.log("  OK WRITE", fmt, "→", outName);
        passed++;
        results.push({ type: "write", file, fmt, ok: true });
      } catch (e) {
        console.log("  FAIL WRITE", fmt, e.message);
        failed++;
        results.push({ type: "write", file, fmt, ok: false, err: e.message });
      }
    }
  } catch (e) {
    console.log("FAIL READ", file, e.message);
    failed++;
    results.push({ type: "read", file, ok: false, err: e.message });
  }
}

console.log("\n=== SUMMARY ===");
console.log("Passed:", passed, "Failed:", failed);
fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(results, null, 2));
process.exit(failed > 0 ? 1 : 0);
