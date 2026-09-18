(function (global) {
  "use strict";

  var READ_EXT = {
    json: "json", jsonc: "json", json5: "json",
    jsonl: "jsonl", ndjson: "jsonl",
    csv: "csv", tsv: "tsv", txt: "txt", psv: "psv",
    ssv: "ssv", scsv: "ssv",
    xlsx: "xlsx", xls: "xlsx", xlsm: "xlsx", xlsb: "xlsx", ods: "xlsx",
    fods: "xlsx", uos: "xlsx", et: "xlsx", numbers: "xlsx",
    dbf: "xlsx", prn: "xlsx",
    yaml: "yaml", yml: "yaml",
    xml: "xml", html: "html", htm: "html",
    md: "md", markdown: "md",
    toml: "toml", ini: "ini", conf: "ini", cfg: "ini", properties: "ini", env: "env",
    sql: "sql", log: "log",
    tex: "latex", latex: "latex",
    org: "org",
    vcf: "vcf", vcard: "vcf",
    ics: "ics", ical: "ics", icalendar: "ics",
    rss: "rss", atom: "rss",
    wiki: "wiki", mediawiki: "wiki",
    dif: "dif", slk: "sylk", sylk: "sylk"
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


  function parseToml(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    var recs = [];
    var current = {};
    var inArrayTable = false;
    function flush() {
      if (Object.keys(current).length) {
        recs.push(current);
        current = {};
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/#.*$/, "").trim();
      if (!line) continue;
      var arrTable = line.match(/^\[\[([^\]]+)\]\]$/);
      var table = line.match(/^\[([^\]]+)\]$/);
      if (arrTable) {
        flush();
        inArrayTable = true;
        current = { _section: arrTable[1].trim() };
        continue;
      }
      if (table) {
        flush();
        inArrayTable = false;
        current = { _section: table[1].trim() };
        continue;
      }
      var kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
      if (!kv) continue;
      var key = kv[1];
      var raw = kv[2].trim();
      var val = raw;
      if ((raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"') ||
          (raw.charAt(0) === "'" && raw.charAt(raw.length - 1) === "'")) {
        val = raw.slice(1, -1);
      } else if (/^(true|false)$/i.test(raw)) {
        val = raw.toLowerCase() === "true";
      } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
        val = Number(raw);
      } else if (raw.charAt(0) === "[" && raw.charAt(raw.length - 1) === "]") {
        val = raw.slice(1, -1).split(",").map(function (x) { return x.trim().replace(/^["']|["']$/g, ""); }).join(", ");
      }
      current[key] = val;
    }
    flush();
    if (!recs.length) throw new Error("TOML o'qilmadi");
    return recs;
  }

  function parseIni(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    var recs = [];
    var section = "default";
    var current = { section: section };
    function flush() {
      if (Object.keys(current).length > 1 || (Object.keys(current).length === 1 && current.section !== "default")) {
        recs.push(current);
      }
      current = { section: section };
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/[;#].*$/, "").trim();
      if (!line) continue;
      var sec = line.match(/^\[([^\]]+)\]$/);
      if (sec) {
        flush();
        section = sec[1].trim();
        current = { section: section };
        continue;
      }
      var kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (kv) current[kv[1].trim()] = kv[2].trim();
    }
    flush();
    if (!recs.length) {
      // flat key=value without sections
      var flat = {};
      String(text).split(/\r?\n/).forEach(function (l) {
        var m = l.replace(/[;#].*$/, "").match(/^([^=]+?)\s*=\s*(.*)$/);
        if (m) flat[m[1].trim()] = m[2].trim();
      });
      if (Object.keys(flat).length) return [flat];
      throw new Error("INI o'qilmadi");
    }
    return recs;
  }

  function parseSql(text) {
    var recs = [];
    var re = /INSERT\s+INTO\s+[`"\[]?(\w+)[`"\]]?\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^;]+)\)/gi;
    var m;
    while ((m = re.exec(text))) {
      var table = m[1];
      var cols = m[2] ? m[2].split(",").map(function (c) { return c.trim().replace(/^[`"\[]|[`"\]]$/g, ""); }) : null;
      var valsRaw = m[3];
      var vals = [];
      var cur = "";
      var inQ = null;
      for (var i = 0; i < valsRaw.length; i++) {
        var ch = valsRaw.charAt(i);
        if (inQ) {
          if (ch === inQ && valsRaw.charAt(i - 1) !== "\\") inQ = null;
          cur += ch;
        } else if (ch === "'" || ch === '"') {
          inQ = ch;
          cur += ch;
        } else if (ch === ",") {
          vals.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) vals.push(cur.trim());
      var rec = { _table: table };
      vals.forEach(function (v, idx) {
        var key = cols && cols[idx] ? cols[idx] : "col_" + (idx + 1);
        v = v.trim();
        if ((v.charAt(0) === "'" && v.charAt(v.length - 1) === "'") ||
            (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"')) {
          v = v.slice(1, -1).replace(/''/g, "'");
        } else if (/^null$/i.test(v)) v = "";
        rec[key] = v;
      });
      recs.push(rec);
    }
    if (!recs.length) throw new Error("SQL INSERT topilmadi");
    return recs;
  }

  function parseLog(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(function (l) { return l.trim(); });
    return lines.map(function (line, i) {
      var rec = { line: i + 1, text: line };
      var ts = line.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
      if (ts) rec.timestamp = ts[1];
      var lvl = line.match(/\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/i);
      if (lvl) rec.level = lvl[1].toUpperCase();
      return rec;
    });
  }

  function toToml(table) {
    var recs = recordsPlain(table);
    if (!recs.length) return "";
    var out = [];
    recs.forEach(function (r, idx) {
      out.push("[[row]]");
      table.columns.forEach(function (c) {
        var v = r[c];
        if (v === null || v === undefined || v === "") {
          out.push(c + ' = ""');
          return;
        }
        if (typeof v === "number" || typeof v === "boolean") out.push(c + " = " + v);
        else out.push(c + ' = "' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
      });
      if (idx < recs.length - 1) out.push("");
    });
    return out.join("\n") + "\n";
  }

  function toIni(table) {
    var recs = recordsPlain(table);
    var out = [];
    recs.forEach(function (r, idx) {
      out.push("[row_" + (idx + 1) + "]");
      table.columns.forEach(function (c) {
        out.push(c + " = " + asText(r[c]));
      });
      out.push("");
    });
    return out.join("\n");
  }

  function toSql(table) {
    var cols = table.columns.map(function (c) {
      return "`" + String(c).replace(/`/g, "") + "`";
    });
    var lines = ["-- Generated by File Converter", "CREATE TABLE IF NOT EXISTS data ("];
    lines.push(table.columns.map(function (c) {
      return "  `" + String(c).replace(/`/g, "") + "` TEXT";
    }).join(",\n"));
    lines.push(");", "");
    recordsPlain(table).forEach(function (r) {
      var vals = table.columns.map(function (c) {
        var v = asText(r[c]);
        return "'" + v.replace(/'/g, "''") + "'";
      });
      lines.push("INSERT INTO data (" + cols.join(", ") + ") VALUES (" + vals.join(", ") + ");");
    });
    return lines.join("\n") + "\n";
  }

  function toLog(table) {
    return table.rows.map(function (r) {
      return r.map(asText).join(" | ");
    }).join("\n") + "\n";
  }


  function stripJsonComments(text) {
    return String(text).replace(/^\uFEFF/, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  function parsePsv(text) {
    return parseCsv(text, "|");
  }

  function parseSsv(text) {
    return parseCsv(text, ";");
  }

  function parseEnv(text) {
    var rec = {};
    String(text).split(/\r?\n/).forEach(function (line) {
      line = line.replace(/^\uFEFF/, "").trim();
      if (!line || line.charAt(0) === "#") return;
      var eq = line.indexOf("=");
      if (eq === -1) return;
      var k = line.slice(0, eq).trim();
      var v = line.slice(eq + 1).trim();
      if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
          (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) v = v.slice(1, -1);
      rec[k] = v;
    });
    if (!Object.keys(rec).length) throw new Error("ENV o'qilmadi");
    return [rec];
  }

  function parseLatex(text) {
    var m = String(text).match(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/);
    if (!m) throw new Error("LaTeX tabular topilmadi");
    var body = m[0]
      .replace(/\\begin\{tabular\}\{[^}]*\}/, "")
      .replace(/\\end\{tabular\}/, "")
      .replace(/\\hline/g, "")
      .trim();
    var rows = body.split(/\\\\/).map(function (r) { return r.trim(); }).filter(Boolean);
    if (rows.length < 1) return [];
    function cells(row) {
      return row.split("&").map(function (c) {
        return c.replace(/\\textbf\{([^}]*)\}/g, "$1").replace(/[{}]/g, "").trim();
      });
    }
    var header = cells(rows[0]);
    var recs = [];
    for (var i = 1; i < rows.length; i++) {
      var vals = cells(rows[i]);
      var rec = {};
      header.forEach(function (h, idx) { rec[h || ("col_" + (idx + 1))] = vals[idx] || ""; });
      recs.push(rec);
    }
    return recs;
  }

  function parseOrg(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return /^\s*\|/.test(l); });
    if (lines.length < 2) throw new Error("Org jadval topilmadi");
    function splitRow(line) {
      return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (s) { return s.trim(); });
    }
    var header = splitRow(lines[0]);
    var start = 1;
    if (/^[\s|+-]+$/.test(lines[1].replace(/[^\s|+-]/g, ""))) start = 2;
    var recs = [];
    for (var i = start; i < lines.length; i++) {
      if (/^[\s|+-]+$/.test(lines[i].replace(/[^\s|+-]/g, ""))) continue;
      var vals = splitRow(lines[i]);
      var rec = {};
      header.forEach(function (h, idx) { rec[h || ("col_" + (idx + 1))] = vals[idx] || ""; });
      recs.push(rec);
    }
    return recs;
  }

  function parseVcf(text) {
    var cards = String(text).split(/BEGIN:VCARD/i).slice(1);
    if (!cards.length) throw new Error("vCard topilmadi");
    return cards.map(function (block) {
      var rec = {};
      block.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line || /^END:VCARD/i.test(line)) return;
        var idx = line.indexOf(":");
        if (idx === -1) return;
        var key = line.slice(0, idx).split(";")[0].toUpperCase();
        var val = line.slice(idx + 1).trim();
        if (key === "FN") rec.name = val;
        else if (key === "N") rec.structured_name = val;
        else if (key === "TEL") rec.phone = (rec.phone ? rec.phone + "; " : "") + val;
        else if (key === "EMAIL") rec.email = (rec.email ? rec.email + "; " : "") + val;
        else if (key === "ORG") rec.org = val;
        else if (key === "TITLE") rec.title = val;
        else if (key === "URL") rec.url = val;
        else if (key === "ADR") rec.address = val.replace(/;/g, ", ");
        else if (key === "NOTE") rec.note = val;
        else if (key === "BDAY") rec.birthday = val;
      });
      return rec;
    }).filter(function (r) { return Object.keys(r).length; });
  }

  function parseIcs(text) {
    var events = String(text).split(/BEGIN:VEVENT/i).slice(1);
    if (!events.length) throw new Error("iCal event topilmadi");
    return events.map(function (block) {
      var rec = {};
      var lines = block.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
      lines.forEach(function (line) {
        line = line.trim();
        if (!line || /^END:VEVENT/i.test(line)) return;
        var idx = line.indexOf(":");
        if (idx === -1) return;
        var key = line.slice(0, idx).split(";")[0].toUpperCase();
        var val = line.slice(idx + 1).trim();
        if (key === "SUMMARY") rec.summary = val;
        else if (key === "DTSTART") rec.start = val;
        else if (key === "DTEND") rec.end = val;
        else if (key === "LOCATION") rec.location = val;
        else if (key === "DESCRIPTION") rec.description = val;
        else if (key === "UID") rec.uid = val;
        else if (key === "STATUS") rec.status = val;
        else if (key === "ORGANIZER") rec.organizer = val.replace(/^MAILTO:/i, "");
      });
      return rec;
    }).filter(function (r) { return Object.keys(r).length; });
  }

  function parseRss(text) {
    var doc = new DOMParser().parseFromString(text, "text/xml");
    var err = doc.querySelector("parsererror");
    if (err) throw new Error("RSS/Atom o'qilmadi");
    var items = doc.querySelectorAll("item, entry");
    var recs = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      function txt(sel) {
        var n = it.querySelector(sel);
        return n ? (n.textContent || "").trim() : "";
      }
      var linkNode = it.querySelector("link");
      var link = txt("link");
      if (!link && linkNode) link = linkNode.getAttribute("href") || "";
      recs.push({
        title: txt("title"),
        link: link,
        date: txt("pubDate") || txt("updated") || txt("published"),
        author: txt("author") || txt("creator"),
        description: (txt("description") || txt("summary") || "").slice(0, 500)
      });
    }
    if (!recs.length) throw new Error("RSS item topilmadi");
    return recs;
  }

  function parseWiki(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) {
      return /^\s*\|/.test(l) || /^\s*!/.test(l);
    });
    if (lines.length < 2) throw new Error("Wiki jadval topilmadi");
    function cells(line) {
      return line.replace(/^\s*[|!]/, "").split("|").map(function (c) {
        return c.replace(/'{2,3}/g, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").trim();
      });
    }
    var header = cells(lines[0]);
    var recs = [];
    for (var i = 1; i < lines.length; i++) {
      if (/^\s*\|-/.test(lines[i])) continue;
      var vals = cells(lines[i]);
      if (!vals.length) continue;
      var rec = {};
      header.forEach(function (h, idx) { rec[h || ("col_" + (idx + 1))] = vals[idx] || ""; });
      recs.push(rec);
    }
    return recs;
  }

  function parseDif(text) {
    var lines = String(text).split(/\r?\n/);
    var rows = [];
    var current = [];
    var inData = false;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i].trim();
      if (L === "DATA" || L === "BOT") { inData = true; continue; }
      if (L === "EOD") break;
      if (!inData) continue;
      if (L === "-1,0" && (lines[i + 1] || "").trim() === "BOT") {
        if (current.length) rows.push(current);
        current = [];
        i++;
        continue;
      }
      if (/^0,/.test(L) || /^1,/.test(L)) {
        var next = (lines[i + 1] || "").trim();
        if (next.charAt(0) === '"' && next.charAt(next.length - 1) === '"') {
          current.push(next.slice(1, -1));
          i++;
        } else if (next) {
          current.push(next.replace(/^V/, ""));
          i++;
        }
      }
    }
    if (current.length) rows.push(current);
    if (rows.length < 2) throw new Error("DIF o'qilmadi");
    var header = rows[0].map(function (h, i) { return h || ("col_" + (i + 1)); });
    return rows.slice(1).map(function (r) {
      var rec = {};
      header.forEach(function (h, idx) { rec[h] = r[idx] || ""; });
      return rec;
    });
  }

  function parseSylk(text) {
    var lines = String(text).split(/\r?\n/);
    var grid = {};
    var maxR = 0, maxC = 0;
    lines.forEach(function (line) {
      var m = line.match(/^C;X(\d+);Y(\d+);.*K(.+)$/);
      if (!m) return;
      var c = parseInt(m[1], 10), r = parseInt(m[2], 10);
      var val = m[3].trim();
      if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') val = val.slice(1, -1);
      grid[r + "," + c] = val;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    });
    if (maxR < 1) throw new Error("SYLK o'qilmadi");
    var header = [];
    for (var c = 1; c <= maxC; c++) header.push(grid["1," + c] || ("col_" + c));
    var recs = [];
    for (var r = 2; r <= maxR; r++) {
      var rec = {};
      for (var c = 1; c <= maxC; c++) rec[header[c - 1]] = grid[r + "," + c] || "";
      recs.push(rec);
    }
    return recs;
  }

  function toPsv(table) {
    return Papa.unparse({ fields: table.columns, data: table.rows }, { delimiter: "|" });
  }

  function toSsv(table) {
    return Papa.unparse({ fields: table.columns, data: table.rows }, { delimiter: ";" });
  }

  function toEnv(table) {
    var recs = recordsPlain(table);
    if (recs.length === 1) {
      return Object.keys(recs[0]).map(function (k) {
        return k + "=" + asText(recs[0][k]);
      }).join("\n") + "\n";
    }
    return recs.map(function (r, i) {
      return Object.keys(r).map(function (k) {
        return k + "_" + (i + 1) + "=" + asText(r[k]);
      }).join("\n");
    }).join("\n\n") + "\n";
  }

  function toLatex(table) {
    var cols = table.columns.map(function () { return "l"; }).join("");
    var lines = ["\\begin{tabular}{" + cols + "}", "\\hline"];
    lines.push(table.columns.map(function (c) { return String(c).replace(/([&#%_])/g, "\\$1"); }).join(" & ") + " \\\\");
    lines.push("\\hline");
    table.rows.forEach(function (r) {
      lines.push(r.map(function (v) { return asText(v).replace(/([&#%_])/g, "\\$1"); }).join(" & ") + " \\\\");
    });
    lines.push("\\hline", "\\end{tabular}");
    return lines.join("\n") + "\n";
  }

  function toOrg(table) {
    var head = "| " + table.columns.join(" | ") + " |";
    var sep = "| " + table.columns.map(function () { return "---"; }).join(" | ") + " |";
    var body = table.rows.map(function (r) {
      return "| " + r.map(function (v) { return asText(v).replace(/\|/g, "\\|"); }).join(" | ") + " |";
    }).join("\n");
    return head + "\n" + sep + "\n" + body + "\n";
  }

  function toVcf(table) {
    return recordsPlain(table).map(function (r) {
      var lines = ["BEGIN:VCARD", "VERSION:3.0"];
      var name = r.name || r.ism || r.FN || r.full_name || Object.values(r)[0] || "";
      lines.push("FN:" + asText(name));
      if (r.phone || r.tel || r.telefon) lines.push("TEL:" + asText(r.phone || r.tel || r.telefon));
      if (r.email || r.mail) lines.push("EMAIL:" + asText(r.email || r.mail));
      if (r.org || r.company) lines.push("ORG:" + asText(r.org || r.company));
      if (r.title || r.lavozim) lines.push("TITLE:" + asText(r.title || r.lavozim));
      if (r.url) lines.push("URL:" + asText(r.url));
      if (r.address || r.adr) lines.push("ADR:" + asText(r.address || r.adr));
      if (r.note || r.izoh) lines.push("NOTE:" + asText(r.note || r.izoh));
      lines.push("END:VCARD");
      return lines.join("\n");
    }).join("\n") + "\n";
  }

  function toIcs(table) {
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//File Converter//EN"];
    recordsPlain(table).forEach(function (r, i) {
      lines.push("BEGIN:VEVENT");
      lines.push("UID:fc-" + (i + 1) + "@file-converter");
      lines.push("SUMMARY:" + asText(r.summary || r.title || r.name || r.ism || ("Event " + (i + 1))));
      if (r.start || r.dtstart || r.begin) lines.push("DTSTART:" + asText(r.start || r.dtstart || r.begin));
      if (r.end || r.dtend) lines.push("DTEND:" + asText(r.end || r.dtend));
      if (r.location || r.joy) lines.push("LOCATION:" + asText(r.location || r.joy));
      if (r.description || r.desc || r.izoh) lines.push("DESCRIPTION:" + asText(r.description || r.desc || r.izoh));
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\n") + "\n";
  }

  function toWiki(table) {
    var lines = ['{| class="wikitable"', "|-"];
    lines.push("! " + table.columns.join(" !! "));
    table.rows.forEach(function (r) {
      lines.push("|-");
      lines.push("| " + r.map(function (v) { return asText(v); }).join(" || "));
    });
    lines.push("|}");
    return lines.join("\n") + "\n";
  }

  function toDif(table) {
    var lines = ["TABLE", "0,1", '"DATA"', "VECTORS", "0," + (table.rows.length + 1), '""', "TUPLES", "0," + table.columns.length, '""', "DATA", "0,0", '""'];
    function bot() { lines.push("-1,0", "BOT"); }
    function cell(v) {
      var t = asText(v);
      if (/^-?\d+(\.\d+)?$/.test(t)) { lines.push("0," + t); lines.push("V"); }
      else { lines.push("1,0"); lines.push('"' + t.replace(/"/g, "'") + '"'); }
    }
    bot();
    table.columns.forEach(cell);
    table.rows.forEach(function (r) {
      bot();
      r.forEach(cell);
    });
    lines.push("-1,0", "EOD");
    return lines.join("\n") + "\n";
  }

  function toSylk(table) {
    var lines = ["ID;PFileConverter", "B;Y" + (table.rows.length + 1) + ";X" + table.columns.length + ";D0"];
    table.columns.forEach(function (c, i) {
      lines.push("C;X" + (i + 1) + ";Y1;K\"" + String(c).replace(/"/g, "'") + "\"");
    });
    table.rows.forEach(function (r, ri) {
      r.forEach(function (v, ci) {
        var t = asText(v);
        if (/^-?\d+(\.\d+)?$/.test(t)) lines.push("C;X" + (ci + 1) + ";Y" + (ri + 2) + ";K" + t);
        else lines.push("C;X" + (ci + 1) + ";Y" + (ri + 2) + ";K\"" + t.replace(/"/g, "'") + "\"");
      });
    });
    lines.push("E");
    return lines.join("\n") + "\n";
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
    if (/^INSERT\s+INTO\b/i.test(s) || /^CREATE\s+TABLE\b/i.test(s)) return "sql";
    if (/^\[\[[^\]]+\]\]/.test(s) || (/^[A-Za-z0-9_.-]+\s*=/.test(s) && /\n\[/.test(s))) return "toml";
    if (/^\[[^\]]+\]\s*$/m.test(s) && /^[^=\n]+=/m.test(s)) return "ini";
    if (/^---\s*\n/.test(s) || /^[\w.-]+:\s+/m.test(s)) return "yaml";
    if (s.indexOf("\t") !== -1) return "tsv";
    return "csv";
  }

  function parseByKind(kind, text, buf) {
    if (kind === "xlsx") return parseWorkbook(buf);
    if (kind === "json" || kind === "jsonl") return parseJsonFlexible(kind === "json" ? stripJsonComments(text) : text);
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
    if (kind === "toml") return parseToml(text);
    if (kind === "ini") return parseIni(text);
    if (kind === "sql") return parseSql(text);
    if (kind === "log") return parseLog(text);
    if (kind === "psv") return parsePsv(text);
    if (kind === "ssv") return parseSsv(text);
    if (kind === "env") return parseEnv(text);
    if (kind === "latex") return parseLatex(text);
    if (kind === "org") return parseOrg(text);
    if (kind === "vcf") return parseVcf(text);
    if (kind === "ics") return parseIcs(text);
    if (kind === "rss") return parseRss(text);
    if (kind === "wiki") return parseWiki(text);
    if (kind === "dif") return parseDif(text);
    if (kind === "sylk") return parseSylk(text);
    throw new Error("Bu format ochilmaydi: " + kind);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var ext = extOf(file.name);
      var binary = /^(xlsx|xls|xlsm|xlsb|ods|fods|uos|et|dbf|prn|numbers)$/.test(ext);
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
    if (fmt === "xlsx" || fmt === "ods" || fmt === "xls" || fmt === "fods" || fmt === "dbf" || fmt === "rtf") {
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
      var bookMap = { xlsx: "xlsx", ods: "ods", xls: "xls", fods: "fods", dbf: "dbf", rtf: "rtf" };
      var bookType = bookMap[fmt] || "xlsx";
      data = XLSX.write(wb, { bookType: bookType, type: "array" });
      var mimeMap = {
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ods: "application/vnd.oasis.opendocument.spreadsheet",
        xls: "application/vnd.ms-excel",
        fods: "application/vnd.oasis.opendocument.spreadsheet",
        dbf: "application/x-dbf",
        rtf: "application/rtf"
      };
      mime = mimeMap[fmt] || mimeMap.xlsx;
      if (fmt === "xls") nameExt = "xls";
      if (fmt === "dbf") nameExt = "dbf";
      if (fmt === "rtf") nameExt = "rtf";
      if (fmt === "fods") nameExt = "fods";
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
    } else if (fmt === "toml") {
      data = toToml(table);
      mime = "application/toml;charset=utf-8";
    } else if (fmt === "ini") {
      data = toIni(table);
      mime = "text/plain;charset=utf-8";
    } else if (fmt === "sql") {
      data = toSql(table);
      mime = "application/sql;charset=utf-8";
    } else if (fmt === "log") {
      data = toLog(table);
      mime = "text/plain;charset=utf-8";
    } else if (fmt === "psv") {
      data = toPsv(table);
      mime = "text/plain;charset=utf-8";
    } else if (fmt === "ssv") {
      data = toSsv(table);
      if (data.charCodeAt(0) !== 65279) data = "\ufeff" + data;
      mime = "text/csv;charset=utf-8";
    } else if (fmt === "env") {
      data = toEnv(table);
      mime = "text/plain;charset=utf-8";
    } else if (fmt === "latex" || fmt === "tex") {
      data = toLatex(table);
      nameExt = "tex";
      mime = "application/x-tex;charset=utf-8";
    } else if (fmt === "org") {
      data = toOrg(table);
      mime = "text/plain;charset=utf-8";
    } else if (fmt === "vcf") {
      data = toVcf(table);
      mime = "text/vcard;charset=utf-8";
    } else if (fmt === "ics") {
      data = toIcs(table);
      mime = "text/calendar;charset=utf-8";
    } else if (fmt === "wiki") {
      data = toWiki(table);
      mime = "text/plain;charset=utf-8";
    } else if (fmt === "dif") {
      data = toDif(table);
      mime = "application/x-dif;charset=utf-8";
    } else if (fmt === "sylk" || fmt === "slk") {
      data = toSylk(table);
      nameExt = "slk";
      mime = "text/plain;charset=utf-8";
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
