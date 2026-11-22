"use strict";
/* LV-Prüfstand online demo (static site, no server). Loaded before views.js and app.js.
   Answers the /api/ requests of the page from the files that tools/export_static.py wrote
   under api/ (index: api/manifest.json). POST /api/reviews/<id> keeps the review in the
   localStorage of this browser and GET /api/findings merges those reviews, with the
   checks and answers of web/app.py. Any other request passes to the browser's fetch. */
(function () {
  /* ROUTES-BEGIN */
  const ROUTES = [
    {"method": "GET", "path": "findings", "kind": "findings"},
    {"method": "POST", "path": "reviews/{id}", "kind": "review"},
    {"method": "GET", "path": "page-image/{id}/{index}", "kind": "file"},
    {"method": "GET", "path": "evidence/{id}", "kind": "file"},
    {"method": "GET", "path": "matrix", "kind": "file"},
    {"method": "GET", "path": "lv", "kind": "file"},
    {"method": "GET", "path": "lv/{doc}", "kind": "file"},
    {"method": "GET", "path": "diff", "kind": "file"},
    {"method": "GET", "path": "bench", "kind": "file"},
    {"method": "GET", "path": "export/fragenliste", "kind": "file"},
    {"method": "GET", "path": "export/lv-markiert", "kind": "file"},
    {"method": "GET", "path": "export/risikobericht", "kind": "file"},
    {"method": "POST", "path": "live", "kind": "unsupported"}
  ];
  /* ROUTES-END */

  const script = document.currentScript;
  const SITE = new URL("./", script && script.src ? script.src : document.baseURI);
  const API = new URL("api/", SITE);
  const realFetch = window.fetch.bind(window);
  const STATUSES = ["confirmed", "rejected", "unclear"];
  const MAX_COMMENT = 500;
  const MAX_BY = 100;
  const UNAVAILABLE = "In der Online-Demo nicht verfügbar. Lokal starten: siehe README des Repositorys.";
  const STORE_PREFIX = "lv-pruefstand-demo-reviews/";
  // The characters Python's str.split() and re's \s treat as white space (web/app.py uses both).
  const SPACE = "[\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
  const SPACES = new RegExp(SPACE + "+", "u");
  const ANY_SPACE = new RegExp(SPACE, "gu");
  // Python's \d and float() take every Unicode decimal digit, not only 0-9.
  const GROUPED = /^\p{Nd}{1,3}(\.\p{Nd}{3})+$/u;
  const PLAIN = /^\p{Nd}+(\.\p{Nd}+)?$/u;
  const DIGITS = /^\p{Nd}+$/u;
  const ONE_DIGIT = /^\p{Nd}$/u;

  const warned = new Set();
  const memory = {};
  let manifestPromise = null;
  const texts = {};

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  function answer(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
  }

  function problem(status, message) {
    return answer(status, { error: message });
  }

  function unmapped(method, key) {
    if (!warned.has(method + " " + key)) {
      warned.add(method + " " + key);
      console.warn("LV-Prüfstand Online-Demo: keine statische Antwort für " + method + " /api/" + key);
    }
    return problem(404, "In der Online-Demo gibt es keine Antwort für " + method + " /api/" + key + ".");
  }

  // ---- the files of the build ------------------------------------------------------

  function manifest() {
    if (!manifestPromise) {
      manifestPromise = realFetch(new URL("manifest.json", API), { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error("api/manifest.json: Fehler " + response.status);
        return response.json();
      });
      manifestPromise.catch(() => { manifestPromise = null; });
    }
    return manifestPromise;
  }

  async function fileBody(entry) {
    const response = await realFetch(new URL(entry.file + "?v=" + entry.v, SITE));
    if (!response.ok) throw new Error(entry.file + ": Fehler " + response.status);
    return response.arrayBuffer();
  }

  async function fileText(entry) {
    if (!own(texts, entry.file)) {
      texts[entry.file] = fileBody(entry).then((body) => new TextDecoder("utf-8").decode(body));
      texts[entry.file].catch(() => { delete texts[entry.file]; });
    }
    return texts[entry.file];
  }

  async function serveFile(entry) {
    const headers = { "Content-Type": entry.type };
    if (entry.filename) headers["Content-Disposition"] = 'attachment; filename="' + entry.filename + '"';
    return new Response(await fileBody(entry), { status: entry.status, headers: headers });
  }

  // ---- requests ----------------------------------------------------------------------

  function apiPath(url) {
    if (url.origin === API.origin && url.pathname.startsWith(API.pathname)) return url.pathname.slice(API.pathname.length);
    if (url.origin === location.origin && url.pathname.startsWith("/api/")) return url.pathname.slice("/api/".length);
    return null;
  }

  /* Same key as request_key() in tools/export_static.py. */
  function requestKey(segments, search) {
    const pairs = Array.from(search.entries()).sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
    const key = segments.join("/");
    return pairs.length ? key + "?" + pairs.map((pair) => pair[0] + "=" + pair[1]).join("&") : key;
  }

  function route(method, segments) {
    for (const entry of ROUTES) {
      if (entry.method !== method) continue;
      const pattern = entry.path.split("/");
      if (pattern.length !== segments.length) continue;
      const params = {};
      let fits = true;
      pattern.forEach((part, i) => {
        if (/^\{\w+\}$/.test(part)) {
          if (segments[i] === "") fits = false;
          else params[part.slice(1, -1)] = segments[i];
        } else if (part !== segments[i]) {
          fits = false;
        }
      });
      if (fits) return { kind: entry.kind, params: params };
    }
    return null;
  }

  async function bodyText(init, request) {
    if (init && init.body !== undefined && init.body !== null) {
      return typeof init.body === "string" ? init.body : new Response(init.body).text();
    }
    return request ? request.clone().text() : "";
  }

  async function handle(method, rel, search, init, request) {
    let segments;
    try {
      segments = rel.split("/").map(decodeURIComponent);
    } catch (error) {
      return unmapped(method, rel);
    }
    const key = requestKey(segments, search);
    const found = route(method, segments);
    if (!found) return unmapped(method, key);
    if (found.kind === "unsupported") return problem(501, UNAVAILABLE);
    if (found.kind === "review") return postReview(found.params.id, await bodyText(init, request));
    const data = await manifest();
    if (!own(data.responses, key)) return unmapped(method, key);
    const entry = data.responses[key];
    if (found.kind === "findings") return getFindings(data, entry);
    return serveFile(entry);
  }

  window.fetch = function (input, init) {
    let url;
    let method;
    let request = null;
    try {
      if (typeof Request !== "undefined" && input instanceof Request) request = input;
      url = new URL(request ? request.url : String(input), document.baseURI);
      method = String((init && init.method) || (request ? request.method : "GET")).toUpperCase();
    } catch (error) {
      return realFetch(input, init);
    }
    const rel = apiPath(url);
    if (rel === null) return realFetch(input, init);
    return handle(method, rel, url.searchParams, init, request).catch((error) =>
      problem(503, "Die Daten der Online-Demo konnten nicht geladen werden (" + (error && error.message) + ")."));
  };

  // ---- reviews in this browser (web/app.py: review_view, count, post_review) -------------

  function readLocal(project) {
    if (own(memory, project)) return Object.assign({}, memory[project]);
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORE_PREFIX + project) || "{}");
      return isObject(stored) ? stored : {};
    } catch (error) {
      return {};
    }
  }

  function writeLocal(project, reviews) {
    memory[project] = reviews;
    try {
      window.localStorage.setItem(STORE_PREFIX + project, JSON.stringify(reviews));
    } catch (error) {
      if (!warned.has("storage")) {
        warned.add("storage");
        console.warn("LV-Prüfstand Online-Demo: localStorage nicht nutzbar; Bewertungen gelten nur bis zum Neuladen.");
      }
    }
  }

  function pyText(value) {
    if (value === null || value === undefined || typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "True" : "False";
    return String(value);
  }

  function reviewView(entry) {
    if (!isObject(entry) || typeof entry.status !== "string" || !entry.status) return null;
    let estimate = entry.eur_estimate;
    if (typeof estimate !== "number" || !Number.isFinite(estimate)) estimate = null;
    return {
      status: entry.status,
      by: pyText(entry.by) || "",
      comment: pyText(entry.comment) || "",
      eur_estimate: estimate,
      at: pyText(entry.at) || "",
    };
  }

  function count(findings, reviews) {
    const tally = (group) => {
      const numbers = { count: group.length, open: 0, confirmed: 0, rejected: 0, unclear: 0 };
      for (const finding of group) {
        const review = reviewView(own(reviews, finding.id) ? reviews[finding.id] : null);
        const status = review ? review.status : null;
        numbers[STATUSES.includes(status) ? status : "open"] += 1;
      }
      return numbers;
    };
    const passed = findings.filter((finding) => finding.k3_pass === true);
    const known = new Set(findings.map((finding) => finding.id));
    return {
      all: tally(findings),
      k3: tally(passed),
      held_back: findings.length - passed.length,
      reviews_without_finding: Object.keys(reviews).filter((key) => !known.has(key)).length,
    };
  }

  function squash(text) {
    return text.split(SPACES).filter((part) => part !== "").join(" ");
  }

  function asciiDigits(text) {
    return Array.from(text, (char) => {
      if (char === ".") return char;
      let start = char.codePointAt(0);
      while (start > 0 && ONE_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
      return String((char.codePointAt(0) - start) % 10);
    }).join("");
  }

  /* parse_eur of web/app.py: null for no estimate, a number, or throws. */
  function parseEur(value) {
    if (value === null || value === undefined) return null;
    let number;
    if (typeof value === "boolean") throw new Error("no number");
    if (typeof value === "number") {
      number = value;
    } else if (typeof value === "string") {
      const text = value.replace(ANY_SPACE, "").split("€").join("").split("EUR").join("");
      if (text === "") return null;
      if (text.includes(",")) {
        const cut = text.lastIndexOf(",");
        const whole = text.slice(0, cut);
        const fraction = text.slice(cut + 1);
        if (!(GROUPED.test(whole) || DIGITS.test(whole)) || !DIGITS.test(fraction)) throw new Error("no number");
        number = Number(asciiDigits(whole.split(".").join("")) + "." + asciiDigits(fraction));
      } else if (GROUPED.test(text)) {
        number = Number(asciiDigits(text.split(".").join("")));
      } else if (PLAIN.test(text)) {
        number = Number(asciiDigits(text));
      } else {
        throw new Error("no number");
      }
    } else {
      throw new Error("no number");
    }
    if (!Number.isFinite(number) || number < 0) throw new Error("not a finite amount of zero or more");
    return number;
  }

  /* now_stamp of web/app.py: Munich time to the minute ("2026-11-21T10:42"). */
  function nowStamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    try {
      const parts = {};
      const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      for (const part of format.formatToParts(now)) parts[part.type] = part.value;
      return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute;
    } catch (error) {
      return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "T" +
        pad(now.getHours()) + ":" + pad(now.getMinutes());
    }
  }

  async function getFindings(data, entry) {
    if (entry.status !== 200) return serveFile(entry);
    const text = await fileText(entry);
    const body = JSON.parse(text);
    const local = readLocal(body.project);
    if (!Object.keys(local).length) {
      return new Response(text, { status: 200, headers: { "Content-Type": entry.type } });
    }
    for (const finding of body.findings) {
      if (own(local, finding.id)) finding.review = reviewView(local[finding.id]);
    }
    body.counters = count(body.findings, Object.assign({}, data.reviews, local));
    return answer(200, body);
  }

  async function postReview(findingId, text) {
    const data = await manifest();
    if (!own(data.responses, "findings")) return unmapped("POST", "reviews/" + findingId);
    const entry = data.responses.findings;
    if (entry.status !== 200) return serveFile(entry);
    const baked = JSON.parse(await fileText(entry));
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = null;
    }
    if (!isObject(body)) return problem(422, "Die Anfrage ist kein JSON-Objekt.");
    const project = baked.project;
    const shown = own(body, "project") ? body.project : null;
    if (shown !== null && shown !== project) {
      return problem(409, "Die Seite zeigt Projekt " + pyText(shown) + ", gelesen wird jetzt Projekt " + project +
        ". Bitte die Seite neu laden.");
    }
    if (!baked.findings.some((finding) => finding.id === findingId)) {
      return problem(404, "Der Fund " + findingId + " steht nicht in " + baked.source + ".");
    }
    const status = body.status;
    if (!STATUSES.includes(status)) return problem(422, "Status muss confirmed, rejected oder unclear sein.");
    let comment = own(body, "comment") ? body.comment : "";
    let by = own(body, "by") ? body.by : "";
    if (comment === null) comment = "";
    if (by === null) by = "";
    if (typeof comment !== "string" || typeof by !== "string") return problem(422, "Kommentar und Prüfer müssen Text sein.");
    comment = squash(comment);
    by = squash(by);
    if (Array.from(comment).length > MAX_COMMENT) return problem(422, "Der Kommentar ist länger als " + MAX_COMMENT + " Zeichen.");
    if (Array.from(by).length > MAX_BY) return problem(422, "Der Name des Prüfers ist länger als " + MAX_BY + " Zeichen.");
    let estimate;
    try {
      estimate = parseEur(own(body, "eur_estimate") ? body.eur_estimate : null);
    } catch (error) {
      return problem(422, "Die Schätzung in € ist keine Zahl (Beispiel: 1500 oder 1.500,50).");
    }
    const fields = { status: status, by: by, comment: comment, eur_estimate: estimate, at: nowStamp() };
    const local = readLocal(project);
    const reviews = Object.assign({}, data.reviews, local);
    const old = own(reviews, findingId) ? reviews[findingId] : null;
    const saved = Object.assign({}, isObject(old) ? old : {}, fields);
    local[findingId] = saved;
    writeLocal(project, local);
    reviews[findingId] = saved;
    return answer(200, { id: findingId, review: reviewView(saved), counters: count(baked.findings, reviews) });
  }
})();
