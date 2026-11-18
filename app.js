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

// ---------- word-form aware search ----------
// Hebrew: final letters unified, so "ספרים" → "ספר" compares cleanly
const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const heKey = s => normHe(s).replace(/[ךםןףץ]/g, c => FINALS[c]);
// spelling without the vowel letters ו / י (except the first letter): אישה = אשה, כיסא = כסא
const heSkel = s => { const k = heKey(s); return k.charAt(0) + k.slice(1).replace(/[וי]/g, ""); };
// true when one spelling is the other with only extra ו / י letters added (אשה ↔ אישה), nothing moved
function onlyVavYodDiff(a, b) {
  if (a === b) return true;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  if (l.length - s.length > 2) return false;
  let i = 0;
  for (const ch of l) { if (i < s.length && ch === s[i]) i++; else if (ch !== "ו" && ch !== "י") return false; }
  return i === s.length;
}
// irregular plurals (keys are written with final letters unified)
const HE_IRREG = Object.fromEntries(Object.entries({
  "בתים": "בית", "ערים": "עיר", "אנשים": "איש", "נשים": "אישה", "ימים": "יום", "לילות": "לילה", "שנים": "שנה",
  "אחים": "אח", "אחיות": "אחות", "בנים": "בן", "בנות": "בת", "אבות": "אבא", "אמהות": "אמא", "עיניים": "עין", "ידיים": "יד",
  "רגליים": "רגל", "שיניים": "שן", "אוזניים": "אוזן", "דברים": "דבר", "שמות": "שם", "מקומות": "מקום", "חלונות": "חלון",
  "דלתות": "דלת", "ארצות": "ארץ", "שעות": "שעה", "חודשים": "חודש", "ראשים": "ראש", "כלים": "כלי", "עצים": "עץ",
  "פנים": "פנים", "חברות": "חברה", "מורות": "מורה", "רחובות": "רחוב", "כוכבים": "כוכב", "לבבות": "לב", "ספרות": "ספר",
  "ילדות": "ילדה", "משפחות": "משפחה", "דודים": "דוד", "סבים": "סבא", "סבתות": "סבתא", "נעליים": "נעליים", "מכנסיים": "מכנסיים"
}).map(([k, v]) => [heKey(k), v]));
function heForms(q) {
  const base = heKey(q);
  const out = [];
  let pl = 0; // how many prefix letters were stripped for the current stem
  const add = (s, how) => { if (s.length >= 2 && !out.some(o => o.s === s)) out.push({ s, how, pl }); };
  // prefixes ו ה ב כ ל מ ש, up to three of them (וכשה...)
  const stems = [{ s: base, p: "" }];
  for (let i = 0; i < 3; i++) {
    const last = stems[stems.length - 1].s;
    if (last.length > 2 && "והבכלמש".includes(last[0])) stems.push({ s: last.slice(1), p: stems[stems.length - 1].p + last[0] });
    else break;
  }
  for (const { s, p } of stems) {
    const tag = p ? "prefix" : "";
    pl = p.length;
    if (HE_IRREG[s]) add(heKey(HE_IRREG[s]), "form");
    add(s, tag);
    if (s.endsWith("יימ") && s.length > 4) add(s.slice(0, -3), "form"); // dual: עיניים → עין
    // plural and feminine endings
    if (s.endsWith("ימ") && s.length > 3) add(s.slice(0, -2), "form"); // final ם is stored as מ
    if (s.endsWith("ות") && s.length > 3) { add(s.slice(0, -2) + "ה", "form"); add(s.slice(0, -2), "form"); add(s.slice(0, -2) + "ת", "form"); }
    if (s.endsWith("ת") && s.length > 2) add(s.slice(0, -1) + "ה", "form");
    if (s.endsWith("יות") && s.length > 4) add(s.slice(0, -3) + "ית", "form");
    if (s.endsWith("ה") && s.length > 2) add(s.slice(0, -1), "form");
  }
  return out;
}
// ---------- Hebrew verbs: conjugated form → infinitive (הלכתי → ללכת, מדברים → לדבר) ----------
// Strips tense prefixes/suffixes, guesses the root, rebuilds the infinitive in the common verb patterns
// and keeps only infinitives that exist in the dictionary. Keys use non-final letters (see heKey).
const V_PRE = ["", "א", "ת", "י", "נ", "מ", "ה", "הת", "מת", "את", "ית", "נת", "תת", "הי", "הו", "מו", "יו", "תו", "או", "נו"];
const V_SUF = ["", "תי", "ת", "נו", "תמ", "תנ", "ו", "ה", "ימ", "ות", "י", "נה", "תה"];
// roots / short stems whose infinitive is irregular
const V_IRREG = { "הלכ": "ללכת", "לכ": "ללכת", "לקח": "לקחת", "קח": "לקחת", "נתנ": "לתת", "תנ": "לתת", "תת": "לתת", "אמר": "להגיד" };
// Remove vowel letters to get the root. Rules: a double יי/וו is a real consonant and stays;
// ו inside the stem goes; י goes only right after the first letter (דיבר) or when a tense prefix
// was stripped (מזמין, יכתיב). keepFirst=false also drops a leading י/ו (יושב → שב).
function dropMatres(core, p, keepFirst) {
  let out = "";
  for (let i = 0; i < core.length; i++) {
    const ch = core[i];
    const dbl = core[i - 1] === ch || core[i + 1] === ch;
    if ((ch === "ו" || ch === "י") && !dbl) {
      if (i === 0) { if (!keepFirst) continue; out += ch; continue; }
      if (ch === "ו") continue;
      if (i === 1 || p !== "") continue;
      if (i === core.length - 1) continue; // final י of a stem (קני → קנ)
      return null; // י in the middle without a prefix: not a verb pattern (גרים)
    }
    out += ch;
  }
  return out;
}
function heVerbInfinitives(word) {
  const w = heKey(word);
  const out = new Map(); // infinitive key → cost
  const add = (inf, cost) => { const k = heKey(inf); if (!out.has(k) || out.get(k) > cost) out.set(k, cost); };
  for (const p of V_PRE) {
    if (!w.startsWith(p)) continue;
    for (const s of V_SUF) {
      if (!w.endsWith(s) || w.length - p.length - s.length < 2) continue;
      const core = w.slice(p.length, w.length - s.length);
      // plural present (כותבים) needs ו after the first root letter or a short root (גרים); an article + plural is a noun
      if ((s === "ימ" || s === "ות") && !p.startsWith("מ") && !(core[1] === "ו" || core.replace(/[וי]/g, "").length === 2)) continue;
      if (p === "ה" && (s === "ימ" || s === "ות")) continue;
      if ((s === "ימ" || s === "ות") && core.endsWith("י")) continue; // -יים / -יות are noun endings (מכוניות)
      if (p === "" && s === "" && core.length > 4) continue;           // a bare 5-letter word is not a basic verb form
      if (core.endsWith("י") && s === "") continue;                     // a final י needs a tense ending after it (קניתי)
      if (core.endsWith("ו") && s !== "") continue;                     // ...ות / ...ית endings after ו belong to nouns (מכוניות)
      // a word starting with ה is a verb only as הפעיל (הזמין, with י) or התפעל (הת-); otherwise ה is the article (המורה)
      if (p === "" && core.startsWith("ה") && !core.startsWith("הת") && !core.slice(1).includes("י")) continue;
      // הפעיל past with no ending (הזמין) or -ה / -ו (הזמינה) always keeps its י; without it ה- is the article (הרופא)
      if (p === "ה" && (s === "" || s === "ה" || s === "ו") && !core.includes("י")) continue;
      const base = p.length + s.length
        - (p.startsWith("מ") || p === "ה" ? 0.5 : 0)   // מ- (present) and ה- (הפעיל past) are strong verb signs
        + (s === "י" && (p === "" || p === "ה") ? 0.8 : 0); // a lone -י ending is rare for verbs
      // which vowel letters inside the stem were there: י shows הפעיל (מזמין) or פיעל (דיבר), ו shows פעל (כותב)
      const hasYod = core.slice(1).includes("י"), hasVav = core.slice(1).includes("ו");
      const hifil = p.startsWith("ה") || p.startsWith("לה") ? 0 : hasYod ? 0.1 : 0.3; // הפעיל without ה- or י is less likely
      // two guesses for the root: drop ו/י inside the word only, or the first letter too
      const roots = new Set([dropMatres(core, p, true), dropMatres(core, p, false)].filter(Boolean));
      for (const r of roots) {
        const cost = base + (core.length - r.length) * 0.1;
        if (V_IRREG[r]) add(V_IRREG[r], cost);
        if (r.length === 3) {
          const [a, b, c] = r;
          add("ל" + a + b + "ו" + c, cost + (c === "ת" ? 0.8 : 0)); // פעל: לכתוב (…ות is usually a ל"ה verb instead)
          add("ל" + a + b + c, cost + 0.05);         // פיעל: לדבר
          add("לה" + a + b + "י" + c, cost + hifil); // הפעיל: להזמין
          add("להת" + a + b + c, cost);              // התפעל: להתלבש
          if (c === "ה") {
            const fem = s === "" && hasYod ? 1.5 : 0; // בינה: ה is more likely a feminine ending than a root letter
            add("ל" + a + b + "ות", cost + fem); add("לה" + a + b + "ות", cost + hifil + fem); add("להת" + a + b + "ות", cost + fem);
          }
          if (a === "י") { add("ל" + b + c + "ת", cost); add("להו" + b + "י" + c, cost); }  // לשבת, להוריד
          if (a === "נ") { add("לי" + b + "ו" + c, cost); add("ל" + b + c + "ת", cost); }   // ליפול
          if (a === "א") add("ל" + "ו" + b + c, cost + 0.2);                               // לומר
        } else if (r.length === 2) {
          const [a, b] = r;
          const lamedHe = (hasYod && !hasVav ? 0.3 : 0) + (p.startsWith("ה") ? 0.2 : 0); // בינ / הבנתי → להבין rather than לבנות
          add("ל" + a + "ו" + b, cost);   // לגור, לבוא
          add("ל" + a + "י" + b, cost);   // לשים
          add("לה" + a + "י" + b, cost + (hasVav ? 0.3 : 0));  // להבין
          add("ל" + a + b + "ות", cost + lamedHe);  // לקנות, לראות
          add("לה" + a + b + "ות", cost + lamedHe + 0.1);
          add("ל" + a + b + "ת", cost);   // לשבת, לרדת, לדעת (אשב, ארד, אדע)
        } else if (r.length === 4) {
          add("ל" + r, cost + 0.1);       // לטלפן
          add("להת" + r, cost + 0.1);
        }
      }
    }
  }
  return out;
}
const isVerbEntry = e => e.pos === "פועל" || /^to /.test(e.en) || (/^ל/.test(e.he) && /^[а-яё]+(ть|ться|ти)(?=$|[\s;,(])/.test(e.ru));
// before a verb only conjunctions are stripped: ו, ש, כש (and combinations), never ב/ל/מ/כ alone
const V_CONJ = ["", "ו", "ש", "כש", "וכש", "וש"];
function findHeVerb(q) {
  const w = heKey(q);
  let best = null;
  for (const c of V_CONJ) {
    if (!w.startsWith(c) || w.length - c.length < 2) continue;
    const extra = c.length * 0.5 + (c.includes("ש") ? 1 : 0); // ש- before a verb is rarer than a word that starts with ש
    for (const [inf, cost] of heVerbInfinitives(w.slice(c.length))) {
      const hit = (IDX.he.get(inf) || []).filter(isVerbEntry);
      if (hit.length && (!best || cost + extra < best.cost)) best = { hit, cost: cost + extra };
    }
  }
  return best; // { hit, cost } or null
}

// Russian verb endings (present, past, imperative), longest first
const RU_VERB_END = ["ешься","ется","ются","ится","ятся","ался","алась","ались","ешь","ете","ишь","ите","ает","яет","ует","ают","яют","уют","ала","ало","али","ила","или","ела","ели","ем","ет","им","ит","ут","ют","ат","ят","ал","ил","ел","ла","ли","ло","ю","у","й","л","и"];
// English irregular past forms → base verb
const EN_IRREG = Object.fromEntries("went:go ate:eat saw:see seen:see did:do done:do had:have was:be were:be been:be took:take taken:take gave:give given:give came:come made:make said:say got:get knew:know known:know thought:think found:find told:tell wrote:write written:write bought:buy brought:bring left:leave felt:feel kept:keep slept:sleep ran:run sat:sit stood:stand spoke:speak spoken:speak drank:drink drove:drive began:begin begun:begin heard:hear met:meet paid:pay sold:sell taught:teach caught:catch fought:fight understood:understand forgot:forget forgotten:forget lost:lose built:build sent:send spent:spend chose:choose chosen:choose flew:fly grew:grow threw:throw wore:wear won:win broke:break broken:break fell:fall hid:hide rode:ride sang:sing swam:swim children:child men:man women:woman feet:foot teeth:tooth mice:mouse people:person"
  .split(" ").map(p => p.split(":")));

// Russian / English: compare word stems (книги, книгу, книгой → книг)
const RU_END = ["ыми","ими","ами","ями","ого","его","ому","ему","ешь","ете","ишь","ите","ться","тся","ая","яя","ое","ее","ые","ие","ых","их","ым","им","ой","ей","ую","юю","ом","ем","ах","ях","ам","ям","ов","ев","ет","ит","ут","ют","ат","ят","ть","ла","ло","ли","а","я","ы","и","у","ю","е","о","ь","й","л"];
function ruStem(w) {
  w = normX(w);
  if (w.length <= 3) return w;
  for (const e of RU_END) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
  return w;
}
function enStem(w) {
  w = normX(w).replace(/^to /, "");
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  for (const e of ["ing", "ed", "es", "s"]) if (w.endsWith(e) && w.length - e.length >= 3) { let b = w.slice(0, -e.length); if (/(.)\1$/.test(b) && e !== "s") b = b.slice(0, -1); return b.replace(/e$/, ""); }
  return w.replace(/e$/, "");
}
const IDX = { he: new Map(), heAlt: new Map(), skel: new Map(), ru: new Map(), ruStem: new Map(), en: new Map(), enStem: new Map() };
const put = (m, k, e) => { if (!k) return; const a = m.get(k); if (!a) m.set(k, [e]); else if (!a.includes(e)) a.push(e); };
function buildIndex() {
  for (const e of DICT) {
    put(IDX.he, heKey(e.he), e);
    put(IDX.skel, heSkel(e.he), e);
    if (e.heAlts) for (const a of e.heAlts.split(/\s*,\s*/)) put(IDX.heAlt, heKey(a), e);
    for (const s of senses(e.ru)) { put(IDX.ru, s, e); if (!s.includes(" ")) put(IDX.ruStem, ruStem(s), e); }
    if (e.trRu) put(IDX.ru, normX(e.trRu), e);
    if (e.ruAlts) for (const s of senses(e.ruAlts)) { put(IDX.ruStem, "~" + (s.includes(" ") ? s : ruStem(s)), e); }
    for (const s of senses(e.en)) { put(IDX.en, s, e); if (!s.includes(" ")) put(IDX.enStem, enStem(s), e); }
  }
}

buildIndex();

function findOffline(q, src) {
  let exact = [], how = "", partial = [];
  if (src === "he") {
    const forms = heForms(q);
    // whole word as typed: that's the answer
    const direct = IDX.he.get(heKey(q));
    if (direct) { exact = direct; }
    else {
      // otherwise weigh every reading and keep the most likely one; the others become suggestions
      const cands = [];
      for (const f of forms) {
        const hit = IDX.he.get(f.s);
        if (hit) cands.push({ hit, how: f.how || "form", score: f.pl * 0.8 + (f.how === "form" ? 1.2 : 0) });
        if (f.how !== "form") {
          const sp = (IDX.skel.get(heSkel(f.s)) || []).filter(e => onlyVavYodDiff(f.s, heKey(e.he)));
          if (sp.length) cands.push({ hit: sp, how: "spelling", score: 2.5 + f.pl * 0.6 });
        }
      }
      const v = findHeVerb(q);
      if (v) cands.push({ hit: v.hit, how: "verb", score: 0.25 + 0.2 * v.cost });
      cands.sort((a, b) => a.score - b.score);
      if (cands.length) {
        exact = cands[0].hit.slice(); how = cands[0].how;
        for (const c of cands.slice(1)) for (const e of c.hit) if (!exact.includes(e) && !partial.includes(e)) partial.push(e);
      }
    }
    if (!exact.length) for (const f of forms) { const hit = IDX.heAlt.get(f.s); if (hit) { exact = hit; how = "alt"; break; } }
    if (!exact.length) {
      const n = heKey(q);
      if (n.length > 1) for (const e of DICT) { const h = heKey(e.he); if (h.startsWith(n)) partial.push(e); if (partial.length >= 8) break; }
    }
  } else if (src === "ru") {
    const n = normX(q);
    exact = IDX.ru.get(n) || [];
    // verbs: говорю → говорить, читаешь → читать, работал → работать, люблю → любить, пишу → писать
    if (!exact.length && !n.includes(" ")) {
      outer: for (const end of RU_VERB_END) {
        if (!n.endsWith(end) || n.length - end.length < 2) continue;
        const stem0 = n.slice(0, n.length - end.length);
        const stems = [stem0];
        if (/[бпвмф]л$/.test(stem0)) stems.push(stem0.slice(0, -1));                 // любл → люб
        const alt = { "ж": ["з", "д", "г"], "ч": ["т", "к"], "щ": ["ст", "ск"], "ш": ["с", "х"] }[stem0.slice(-1)];
        if (alt) for (const a of alt) stems.push(stem0.slice(0, -1) + a);           // пиш → пис, хоч → хот
        for (const stem of stems) for (const inf of ["ть", "ать", "ять", "ить", "еть", "овать", "ться", "аться", "иться"]) {
          const hit = (IDX.ru.get(stem + inf) || []).filter(isVerbEntry);
          if (hit.length) { exact = hit; how = "verb"; break outer; }
        }
      }
    }
    // ending cut off, compared with whole dictionary words (салаты → салат), then stem to stem
    if (!exact.length && !n.includes(" ")) for (let k = 1; k <= 3 && n.length - k >= 3; k++) { const hit = IDX.ru.get(n.slice(0, -k)); if (hit) { exact = hit; how = "form"; break; } }
    if (!exact.length && !n.includes(" ")) { exact = IDX.ruStem.get(ruStem(n)) || []; how = exact.length ? "form" : ""; }
    if (!exact.length) { exact = (IDX.ruStem.get("~" + (n.includes(" ") ? n : ruStem(n))) || []).slice(0, 1); how = exact.length ? "alt" : ""; }
    if (!exact.length && n.length > 1) for (const e of DICT) { if (senses(e.ru).some(t => t.startsWith(n))) partial.push(e); if (partial.length >= 8) break; }
  } else {
    const n = normX(q).replace(/^to /, "");
    exact = IDX.en.get(n) || [];
    if (!exact.length && EN_IRREG[n]) { exact = IDX.en.get(EN_IRREG[n]) || []; how = exact.length ? "verb" : ""; }
    if (!exact.length && !n.includes(" ")) { exact = IDX.enStem.get(enStem(n)) || []; how = exact.length ? "form" : ""; }
    if (!exact.length && n.length > 1) for (const e of DICT) { if (senses(e.en).some(t => t.startsWith(n))) partial.push(e); if (partial.length >= 8) break; }
  }
  // hand-written entries first
  exact = exact.slice().sort((a, b) => (a.auto ? 1 : 0) - (b.auto ? 1 : 0));
  return { exact, partial, how };
}
const HOW_TEXT = { prefix: "צורת הבסיס", form: "צורת הבסיס", spelling: "כתיב אחר", alt: "פירוש קרוב", verb: "שם הפועל" };
function fromDict(e, src, how) {
  const r = fromDictRaw(e, src);
  r.how = how || "";
  return r;
}
function fromDictRaw(e, src) {
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
  if (navigator.onLine && !exam) {
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
  const badge = opts.example ? "דוגמה · הקלידו מילה כדי להתחיל" : r.origin === "offline" ? "מהמילון המובנה" + (r.how ? " · נמצא לפי " + HOW_TEXT[r.how] : "") : "תרגום מהאינטרנט";
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
  const { exact, partial, how } = findOffline(q, src);
  const local = exact.length ? fromDict(exact[0], src, how) : null;
  const showLocal = () => { render(local); if (exact.length > 1) showSuggestions(exact.slice(1)); };
  if (local) { showLocal(); return; }
  if (cache.has(q)) { render(cache.get(q)); return; } // looked up before: instant, works offline too
  if (exam) {
    message(`«${esc(q)}» לא נמצאת במילון המובנה.<br>במצב מבחן אין תרגום מהאינטרנט. נסו צורה אחרת של המילה.`);
    showSuggestions(partial); return;
  }
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
    const { exact, how } = findOffline(q, l);
    if (exact.length) { render(fromDict(exact[0], l, how)); showSuggestions(exact.slice(1)); }
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
  const on = navigator.onLine && !exam, n = $("#net");
  n.classList.toggle("off", !on);
  n.querySelector("span").textContent = exam ? "מצב מבחן: מילון מובנה בלבד" : on ? "מחובר" : "ללא אינטרנט: מילון מובנה";
}

// ---------- exam mode ----------
let exam = store.get("milonit.exam", false);
function setExam(on) {
  exam = on; store.set("milonit.exam", on);
  $("#examBtn").setAttribute("aria-pressed", on);
  $("#examBtn").textContent = on ? "יציאה ממצב מבחן" : "מצב מבחן";
  $("#examBar").hidden = !on;
  if (on && ctl) ctl.abort();
  netStatus();
}
$("#examBtn").addEventListener("click", () => { setExam(!exam); if (exam) runChecks(); });

// ---------- readiness check ----------
const APP_FILES = ["index.html", "app.js", "dict.js", "dict-extra.js", "dict-auto.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
async function offlineReady() {
  if (!("caches" in window) || !("serviceWorker" in navigator)) return { ok: false, why: "הדפדפן הזה לא תומך בשמירה לאופליין." };
  try {
    const keys = (await caches.keys()).filter(k => k.startsWith("milonit-")).sort();
    if (!keys.length) return { ok: false, why: "האפליקציה עוד לא נשמרה. פתחו אותה פעם אחת כשיש אינטרנט וחכו כמה שניות." };
    const c = await caches.open(keys[keys.length - 1]);
    const missing = [];
    for (const f of APP_FILES) if (!(await c.match(new URL(f, location.href).href, { ignoreSearch: true }))) missing.push(f);
    return missing.length ? { ok: false, why: "חסרים קבצים: " + missing.join(", ") + ". פתחו את האפליקציה עם אינטרנט ונסו שוב." } : { ok: true };
  } catch { return { ok: false, why: "לא הצלחתי לבדוק את הזיכרון של האפליקציה." }; }
}
function voiceFor(lang) { return voices.find(v => LANG[lang].speech.some(c => v.lang.toLowerCase().replace("_", "-").startsWith(c))); }
async function runChecks() {
  $("#ready").hidden = false;
  const items = [];
  const row = (state, title, note) => `<li class="${state}"><span class="mark">${state === "ok" ? "✓" : state === "bad" ? "✗" : "…"}</span><span>${esc(title)}${note ? `<small>${esc(note)}</small>` : ""}</span></li>`;
  $("#checks").innerHTML = row("wait", "בודק…");
  const off = await offlineReady();
  items.push(row(off.ok ? "ok" : "bad", off.ok ? "האפליקציה שמורה בטלפון ותעבוד בלי אינטרנט" : "האפליקציה עוד לא מוכנה לאופליין", off.why));
  items.push(row(DICT.length > 1000 ? "ok" : "bad", `המילון המובנה: ${DICT.length.toLocaleString("he-IL")} מילים`));
  items.push(row(standalone ? "ok" : "bad", standalone ? "האפליקציה מותקנת במסך הבית" : "האפליקציה פתוחה בדפדפן ולא מותקנת",
    standalone ? "" : "מומלץ להתקין אותה (הוספה למסך הבית), כדי שתיפתח גם בלי אינטרנט."));
  loadVoices();
  const vHint = "אפשר להוסיף קול בהגדרות הטלפון: אנדרואיד ← נגישות ← המרת טקסט לדיבור. אייפון ← נגישות ← תוכן מוקרא ← קולות.";
  for (const l of ["he", "ru", "en"]) {
    const v = voiceFor(l);
    items.push(row(v ? "ok" : "bad", v ? `הגייה ב${LANG[l].name} עובדת בלי אינטרנט` : `אין בטלפון קול ל${LANG[l].name}`, v ? "" : "בלי אינטרנט כפתור ההשמעה לא יעבוד בשפה הזו. " + vHint));
  }
  $("#checks").innerHTML = items.join("");
}
$("#checkBtn").addEventListener("click", runChecks);
$("#readyClose").addEventListener("click", () => { $("#ready").hidden = true; });
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
setExam(exam);
