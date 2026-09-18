(function (global) {
  "use strict";

  var READ_EXT = {
    json: "json", jsonl: "jsonl", ndjson: "jsonl",
    csv: "csv", tsv: "tsv", txt: "txt",
    xlsx: "xlsx", xls: "xlsx", xlsm: "xlsx", xlsb: "xlsx", ods: "xlsx",
    yaml: "yaml", yml: "yaml",
    xml: "xml", html: "html", htm: "html",
    md: "md", markdown: "md"
  };

  function extOf(name) {
    var m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
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
    var keys = Object.keys(obj);
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

  function xmlToObj(node) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      var t = String(node.nodeValue || "").trim();
      return t ? t : undefined;
    }
    if (node.nodeType !== 1) return undefined;
    var obj = {};
    if (node.attributes && node.attributes.length) {
      for (var i = 0; i < node.attributes.length; i++) {
        var a = node.attributes[i];
        obj["@" + a.name] = a.value;
      }
    }
    var kids = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 3 || child.nodeType === 4) {
        var tx = String(child.nodeValue || "").trim();
        if (tx) kids.push({ _text: tx });
      } else if (child.nodeType === 1) {
        kids.push({ tag: child.nodeName, val: xmlToObj(child) });
      }
    }
    var grouped = {};
    kids.forEach(function (k) {
      if (k._text) {
        grouped["#text"] = grouped["#text"] ? grouped["#text"] + " " + k._text : k._text;
        return;
      }
      if (!grouped[k.tag]) grouped[k.tag] = [];
      grouped[k.tag].push(k.val);
    });
    Object.keys(grouped).forEach(function (k) {
      obj[k] = grouped[k].length === 1 ? grouped[k][0] : grouped[k];
    });
    var keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "#text") return obj["#text"];
    return obj;
  }

  function tablesFromHtml(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var tables = doc.querySelectorAll("table");
    var all = [];
    tables.forEach(function (table, ti) {
      var rows = table.querySelectorAll("tr");
      if (!rows.length) return;
      var headerCells = rows[0].querySelectorAll("th,td");
      var cols = [];
      for (var i = 0; i < headerCells.length; i++) {
        cols.push((headerCells[i].innerText || headerCells[i].textContent || ("col_" + (i + 1))).trim());
      }
      for (var r = 1; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll("th,td");
        var rec = {};
        if (tables.length > 1) rec.table = ti + 1;
        for (var c = 0; c < cols.length; c++) {
          rec[cols[c] || ("col_" + (c + 1))] = cells[c] ? (cells[c].innerText || cells[c].textContent || "").trim() : "";
        }
        all.push(rec);
      }
    });
    return all;
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
    var wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false });
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

  function sniffKind(name, text, isBinary) {
    var ext = extOf(name);
    if (READ_EXT[ext]) return READ_EXT[ext];
    if (isBinary) return "xlsx";
    var s = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!s) return "txt";
    if (s.charAt(0) === "{" || s.charAt(0) === "[") return "json";
    if (s.indexOf("<?xml") === 0 || (/^<\w+/.test(s) && s.indexOf(">") !== -1)) {
      if (/<html/i.test(s) || /<table/i.test(s)) return "html";
      return "xml";
    }
    if (/^---\s*\n/.test(s) || /^[\w.-]+:\s+/m.test(s)) return "yaml";
    if (s.indexOf("\t") !== -1) return "tsv";
    return "csv";
  }

  function parseByKind(kind, text, buf) {
    if (kind === "xlsx") return parseWorkbook(buf);
    if (kind === "json" || kind === "jsonl") return parseJsonFlexible(text);
    if (kind === "yaml") return recordsFrom(jsyaml.load(text));
    if (kind === "xml") {
      var xml = new DOMParser().parseFromString(text, "text/xml");
      var err = xml.querySelector("parsererror");
      if (err) throw new Error("XML o'qilmadi");
      return recordsFrom(xmlToObj(xml.documentElement));
    }
    if (kind === "html") {
      var recs = tablesFromHtml(text);
      if (recs.length) return recs;
      return recordsFrom({ text: text });
    }
    if (kind === "md") {
      var md = mdToRecords(text);
      if (md.length) return md;
      throw new Error("Markdown jadval topilmadi");
    }
    if (kind === "tsv") return parseCsv(text, "\t");
    if (kind === "csv" || kind === "txt") return parseCsv(text);
    throw new Error("Bu format ochilmaydi: " + kind);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var ext = extOf(file.name);
      var binary = /^(xlsx|xls|xlsm|xlsb|ods)$/.test(ext);
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Fayl o'qilmadi")); };
      reader.onload = function () {
        try {
          var buf = binary ? new Uint8Array(reader.result) : null;
          var text = binary ? "" : String(reader.result || "");
          var kind = sniffKind(file.name, text, binary);
          var records = parseByKind(kind, text, buf);
          resolve({ name: file.name, kind: kind, table: normalizeTable(records) });
        } catch (e) { reject(e); }
      };
      if (binary) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    });
  }

  function mergeTables(parts) {
    var records = [];
    parts.forEach(function (p) {
      p.table.records.forEach(function (r) {
        var copy = {};
        Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
        if (parts.length > 1) copy.source = p.name;
        records.push(copy);
      });
    });
    return normalizeTable(records);
  }

  function aoaFrom(table) {
    return [table.columns].concat(table.rows.map(function (r) {
      return r.map(function (v) { return v === null || v === undefined ? "" : v; });
    }));
  }

  function recordsPlain(table) {
    return table.records.map(function (r) {
      var o = {};
      table.columns.forEach(function (c) { o[c] = r[c] === undefined || r[c] === null ? "" : r[c]; });
      return o;
    });
  }

  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, "\u0026amp;")
      .replace(/</g, "\u0026lt;")
      .replace(/>/g, "\u0026gt;")
      .replace(/"/g, "\u0026quot;");
  }

  function safeTag(name) {
    var t = String(name).replace(/[^A-Za-z0-9_\-]/g, "_").replace(/^_+|_+$/g, "") || "col";
    if (/^[0-9]/.test(t)) t = "c_" + t;
    return t;
  }

  function toXml(table) {
    var body = recordsPlain(table).map(function (r) {
      var inner = table.columns.map(function (c) {
        return "    <" + safeTag(c) + ">" + xmlEscape(asText(r[c])) + "</" + safeTag(c) + ">";
      }).join("\n");
      return "  <row>\n" + inner + "\n  </row>";
    }).join("\n");
    return '<?xml version="1.0" encoding="UTF-8"?>\n<data>\n' + body + "\n</data>\n";
  }

  function toHtml(table) {
    var head = table.columns.map(function (c) { return "<th>" + xmlEscape(c) + "</th>"; }).join("");
    var body = table.rows.map(function (r) {
      return "<tr>" + r.map(function (v) { return "<td>" + xmlEscape(asText(v)) + "</td>"; }).join("") + "</tr>";
    }).join("\n");
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Table</title></head><body><table border=\"1\">\n<thead><tr>" + head + "</tr></thead>\n<tbody>\n" + body + "\n</tbody></table></body></html>";
  }

  function toMd(table) {
    var head = "| " + table.columns.join(" | ") + " |";
    var line = "| " + table.columns.map(function () { return "---"; }).join(" | ") + " |";
    var body = table.rows.map(function (r) {
      return "| " + r.map(function (v) { return asText(v).replace(/\|/g, "\\|"); }).join(" | ") + " |";
    }).join("\n");
    return head + "\n" + line + "\n" + body + "\n";
  }

  function toJsonl(table) {
    return recordsPlain(table).map(function (r) { return JSON.stringify(r); }).join("\n") + "\n";
  }

  function write(table, fmt) {
    fmt = String(fmt || "xlsx").toLowerCase();
    var nameExt = fmt;
    var mime = "application/octet-stream";
    var data;
    if (fmt === "xlsx" || fmt === "ods") {
      var wb = XLSX.utils.book_new();
      var ws = XLSX.utils.aoa_to_sheet(aoaFrom(table));
      ws["!cols"] = table.columns.map(function (c) {
        var max = String(c).length;
        table.rows.forEach(function (r) {
          var idx = table.columns.indexOf(c);
          max = Math.max(max, asText(r[idx]).length);
        });
        return { wch: Math.min(42, Math.max(12, max + 2)) };
      });
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      var bookType = fmt === "ods" ? "ods" : "xlsx";
      data = XLSX.write(wb, { bookType: bookType, type: "array" });
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
      data = JSON.stringify(recordsPlain(table), null, 2);
      mime = "application/json;charset=utf-8";
    } else if (fmt === "jsonl") {
      data = toJsonl(table);
      mime = "application/x-ndjson;charset=utf-8";
    } else if (fmt === "yaml") {
      data = jsyaml.dump(recordsPlain(table), { lineWidth: 100 });
      mime = "text/yaml;charset=utf-8";
    } else if (fmt === "xml") {
      data = toXml(table);
      mime = "application/xml;charset=utf-8";
    } else if (fmt === "html") {
      data = toHtml(table);
      mime = "text/html;charset=utf-8";
    } else if (fmt === "md") {
      data = toMd(table);
      mime = "text/markdown;charset=utf-8";
    } else {
      throw new Error("Chiqish formati yo'q: " + fmt);
    }
    return { data: data, mime: mime, ext: nameExt };
  }

  function download(filename, mime, data) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 800);
  }

  global.FileConvert = {
    readFile: readFile,
    mergeTables: mergeTables,
    write: write,
    download: download,
    extOf: extOf
  };
})(window);
