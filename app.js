"use strict";
// Example sentences are turned off (the app is used during exams). Set to true to bring them back.
const SHOW_EXAMPLES = false;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const LANG = {
  he: { name: "עברית", label: "עברית", g: "iw", speech: ["he", "iw"] },
  en: { name: "אנגלית", label: "English", g: "en", speech: ["en"] },
  ru: { name: "רוסית", label: "Русский", g: "ru", speech: ["ru"] }
};
const ORDER = ["he", "en", "ru"];
const detect = s => /[֐-׿]/.test(s) ? "he" : /[Ѐ-ӿ]/.test(s) ? "ru" : /[a-zA-Z]/.test(s) ? "en" : null;
const stripNikud = s => String(s).replace(/[֑-ׇ]/g, "");
const normHe = s => stripNikud(s).replace(/[?!.,"'״׳־-]/g, " ").replace(/\s+/g, " ").trim();
const normX = s => String(s).toLowerCase().replace(/ё/g, "е").replace(/́/g, "").replace(/\([^)]*\)/g, "").replace(/[?!.,"']/g, "").replace(/\s+/g, " ").trim();
const SPEAK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';

// ---------- built-in dictionary ----------
const EXTRA = window.DICT_EXTRA || {};
const DICT = window.DICT_RAW.trim().split("\n").map(line => {
  const [he, trRu, en, ru, exHe, exEn, exRu] = line.split("|").map(s => (s || "").trim());
  const x = EXTRA[he] || [];
  return { he, nikud: x[0] || "", trRu, en, ru, exHe, exEn, exRu, heAlts: "", ruAlts: "", pos: "" };
});
// automatically generated extension (window.DICT_AUTO), loaded after the hand-written words
(function addAuto() {
  const have = new Set(DICT.map(e => e.he));
  for (const a of (window.DICT_AUTO || [])) {
    const [nikud, en, ru, heAlts, ruAlts, pos, exHe, exEn, exRu] = a;
    const he = stripNikud(nikud).trim();
    if (!he || have.has(he)) continue;
    have.add(he);
    DICT.push({ he, nikud, trRu: "", en, ru, exHe, exEn, exRu, heAlts, ruAlts, pos, auto: true });
  }
})();
const senses = s => normX(s).split(/\s*[;,]\s*/).map(t => t.replace(/^to /, "")).filter(Boolean);

function findOffline(q, src) {
  const exact = [], viaAlt = [], partial = [];
  if (src === "he") {
    const n = normHe(q);
    for (const e of DICT) {
      const h = normHe(e.he);
      if (h === n) exact.push(e);
      else if (e.heAlts && e.heAlts.split(/\s*,\s*/).map(normHe).includes(n)) viaAlt.push(e);
      else if (n.length > 1 && (h.startsWith(n) || n.startsWith(h) && h.length > 2)) partial.push(e);
    }
  } else {
    const n = normX(q).replace(/^to /, "");
    for (const e of DICT) {
      const list = senses(src === "en" ? e.en : e.ru);
      if (list.includes(n) || (src === "ru" && e.trRu && normX(e.trRu) === n)) exact.push(e);
      else if (src === "ru" && e.ruAlts && senses(e.ruAlts).includes(n)) viaAlt.push(e);
      else if (n.length > 1 && list.some(t => t.startsWith(n))) partial.push(e);
    }
  }
  return { exact: exact.length ? exact : viaAlt.slice(0, 1), partial: partial.concat(exact.length ? viaAlt : viaAlt.slice(1)).slice(0, 8) };
}
function fromDict(e, src) {
  const tr = heTranslit(e.nikud) || {};
  const alt = s => s ? s.split(/\s*,\s*/).filter(Boolean).slice(0, 3) : [];
  return {
    source: src, origin: "offline", pos: e.pos,
    he: { word: e.nikud || e.he, plain: e.he, lat: tr.lat || "", cyr: e.trRu || tr.cyr || "", alt: alt(e.heAlts) },
    en: { word: e.en }, ru: { word: e.ru, alt: alt(e.ruAlts) },
    example: { he: e.exHe, en: e.exEn, ru: e.exRu }
  };
}

// ---------- Hebrew pronunciation from vowel points (nikud) ----------
// Returns { lat, cyr } or null when the word has no vowel points.
const V = { "ְ": "shva", "ֱ": "e", "ֲ": "a", "ֳ": "o", "ִ": "i", "ֵ": "e", "ֶ": "e", "ַ": "a", "ָ": "a", "ֹ": "o", "ֺ": "o", "ֻ": "u", "ׇ": "o" };
function heTranslit(text) {
  if (!/[ְ-ׇּׁׂ]/.test(text || "")) return null;
  const words = text.split(/(\s+|[-־,.!?;:]+)/);
  const lat = [], cyr = [];
  for (const w of words) {
    if (!/[א-ת]/.test(w)) { lat.push(w); cyr.push(w); continue; }
    // split into letters with marks
    const L = [];
    for (const ch of w) {
      if (/[א-ת]/.test(ch)) L.push({ c: ch, m: "" });
      else if (L.length) L[L.length - 1].m += ch;
    }
    const toks = []; // phoneme tokens
    L.forEach((x, i) => {
      const dag = x.m.includes("ּ"), shin = x.m.includes("ׁ"), sin = x.m.includes("ׂ");
      let vowel = null;
      for (const ch of x.m) if (V[ch]) vowel = V[ch];
      const last = i === L.length - 1, first = i === 0;
      const prevVowel = toks.length && /^[aeiou]$/.test(toks[toks.length - 1]);
      let cons;
      switch (x.c) {
        case "א": case "ע": cons = ""; break;
        case "ב": cons = dag ? "b" : "v"; break;
        case "ג": cons = "g"; break;
        case "ד": cons = "d"; break;
        case "ה": cons = (last && !dag) ? "" : "h"; break;
        case "ו":
          if (x.m.includes("ֹ") && !vowel?.match(/^(a|e|i|u)$/)) { toks.push("o"); return; }
          if (dag && !vowel) { toks.push("u"); return; }
          cons = "v"; break;
        case "ז": cons = "z"; break;
        case "ח": cons = "kh"; break;
        case "ט": cons = "t"; break;
        case "י":
          if (!vowel && L[i + 1] && L[i + 1].c === "ו" && i + 1 === L.length - 1) return; // -ав ending (עכשיו)
          if (!vowel && prevVowel && (toks[toks.length - 1] === "i" || toks[toks.length - 1] === "e")) { if (toks[toks.length - 1] === "e" && !last) toks.push("y"); return; }
          if (!vowel && last && prevVowel) { toks.push("y"); return; }
          cons = "y"; break;
        case "כ": case "ך": cons = dag ? "k" : "kh"; break;
        case "ל": cons = "l"; break;
        case "מ": case "ם": cons = "m"; break;
        case "נ": case "ן": cons = "n"; break;
        case "ס": cons = "s"; break;
        case "פ": case "ף": cons = dag ? "p" : "f"; break;
        case "צ": case "ץ": cons = "ts"; break;
        case "ק": cons = "k"; break;
        case "ר": cons = "r"; break;
        case "ש": cons = sin ? "s" : "sh"; break;
        case "ת": cons = "t"; break;
        default: cons = "";
      }
      // furtive patah under a final guttural: vowel comes first (tapuach)
      if (last && vowel === "a" && (x.c === "ח" || x.c === "ע")) { toks.push("a"); if (cons) toks.push(cons); return; }
      if (cons) toks.push(cons);
      if (vowel === "shva") {
        const same = L[i + 1] && stripNikud(L[i + 1].c) === x.c;
        if ((first && "בלמנרוי".includes(x.c)) || same) toks.push("e");
      }
      else if (vowel) toks.push(vowel);
    });
    const latW = toks.join("").replace(/kh/g, "ch").replace(/ey/g, "ei");
    // Cyrillic
    const C = { b: "б", v: "в", g: "г", d: "д", h: "х", z: "з", kh: "х", t: "т", k: "к", l: "л", m: "м", n: "н", s: "с", p: "п", f: "ф", ts: "ц", r: "р", sh: "ш", a: "а", e: "е", i: "и", o: "о", u: "у" };
    let c = "";
    toks.forEach((t, i) => {
      const prev = toks[i - 1];
      const afterVowel = i === 0 || /^[aeiou]$/.test(prev || "");
      if (t === "y") {
        const nx = toks[i + 1];
        const yv = { a: "я", e: "е", u: "ю", o: "йо", i: "и" }[nx];
        if (yv) { c += yv; toks[i + 1] = ""; } else c += "й";
        return;
      }
      if (!t) return;
      if (t === "e" && afterVowel) { c += "э"; return; }
      if (t === "l" && !/^[aeiouy]$/.test(toks.slice(i + 1).find(Boolean) || "")) { c += "ль"; return; }
      c += C[t] || "";
    });
    lat.push(latW); cyr.push(c);
  }
  return { lat: lat.join(""), cyr: cyr.join("") };
}

// ---------- online translation ----------
async function g(sl, tl, q, dts, signal) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + sl + "&tl=" + tl + "&hl=en" +
    dts.map(d => "&dt=" + d).join("") + "&q=" + encodeURIComponent(q);
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
function mainText(d) { return (d?.[0] || []).filter(s => typeof s?.[0] === "string").map(s => s[0]).join("").trim(); }
function romanTarget(d) { const s = (d?.[0] || []).find(s => s && s[0] == null && s[2]); return s ? s[2] : ""; }
function romanSource(d) { const s = (d?.[0] || []).find(s => s && s[0] == null && s[3]); return s ? s[3] : ""; }
function alternatives(d, main) {
  const out = [];
  for (const pos of (d?.[1] || [])) for (const w of (pos?.[1] || [])) if (normX(w) !== normX(main) && !out.includes(w)) out.push(w);
  return out.slice(0, 3);
}
function examplesOf(d) {
  for (const part of d || []) {
    if (Array.isArray(part) && Array.isArray(part[0]) && Array.isArray(part[0][0]) && typeof part[0][0][0] === "string" && /<b>/.test(part[0][0][0]))
      return part[0].map(x => x[0].replace(/<\/?b>/g, ""));
  }
  return [];
}
function stressedRu(d, word) {
  for (const part of d || []) {
    if (!Array.isArray(part)) continue;
    for (const item of part) if (Array.isArray(item) && typeof item[2] === "string" && normX(item[2]) === normX(word) && /́/.test(item[2])) return item[2];
  }
  return "";
}
function pickExample(list, word) {
  const score = s => {
    const n = s.split(/\s+/).length;
    let v = 0;
    if (n >= 4 && n <= 12) v += 3;
    if (/^(i|i'm|he|she|we|they|you|it|the|my|our|his|her|this|there)\b/i.test(s)) v += 2;
    if (s.length > 80) v -= 3;
    if (word && s.toLowerCase().startsWith(word.toLowerCase())) v -= 4; // e.g. "Butterfly the shrimp…"
    return v;
  };
  if (!list.length) return "";
  const s = list.slice().sort((a, b) => score(b) - score(a) || a.length - b.length)[0];
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");
}
async function mymemory(q, sl, tl, signal) {
  const r = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(q) + "&langpair=" + sl + "|" + tl, { signal });
  const j = await r.json();
  return (j?.responseData?.translatedText || "").trim();
}

async function onlineLookup(q, src, signal, onPartial) {
  const [t1, t2] = ORDER.filter(l => l !== src);
  const res = { source: src, origin: "online", he: {}, en: {}, ru: {}, example: {} };
  let d1, d2;
  try {
    [d1, d2] = await Promise.all([t1, t2].map(t => g(LANG[src].g, LANG[t].g, q, ["t", "bd", "rm", "md"], signal)));
  } catch (e) {
    if (e.name === "AbortError") throw e;
    // fallback service
    const [a, b] = await Promise.all([t1, t2].map(t => mymemory(q, src === "he" ? "he" : src, t === "he" ? "he" : t, signal)));
    if (!a && !b) throw e;
    res[src].word = q; res[t1].word = a; res[t2].word = b;
    res.he.plain = res.he.word;
    return res;
  }
  const data = { [t1]: d1, [t2]: d2 };
  res[src].word = q;
  for (const t of [t1, t2]) {
    const main = mainText(data[t]);
    res[t].word = main;
    res[t].alt = alternatives(data[t], main);
    if (t === "he") { res.he.lat = romanTarget(data[t]); }
  }
  if (src === "en") res.en.pron = romanSource(d1);
  if (src === "ru") res.ru.word = stressedRu(d1, q) || q;
  if (src === "he") res.he.word = q;
  // show the translation right away; vowel points and the example follow
  if (onPartial) onPartial(JSON.parse(JSON.stringify(res)));

  // Hebrew vowel points & pronunciation, English pronunciation, Russian stress, example
  const enWord = src === "en" ? q : res.en.word;
  const extra = [];
  extra.push(g("en", "iw", enWord, SHOW_EXAMPLES ? ["t", "rm", "ex"] : ["t", "rm"], signal).then(d => {
    const nik = mainText(d);
    const target = src === "he" ? q : res.he.word;
    if (normHe(nik) === normHe(target)) res.he.word = nik;
    if (!res.en.pron) res.en.pron = romanSource(d);
    return examplesOf(d);
  }).catch(() => []));
  if (src !== "ru" && res.ru.word) extra.push(g("ru", "en", res.ru.word, ["t", "md"], signal).then(d => { const s = stressedRu(d, res.ru.word); if (s) res.ru.word = s; }).catch(() => {}));
  const [exList] = await Promise.all(extra);
  res.he.plain = stripNikud(res.he.word || "");
  const tr = heTranslit(res.he.word);
  res.he.lat = tr ? tr.lat : ""; res.he.cyr = tr ? tr.cyr : "";

  const ex = SHOW_EXAMPLES ? pickExample(exList || [], enWord) : "";
  if (ex) {
    try {
      const [dh, dr] = await Promise.all([g("en", "iw", ex, ["t", "rm"], signal), g("en", "ru", ex, ["t"], signal)]);
      res.example = { en: ex, he: mainText(dh), ru: mainText(dr) };
    } catch (e) { if (e.name === "AbortError") throw e; }
  }
  return res;
}

// ---------- speech ----------
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch { voices = []; } }
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
let audio;
function say(text, lang, btn) {
  text = String(text || "").split(";")[0].replace(/\([^)]*\)/g, "").trim();
  if (!text) return;
  const done = () => btn && btn.classList.remove("playing");
  btn && btn.classList.add("playing");
  const v = voices.find(v => LANG[lang].speech.some(c => v.lang.toLowerCase().replace("_", "-").startsWith(c)));
  if (v) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 0.85; u.onend = u.onerror = done;
      speechSynthesis.speak(u); return;
    } catch {}
  }
  if (navigator.onLine) {
    try {
      audio && audio.pause();
      audio = new Audio("https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" + LANG[lang].g + "&q=" + encodeURIComponent(stripNikud(text).slice(0, 190)));
      audio.onended = audio.onerror = done;
      audio.play().catch(() => { done(); toast("ההשמעה נכשלה"); });
      return;
    } catch {}
  }
  done();
  toast("אין בטלפון קול ל" + LANG[lang].name + ". אפשר להוסיף אותו בהגדרות ההקראה של הטלפון.");
}
function toast(m) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom));background:var(--ink);color:var(--card);padding:10px 16px;border-radius:10px;font-size:14px;z-index:20;max-width:calc(100% - 32px);text-align:center"; document.body.append(t); }
  t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200);
}

// ---------- render ----------
let current = null;
function render(r, opts = {}) {
  current = r;
  const order = [r.source, ...ORDER.filter(l => l !== r.source)];
  const row = l => {
    const x = r[l] || {};
    let pron = "";
    if (l === "he") pron = [x.lat && `<b class="ltr" dir="ltr">${esc(x.lat)}</b>`, x.cyr && esc(x.cyr)].filter(Boolean).join(" · ");
    if (l === "en" && x.pron && normX(x.pron) !== normX(x.word)) pron = `<span dir="ltr">${esc(x.pron)}</span>`;
    const dir = l === "he" ? "rtl" : "ltr";
    return `<div class="row ${l}${l === r.source ? " src" : ""}">
      <span class="tag l-${l}">${LANG[l].label}</span>
      <div style="min-width:0" dir="${dir}" class="${dir === "ltr" ? "ltr" : ""}">
        <div class="word">${esc(x.word || "—")}</div>
        ${x.alt && x.alt.length ? `<div class="alt">${esc(x.alt.join(", "))}</div>` : ""}
        ${pron ? `<div class="pron">${pron}</div>` : ""}
      </div>
      <button class="say ${l}" data-say="${l}" type="button" aria-label="השמעה ב${LANG[l].name}">${SPEAK}</button>
    </div>`;
  };
  const ex = r.example || {};
  const exLine = l => {
    if (!ex[l]) return "";
    const sub = l === "he" && ex.heLat ? `<span class="sub ltr" dir="ltr">${esc(ex.heLat)}</span>` : "";
    return `<div class="exline"><p dir="${l === "he" ? "rtl" : "ltr"}" class="${l === "he" ? "" : "ltr"}">${esc(ex[l])}${sub}</p>
      <button class="say ${l}" data-ex="${l}" type="button" aria-label="השמעת המשפט ב${LANG[l].name}">${SPEAK}</button></div>`;
  };
  const badge = opts.example ? "דוגמה · הקלידו מילה כדי להתחיל" : r.origin === "offline" ? "מהמילון המובנה" : "תרגום מהאינטרנט";
  $("#out").innerHTML = `<div class="card">
    <div class="card-head"><strong>${opts.example ? "דוגמה" : "תרגום"}${r.pos && !opts.example ? ` <span style="font-weight:400;color:var(--muted)">· ${esc(r.pos)}</span>` : ""}</strong><span class="badge">${esc(badge)}</span></div>
    ${order.map(row).join("")}
    ${SHOW_EXAMPLES && (ex.he || ex.en || ex.ru) ? `<div class="ex"><h2>משפט לדוגמה</h2>${order.map(exLine).join("")}</div>` : ""}
    ${opts.loading ? `<div class="ex"><h2>טוען ניקוד…</h2></div>` : ""}
  </div>`;
}
$("#out").addEventListener("click", e => {
  const b = e.target.closest("[data-say],[data-ex]");
  if (!b || !current) return;
  if (b.dataset.say) { const l = b.dataset.say; say(l === "he" ? (current.he.word || current.he.plain) : current[l].word, l, b); }
  else { const l = b.dataset.ex; say(current.example[l], l, b); }
});
function message(html) { current = null; $("#out").innerHTML = `<div class="card"><div class="msg">${html}</div></div>`; }
function showSuggestions(list) {
  const el = $("#suggest");
  el.hidden = !list.length;
  el.innerHTML = list.length ? `<span>אולי התכוונתם:</span>` + list.map(e => `<button type="button" data-w="${esc(e.he)}">${esc(e.he)} · ${esc(e.ru.split(/[;,]/)[0])}</button>`).join("") : "";
}
$("#suggest").addEventListener("click", e => { const b = e.target.closest("[data-w]"); if (b) { $("#q").value = b.dataset.w; onInput(); lookup(b.dataset.w); } });

// ---------- lookup ----------
let ctl = null;
// online results are remembered on the phone, so a word looked up once is instant next time (also offline)
const cache = new Map(store.get("milonit.cache", []));
function remember(q, r) {
  cache.delete(q); cache.set(q, r);
  while (cache.size > 500) cache.delete(cache.keys().next().value);
  store.set("milonit.cache", [...cache]);
}
async function lookup(raw) {
  const q = raw.trim();
  if (!q) return;
  const src = detect(q);
  if (!src) { message("הקלידו מילה באותיות עבריות, אנגליות או רוסיות."); return; }
  addRecent(q);
  showSuggestions([]);
  // Default: the built-in dictionary. The internet is used only for words that are not in it.
  const { exact, partial } = findOffline(q, src);
  const local = exact.length ? fromDict(exact[0], src) : null;
  const showLocal = () => { render(local); if (exact.length > 1) showSuggestions(exact.slice(1)); };
  if (local) { showLocal(); return; }
  if (cache.has(q)) { render(cache.get(q)); return; } // looked up before: instant, works offline too
  if (!navigator.onLine) {
    message(`«${esc(q)}» לא נמצאת במילון המובנה, ואין כרגע חיבור לאינטרנט.<br>התחברו לאינטרנט כדי לתרגם כל מילה.`);
    showSuggestions(partial); return;
  }
  if (ctl) ctl.abort();
  ctl = new AbortController();
  $("#go").disabled = true;
  if (local) render(local, { loading: true }); else message('<div class="spinner"></div>מתרגם…');
  // keep the better data from the built-in entry where the online result lacks it
  const merge = r => {
    if (!local) return r;
    if (!/[ְ-ּ]/.test(r.he.word || "") && /[ְ-ּ]/.test(local.he.word || "")) { r.he.word = local.he.word; r.he.lat = local.he.lat; }
    if (!r.he.cyr && local.he.cyr) r.he.cyr = local.he.cyr;
    if (local.example.he && local.example.ru && local.example.en) r.example = local.example;
    r.pos = r.pos || local.pos;
    return r;
  };
  try {
    const SCRIPT = { he: /[א-ת]/, ru: /[Ѐ-ӿ]/, en: /[a-zA-Z]/ };
    const isValid = r => ORDER.filter(l => l !== src).every(l => r[l].word && SCRIPT[l].test(r[l].word) && normX(r[l].word) !== normX(q));
    const r = await onlineLookup(q, src, ctl.signal, p => { if (isValid(p)) render(merge(p), { loading: true }); });
    if (!isValid(r)) {
      if (local) { showLocal(); return; }
      message(`לא נמצא תרגום ל«${esc(q)}». בדקו את האיות ונסו שוב.`); showSuggestions(partial); return;
    }
    const final = merge(r);
    remember(q, final); render(final);
  } catch (e) {
    if (e.name === "AbortError") return;
    if (local) { showLocal(); return; }
    message("התרגום דרך האינטרנט נכשל. בדקו את החיבור ונסו שוב.");
    showSuggestions(partial);
  } finally { $("#go").disabled = false; }
}

let typeTimer;
function onInput() {
  const v = $("#q").value, l = detect(v);
  $("#detect").textContent = l ? "שפה שזוהתה: " + LANG[l].name : "";
  // instant results while typing, for words already on the phone (no internet calls here)
  clearTimeout(typeTimer);
  typeTimer = setTimeout(() => {
    const q = v.trim(); if (!q || !l) return;
    const { exact } = findOffline(q, l);
    if (exact.length) { render(fromDict(exact[0], l)); showSuggestions(exact.slice(1)); }
    else if (cache.has(q)) render(cache.get(q));
  }, 120);
}
$("#form").addEventListener("submit", e => { e.preventDefault(); $("#q").blur(); lookup($("#q").value); });
$("#q").addEventListener("input", onInput);

// ---------- recent ----------
let recent = store.get("milonit.recent", []);
function addRecent(q) { recent = [q, ...recent.filter(x => x !== q)].slice(0, 8); store.set("milonit.recent", recent); renderRecent(); }
function renderRecent() {
  const el = $("#recent");
  el.hidden = !recent.length;
  el.innerHTML = `<span>חיפושים אחרונים:</span>` + recent.map(r => `<button type="button" data-r="${esc(r)}">${esc(r)}</button>`).join("");
}
$("#recent").addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) { $("#q").value = b.dataset.r; onInput(); lookup(b.dataset.r); } });

// ---------- online status ----------
function netStatus() {
  const on = navigator.onLine, n = $("#net");
  n.classList.toggle("off", !on);
  n.querySelector("span").textContent = on ? "מחובר" : "ללא אינטרנט: מילון מובנה";
}
window.addEventListener("online", netStatus);
window.addEventListener("offline", netStatus);

// ---------- install (PWA) ----------
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
let deferred = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferred = e;
  if (!store.get("milonit.hideInstall", false)) $("#install").hidden = false;
});
$("#installBtn").addEventListener("click", async () => {
  if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $("#install").hidden = true; }
});
$("#installClose").addEventListener("click", () => { $("#install").hidden = true; store.set("milonit.hideInstall", true); });
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
if (isIOS && !standalone && !store.get("milonit.hideInstall", false)) {
  $("#installText").textContent = "להתקנה באייפון: לחצו על כפתור השיתוף ↑ ואז «הוספה למסך הבית».";
  $("#installBtn").hidden = true;
  $("#install").hidden = false;
}
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- start ----------
render(fromDict(DICT[0], "he"), { example: true });
renderRecent();
netStatus();
