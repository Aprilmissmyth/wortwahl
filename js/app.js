"use strict";
(function () {
  const DATA = window.WORDLIST;
  if (!DATA) {
    document.querySelector("main").textContent = "缺少 js/words.js，请先运行 tools/build.py 生成。";
    return;
  }
  const WORDS = DATA.words;
  const BY_ID = Object.fromEntries(WORDS.map((w) => [w.id, w]));
  const CATS = DATA.categories || {};
  const RULES = window.RULES || { groups: [], lessons: [] };
  const LESSONS = RULES.lessons;
  const LESSON_BY_ID = Object.fromEntries(LESSONS.map((l) => [l.id, l]));
  const GROUP_TITLE = Object.fromEntries(RULES.groups.map((g) => [g.id, g.title]));
  // Every rule example and test, keyed by its audio path (used for pronunciation flags).
  const RULE_ITEM_BY_AUDIO = {};
  for (const l of LESSONS) for (const x of l.examples.concat(l.tests)) RULE_ITEM_BY_AUDIO[x.audio] = x;

  // Words tested in rule lessons join spaced review. A word that is already in the A1 list
  // is linked to that entry; any other becomes an extra review-only word.
  const BASE_IDS = new Set(WORDS.map((w) => w.id));
  const ALL_WORDS = WORDS.slice();
  const slugify = (s) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Gender lessons train the article; the other lessons train the meaning.
  const ruleSkill = (t) => (t.type === "gender" || t.type === "cgender" ? "g" : "m");
  const idByForm = {};
  for (const w of WORDS) idByForm[w.de + "|" + (w.pos === "noun" ? w.gender : "")] = w.id;
  for (const l of LESSONS) {
    CATS["rule-" + l.id] = "规律 · " + l.title;
    if (l.review === false) continue;
    for (const t of l.tests) {
      const form = t.de + "|" + (t.gender || "");
      let id = idByForm[form];
      if (!id) {
        id = "r-" + slugify(t.de) + (t.gender ? "-" + t.gender : "");
        const v = { id, de: t.de, pos: t.gender ? "noun" : "other", zh: t.zh, audio: t.audio, cat: "rule-" + l.id };
        if (t.gender) v.gender = t.gender;
        if (t.en) v.en = t.en;
        if (t.parts) v.parts = t.parts;
        if (t.trap) v.note = "例外：" + t.trap; else if (t.from) v.note = "来自 " + t.from;
        idByForm[form] = id;
        BY_ID[id] = v;
        ALL_WORDS.push(v);
      }
      t.wid = id;
    }
  }

  const ARTICLE = { m: "der", f: "die", n: "das" };
  const GENDER_DIR = { m: "left", f: "right", n: "up" };
  const STORE_KEY = "wortwahl:v1";

  const ROUND_SIZE = 15;     // cards planned per word round
  const MAX_NEW = 7;         // new words introduced per round
  const MAX_EXTRA = 6;       // gender cards that may be added during a round
  const MAX_RETRIES = 5;     // missed cards that come back later in the same round
  const MIN = 60e3, DAY = 864e5;
  // Leitner boxes: index = box, value = time until the item is due again.
  const INTERVAL = [0, MIN, 10 * MIN, DAY, 3 * DAY, 7 * DAY, 21 * DAY];
  const MASTERED_BOX = 4;
  // Answers slower than this still count as correct but do not move the item up a box.
  const FAST_MS = { meaning: 5000, reverse: 5000, gender: 3500 };
  const SWIPE_PX = 80, HOT_PX = 24;
  const reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ------------------------------------------------------------ progress */
  function blankProgress() {
    return { version: 1, items: {}, rules: {}, flagged: [], settings: { autoplay: true }, stats: { rounds: 0, bestStreak: 0 } };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.version === 1 && p.items && typeof p.items === "object") return normalise(p);
      }
    } catch (e) { /* storage unavailable: start fresh in memory */ }
    return blankProgress();
  }
  function normalise(p) {
    const b = blankProgress();
    return {
      version: 1, items: p.items,
      rules: p.rules && typeof p.rules === "object" ? p.rules : {},
      flagged: Array.isArray(p.flagged) ? p.flagged.filter((k) => BY_ID[k] || RULE_ITEM_BY_AUDIO[k]) : [],
      settings: Object.assign(b.settings, p.settings), stats: Object.assign(b.stats, p.stats),
    };
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(P)); } catch (e) { /* ignore */ } }
  let P = load();
  // Lessons played before rule words joined review only kept the list of guessed words: add those now.
  function backfillReview() {
    const now = Date.now();
    let changed = false;
    for (const [lessonId, rec] of Object.entries(P.rules)) {
      const l = LESSON_BY_ID[lessonId];
      if (!l || l.review === false) continue;
      const guessed = new Set(rec.guessed || []);
      for (const t of l.tests) {
        if (!t.wid || !guessed.has(l.id + ":" + t.de)) continue;
        const key = t.wid + ":" + ruleSkill(t);
        if (!P.items[key]) { P.items[key] = { box: 2, due: now + INTERVAL[2], right: 1, wrong: 0, seen: now }; changed = true; }
      }
    }
    if (changed) save();
  }
  backfillReview();

  function wordStats() {
    const now = Date.now();
    let seen = 0, mastered = 0, due = 0;
    for (const [key, it] of Object.entries(P.items)) {
      const id = key.split(":")[0];
      if (!BY_ID[id]) continue;
      if (key.endsWith(":m") && BASE_IDS.has(id)) { seen++; if (it.box >= MASTERED_BOX) mastered++; }
      if (it.due <= now) due++;
    }
    return { seen, mastered, due, total: WORDS.length };
  }
  // Distinct untaught words the learner has guessed correctly in rule lessons.
  function guessedCount() {
    const all = new Set();
    for (const r of Object.values(P.rules)) for (const k of r.guessed || []) all.add(k);
    return all.size;
  }

  /* ------------------------------------------------------------ display helpers */
  const full = (w) => (w.pos === "noun" ? ARTICLE[w.gender] + " " + w.de : w.de);
  const rfull = (x) => (x.article ? x.article + " " + x.de : x.gender ? ARTICLE[x.gender] + " " + x.de : x.de);
  function genderedHtml(de, gender) {
    if (!gender) return '<span lang="de" class="de">' + esc(de) + "</span>";
    return '<span lang="de" class="de g-' + gender + '"><span class="art">' + ARTICLE[gender] + "</span> " + esc(de) + "</span>";
  }
  const deHtml = (w, withArticle) => genderedHtml(w.de, w.pos === "noun" && withArticle ? w.gender : null);
  // Plural forms carry their own article ("die"), shown uncoloured because plurals have no gender.
  const rdeHtml = (x) => (x.article
    ? '<span lang="de" class="de"><span class="art">' + esc(x.article) + "</span> " + esc(x.de) + "</span>"
    : genderedHtml(x.de, x.gender));
  function pluralHtml(w) {
    if (w.pos !== "noun" || !("plural" in w)) return "";
    return '<p class="plural">复数：' + (w.plural ? '<span lang="de">die ' + esc(w.plural) + "</span>" : "通常不用复数") + "</p>";
  }
  // Compound parts. Meaning lessons give [word, 中文]; gender lessons give [word, m|f|n|pl|v|a].
  function partsHtml(x) {
    const GLOSS = { pl: "复数", v: "动词", a: "形容词" };
    return '<p class="parts">' + x.parts.map(([de, info]) => {
      if (ARTICLE[info]) return genderedHtml(de, info);
      if (GLOSS[info]) return (info === "pl" ? '<span lang="de" class="de"><span class="art">die</span> ' + esc(de) + "</span>" : '<span lang="de" class="de">' + esc(de) + "</span>") +
        '<span class="gloss">（' + GLOSS[info] + "）</span>";
      return '<span lang="de" class="de">' + esc(de) + '</span> <span class="gloss">' + esc(info) + "</span>";
    }).join('<span class="plus">+</span>') + "</p>";
  }
  function pickDistractor(w) {
    const usable = (x) => x.id !== w.id && x.zh !== w.zh && full(x) !== full(w);
    let pool = ALL_WORDS.filter((x) => usable(x) && x.cat === w.cat);
    const samePos = pool.filter((x) => x.pos === w.pos);
    if (samePos.length >= 2) pool = samePos;
    if (pool.length < 2) pool = WORDS.filter((x) => usable(x) && x.pos === w.pos);
    const known = pool.filter((x) => P.items[x.id + ":m"]);
    return pick(known.length && Math.random() < 0.6 ? known : pool);
  }

  /* ------------------------------------------------------------ audio */
  const audio = new Audio();
  audio.preload = "auto";
  // Each voice has its own folder, audio/<voice id>/; items only store the file name.
  const VOICES = DATA.voices && DATA.voices.length ? DATA.voices : [{ id: "", label: "默认" }];
  const currentVoice = () => (VOICES.some((v) => v.id === P.settings.voice) ? P.settings.voice : VOICES[0].id);
  const audioUrl = (file) => "audio/" + (currentVoice() ? currentVoice() + "/" : "") + file;
  function play(file) {
    if (!file) return;
    try {
      audio.pause();
      audio.src = audioUrl(file);
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* no audio support */ }
  }
  // The thing the current card is about: a word (word mode) or a rule item (rule mode).
  const curItem = () => (cur ? cur.w || cur.t : null);
  const speakCur = () => { const x = curItem(); if (x) play(x.audio); };
  const flagKey = () => (cur.w ? cur.w.id : cur.t.audio);

  /* ------------------------------------------------------------ screens */
  function show(id) {
    for (const s of ["home", "play", "summary"]) $(s).hidden = s !== id;
    window.scrollTo(0, 0);
  }
  const stat = (label, value) => '<div class="stat"><b>' + esc(value) + "</b><span>" + esc(label) + "</span></div>";
  function itemRow(audioPath, html, zh, extra) {
    return '<li><button class="play" data-audio="' + esc(audioPath) + '" aria-label="播放">▶</button>' + html +
      '<span class="zh">' + esc(zh) + "</span>" + (extra || "") + "</li>";
  }
  const wordRow = (w, extra) => itemRow(w.audio, deHtml(w, true), w.zh, extra);
  const ruleRow = (x, extra) => itemRow(x.audio, rdeHtml(x), x.zh, extra);

  function renderHome() {
    cur = null;
    const g = guessedCount();
    const totalTests = LESSONS.reduce((n, l) => n + l.tests.length, 0);
    $("hero").innerHTML = '<b>' + g + "</b><span>个从没学过的词，你靠规律猜对了</span>" +
      '<small>' + LESSONS.length + " 课规律，共 " + totalTests + " 个测试词</small>";
    $("lessons").innerHTML = RULES.groups.map((grp) => {
      const items = LESSONS.filter((l) => l.group === grp.id).map((l, i) => {
        const r = P.rules[l.id];
        const status = r ? "最好成绩 " + r.best + " / " + r.total : "未开始";
        return '<button class="lesson' + (r ? " done" : "") + '" data-lesson="' + l.id + '"><span class="ltitle">' +
          esc(l.title) + '</span><span class="lstatus">' + status + "</span></button>";
      }).join("");
      return '<section class="group"><h2>' + esc(grp.title) + '</h2><p class="sub">' + esc(grp.intro) + "</p>" + items + "</section>";
    }).join("");

    const s = wordStats();
    $("stats").innerHTML = stat("已学过", s.seen + " / " + s.total) + stat("已掌握", s.mastered) + stat("待复习", s.due);
    const r = buildRound();
    let note;
    if (!r.cards.length) note = "还没有可练的内容。";
    else if (r.reviews || r.fresh) {
      note = "这一局：" + [r.reviews ? "复习 " + r.reviews + " 张" : "", r.fresh ? "新词 " + r.fresh + " 个" : ""].filter(Boolean).join("，") +
        (r.ahead ? "，另加提前练习 " + r.ahead + " 张" : "") + "。";
    } else note = "现在没有到期的复习，也没有新词了。这一局是提前练习：答对不改变复习安排，答错的词会提前回来。";
    $("startNote").textContent = note;
    $("start").disabled = !r.cards.length;
    $("autoplay").checked = !!P.settings.autoplay;
    $("voice").innerHTML = VOICES.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.label) + "</option>").join("");
    $("voice").value = currentVoice();
    $("howto").open = s.seen === 0 && !Object.keys(P.rules).length;

    const flagged = P.flagged.map((k) => (BY_ID[k] ? wordRow(BY_ID[k], unflagBtn(k)) : RULE_ITEM_BY_AUDIO[k] ? ruleRow(RULE_ITEM_BY_AUDIO[k], unflagBtn(k)) : ""))
      .filter(Boolean);
    $("flagPanel").hidden = !flagged.length;
    $("flagSummary").textContent = "发音待检查（" + flagged.length + "）";
    $("flagList").innerHTML = flagged.join("");
    show("home");
  }
  const unflagBtn = (k) => '<button data-unflag="' + esc(k) + '">取消</button>';

  /* ------------------------------------------------------------ word rounds */
  // Pure: reads progress, returns a planned list of cards without changing anything.
  function buildRound() {
    const now = Date.now();
    const known = Object.keys(P.items).filter((k) => BY_ID[k.split(":")[0]]);
    const due = known.filter((k) => P.items[k].due <= now).sort((a, b) => P.items[a].due - P.items[b].due);
    const reviews = due.slice(0, ROUND_SIZE - 4).map((key) => ({ kind: "quiz", key }));
    const room = ROUND_SIZE - reviews.length;
    const fresh = WORDS.filter((w) => !P.items[w.id + ":m"]).slice(0, Math.min(MAX_NEW, Math.floor(room / 2)));
    let ahead = [];
    const planned = reviews.length + fresh.length * 2;
    if (planned < ROUND_SIZE) {
      const used = new Set(reviews.map((c) => c.key));
      ahead = known.filter((k) => !used.has(k)).sort((a, b) => P.items[a].due - P.items[b].due)
        .slice(0, ROUND_SIZE - planned).map((key) => ({ kind: "quiz", key, ahead: true }));
    }
    // New words: intro 1, intro 2, quiz 1, intro 3, quiz 2, ... so each quiz comes a card or two after its intro.
    const seq = [];
    fresh.forEach((w, i) => {
      seq.push({ kind: "intro", key: w.id + ":m" });
      if (i > 0) seq.push({ kind: "quiz", key: fresh[i - 1].id + ":m" });
    });
    if (fresh.length) seq.push({ kind: "quiz", key: fresh[fresh.length - 1].id + ":m" });
    const others = shuffle(reviews.concat(ahead));
    const cards = [];
    let o = 0;
    seq.forEach((c, i) => { cards.push(c); if (i % 2 === 1 && o < others.length) cards.push(others[o++]); });
    while (o < others.length) cards.push(others[o++]);
    return { cards, reviews: reviews.length, fresh: fresh.length, ahead: ahead.length };
  }

  let S = null;     // round state
  let cur = null;   // current card state
  let autoTimer = 0;

  function startRound() {
    const r = buildRound();
    if (!r.cards.length) return;
    S = { mode: "words", cards: r.cards, index: 0, answered: 0, correct: 0, streak: 0, best: 0, missed: [], fresh: 0, retries: 0, extra: 0 };
    show("play");
    nextCard();
  }

  function startLesson(id) {
    const lesson = LESSON_BY_ID[id];
    if (!lesson) return;
    const tests = shuffle(lesson.tests.slice());
    // Do not open with a trap: the learner should first see the rule work.
    for (let i = 0; i < 2 && tests[0].trap; i++) tests.push(tests.shift());
    const cards = [{ kind: "rule" }].concat(tests.map((t) => ({ kind: "test", t })));
    S = { mode: "rules", lesson, cards, index: 0, answered: 0, correct: 0, streak: 0, best: 0, results: [] };
    show("play");
    nextCard();
  }

  function nextCard() {
    clearTimeout(autoTimer);
    if (S.index >= S.cards.length) return S.mode === "rules" ? finishLesson() : finishRound();
    const card = S.cards[S.index];
    if (S.mode === "rules") setupRuleCard(card); else if (!setupWordCard(card)) { S.index++; return nextCard(); }
    renderCard();
    resetCardPosition(false);
    renderTargets();
    updateTop();
    startTimer();
    // Never auto-play while the audio would give the answer away.
    if (cur.w && (cur.type === "intro" || cur.type === "meaning") && P.settings.autoplay) speakCur();
  }

  function setupWordCard(card) {
    const [id, skill] = card.key.split(":");
    const w = BY_ID[id];
    if (!w) return false;
    let type = "intro";
    if (card.kind === "quiz") {
      const it = P.items[card.key];
      type = skill === "g" ? "gender" : (it && it.box >= 3 && Math.random() < 0.5 ? "reverse" : "meaning");
    }
    cur = { card, w, type, phase: "ask", shownAt: performance.now(), options: {}, correct: null };
    if (type === "meaning" || type === "reverse") {
      const side = Math.random() < 0.5 ? "left" : "right";
      cur.correct = side;
      cur.options[side] = w;
      cur.options[side === "left" ? "right" : "left"] = pickDistractor(w);
    } else if (type === "gender") {
      cur.correct = GENDER_DIR[w.gender];
      cur.options = { left: "der", right: "die", up: "das" };
    }
    return true;
  }

  function setupRuleCard(card) {
    if (card.kind === "rule") {
      cur = { card, t: null, type: "rule", phase: "ask", shownAt: performance.now(), options: {}, correct: null };
      return;
    }
    const t = card.t;
    const type = { cognate: "cognate", compound: "compound", form: "form" }[t.type] || "rgender";
    cur = { card, t, type, phase: "ask", shownAt: performance.now(), options: {}, correct: null };
    if (type === "rgender") {
      cur.correct = GENDER_DIR[t.gender];
      cur.options = { left: "der", right: "die", up: "das" };
    } else {
      const side = Math.random() < 0.5 ? "left" : "right";
      const art = type === "form" && t.article ? t.article + " " : "";
      cur.correct = side;
      cur.options[side] = type === "compound" ? t.zh : art + t.de;
      cur.options[side === "left" ? "right" : "left"] = type === "compound" ? t.wrong : art + t.wrong;
    }
  }

  function grade(ok, fast) {
    const card = cur.card, key = card.key, now = Date.now(), w = cur.w;
    const it = P.items[key] || (P.items[key] = { box: 1, due: now, right: 0, wrong: 0, seen: now });
    if (ok) it.right++; else it.wrong++;
    it.last = now;
    if (card.retry) { if (!ok) it.due = now + INTERVAL[1]; return; }
    if (!ok) { it.box = 1; it.due = now + INTERVAL[1]; return; }
    if (card.ahead) return;
    if (fast) it.box = Math.min(INTERVAL.length - 1, it.box + 1);
    it.due = now + INTERVAL[it.box];
    // Once the meaning of a noun is known, start practising its article.
    if (key.endsWith(":m") && w.pos === "noun" && it.box >= 2 && !P.items[w.id + ":g"]) {
      P.items[w.id + ":g"] = { box: 1, due: now, right: 0, wrong: 0, seen: now };
      if (S.extra < MAX_EXTRA) {
        // Scatter it over the rest of the round, at least two cards from now.
        S.extra++;
        const from = Math.min(S.index + 3, S.cards.length);
        const at = from + Math.floor(Math.random() * (S.cards.length - from + 1));
        S.cards.splice(at, 0, { kind: "quiz", key: w.id + ":g" });
      }
    }
  }

  function answer(dir) {
    const elapsed = performance.now() - cur.shownAt;
    const ok = dir === cur.correct;
    cur.phase = "feedback";
    cur.ok = ok;
    cur.chosen = dir;
    if (S.mode === "rules") {
      cur.slow = false;
      S.results.push({ t: cur.t, ok });
    } else {
      cur.slow = ok && elapsed > FAST_MS[cur.type];
      grade(ok, !cur.slow);
    }
    S.answered++;
    if (ok) { S.correct++; S.streak++; S.best = Math.max(S.best, S.streak); }
    else {
      S.streak = 0;
      if (S.mode === "words") {
        if (!S.missed.includes(cur.w.id)) S.missed.push(cur.w.id);
        if (S.retries < MAX_RETRIES) {
          S.retries++;
          S.cards.splice(Math.min(S.index + 4, S.cards.length), 0, { kind: "quiz", key: cur.card.key, retry: true });
        }
      }
    }
    if (S.mode === "words") save();
    stopTimer();
    renderCard();
    resetCardPosition(true);
    renderTargets();
    updateTop();
    const x = curItem();
    $("live").textContent = (ok ? "答对了。" : "不对。") + (cur.w ? full(cur.w) : rfull(x)) + "，" + x.zh;
    if (P.settings.autoplay) speakCur();
    // Traps carry an explanation worth reading, so they never move on by themselves.
    if (ok && !(cur.t && cur.t.trap)) autoTimer = setTimeout(() => advance(dir), cur.slow ? 1700 : S.mode === "rules" ? 1500 : 1150);
  }

  function introDone(dir) {
    if (!P.items[cur.card.key]) {
      const now = Date.now();
      P.items[cur.card.key] = { box: 1, due: now + INTERVAL[1], right: 0, wrong: 0, seen: now };
      S.fresh++;
      save();
    }
    advance(dir);
  }

  function commit(dir) {
    if (!cur || cur.leaving) return;
    if (cur.phase === "feedback" || cur.type === "rule") return advance(dir);
    if (cur.type === "intro") return introDone(dir);
    if (!cur.options[dir]) return resetCardPosition(true);
    answer(dir);
  }

  function advance(dir) {
    clearTimeout(autoTimer);
    if (!cur || cur.leaving) return;
    cur.leaving = true;
    const c = $("card");
    if (reduceMotion) { S.index++; return nextCard(); }
    const d = dir || "right";
    const dx = d === "left" ? -1 : d === "right" ? 1 : 0, dy = d === "up" ? -1 : 0;
    c.style.transition = "transform .22s ease-in, opacity .22s ease-in";
    c.style.transform = "translate(" + dx * 140 + "%, " + dy * 120 + "%) rotate(" + dx * 18 + "deg)";
    c.style.opacity = "0";
    setTimeout(() => { S.index++; nextCard(); }, 220);
  }

  function finishRound() {
    cur = null;
    P.stats.rounds++;
    P.stats.bestStreak = Math.max(P.stats.bestStreak, S.best);
    save();
    const acc = S.answered ? Math.round((S.correct / S.answered) * 100) : 0;
    $("sumTitle").textContent = "这一局结束了";
    $("again").textContent = "再来一局";
    $("sumStats").innerHTML = stat("答对", S.correct + " / " + S.answered) + stat("准确率", acc + "%") +
      stat("最长连对", S.best) + stat("新学的词", S.fresh);
    $("missed").innerHTML = S.missed.length
      ? '<h3>这一局答错过的词</h3><ul class="words">' + S.missed.map((id) => wordRow(BY_ID[id])).join("") + "</ul>"
      : '<p class="sub">这一局没有答错的词。</p>';
    show("summary");
  }

  function finishLesson() {
    cur = null;
    const l = S.lesson;
    const prev = P.rules[l.id] || { best: 0, total: l.tests.length, plays: 0, guessed: [] };
    const guessed = new Set(prev.guessed);
    for (const r of S.results) if (r.ok) guessed.add(l.id + ":" + r.t.de);
    P.rules[l.id] = { best: Math.max(prev.best, S.correct), total: l.tests.length, plays: prev.plays + 1, guessed: [...guessed], last: Date.now() };
    // Every tested word joins spaced review: guessed ones a step ahead, missed ones due almost at once.
    const now = Date.now();
    let added = 0;
    for (const r of S.results) {
      if (!r.t.wid) continue;
      const key = r.t.wid + ":" + ruleSkill(r.t);
      const it = P.items[key];
      if (!it) {
        const box = r.ok ? 2 : 1;
        P.items[key] = { box, due: now + INTERVAL[box], right: r.ok ? 1 : 0, wrong: r.ok ? 0 : 1, seen: now };
        added++;
      } else if (!r.ok) { it.box = 1; it.due = now + INTERVAL[1]; it.wrong++; }
      else it.right++;
    }
    save();
    const traps = S.results.filter((r) => r.t.trap);
    const trapsOk = traps.filter((r) => r.ok).length;
    $("sumTitle").textContent = l.title;
    $("again").textContent = "再练一遍";
    $("sumStats").innerHTML = stat("猜对", S.correct + " / " + S.answered) + stat("避开陷阱", trapsOk + " / " + traps.length) +
      stat(l.review === false ? "最长连对" : "新加入复习", l.review === false ? S.best : added) + stat("累计猜对的新词", guessedCount());
    const row = (r) => ruleRow(r.t, '<span class="mark ' + (r.ok ? "yes" : "no") + '" aria-label="' + (r.ok ? "猜对" : "猜错") + '">' +
      (r.ok ? "✓" : "✗") + "</span>");
    $("missed").innerHTML = '<h3>这一课的词</h3><ul class="words">' + S.results.map(row).join("") + "</ul>";
    show("summary");
  }

  /* ------------------------------------------------------------ rendering */
  const badge = (t) => '<span class="badge">' + esc(t) + "</span>";
  const replayBtn = () => '<button class="replay" data-act="replay">再听一遍</button>';
  function flagBtn() {
    const on = P.flagged.includes(flagKey());
    return '<button data-act="flag" aria-pressed="' + on + '">' + (on ? "已标记发音问题" : "发音不对？") + "</button>";
  }
  function wordFeedbackHtml() {
    const w = cur.w;
    let h = '<p class="verdict">' + (cur.ok ? (cur.slow ? "答对了，但有点犹豫" : "答对了") : "不对") + "</p>";
    if (!cur.ok) {
      const c = cur.options[cur.chosen];
      if (cur.type === "meaning") h += '<p class="chosen">你选的「' + esc(c.zh) + "」是 <span lang=\"de\">" + esc(full(c)) + "</span> 的意思</p>";
      else if (cur.type === "reverse") h += '<p class="chosen">你选的 <span lang="de">' + esc(full(c)) + "</span> 意思是「" + esc(c.zh) + "」</p>";
      else h += '<p class="chosen">你选的是 <span lang="de">' + esc(c) + "</span></p>";
    }
    if (w.en) h += '<p class="sub">英语 <span lang="en">' + esc(w.en) + "</span> →</p>";
    h += '<div class="big">' + deHtml(w, true) + "</div>" + pluralHtml(w);
    if (w.parts) h += partsHtml(w);
    h += '<p class="zh">' + esc(w.zh) + "</p>";
    if (w.note) h += '<p class="note">' + esc(w.note) + "</p>";
    h += '<div class="fbrow">' + replayBtn() + flagBtn() + "</div>";
    if (!cur.ok) h += '<button class="primary" data-act="next">继续</button>';
    return h;
  }
  function ruleFeedbackHtml() {
    const t = cur.t;
    let verdict = cur.ok ? (t.trap ? "答对了，你避开了陷阱" : "猜对了") : (t.trap ? "掉进陷阱了" : "猜错了");
    let h = '<p class="verdict">' + verdict + "</p>";
    if (!cur.ok && cur.type !== "rgender") h += '<p class="chosen">你选的是「' + esc(cur.options[cur.chosen]) + "」</p>";
    if (!cur.ok && cur.type === "rgender") h += '<p class="chosen">你选的是 <span lang="de">' + esc(cur.options[cur.chosen]) + "</span></p>";
    if (t.en) h += '<p class="sub">英语 <span lang="en">' + esc(t.en) + "</span> →</p>";
    if (t.q) h += '<p class="sub">' + esc(t.label || "") + ' <span lang="de">' + esc(t.q) + "</span> →</p>";
    h += '<div class="big">' + rdeHtml(t) + "</div>";
    if (t.parts) h += partsHtml(t);
    h += '<p class="zh">' + esc(t.zh) + "</p>";
    if (t.from) h += '<p class="sub">来自 <span lang="de">' + esc(t.from) + "</span></p>";
    if (t.trap) h += '<p class="note"><b>这是个例外：</b>' + esc(t.trap) + "</p>";
    h += '<div class="fbrow">' + replayBtn() + flagBtn() + "</div>";
    if (!cur.ok || t.trap) h += '<button class="primary" data-act="next">继续</button>';
    return h;
  }
  function exampleHtml(x) {
    let h = '<li><button class="play" data-audio="' + esc(x.audio) + '" aria-label="播放 ' + esc(rfull(x)) + '">▶</button><div class="ex">';
    if (x.en) h += '<span lang="en" class="en">' + esc(x.en) + '</span><span class="arrow">→</span>';
    if (x.q) h += '<span lang="de" class="en">' + esc(x.q) + '</span><span class="arrow">→</span>';
    h += rdeHtml(x) + '<span class="exzh">' + esc(x.zh) + "</span>";
    if (x.parts) h += partsHtml(x);
    if (x.from) h += '<span class="gloss">来自 <span lang="de">' + esc(x.from) + "</span></span>";
    return h + "</div></li>";
  }
  function ruleCardHtml() {
    const l = S.lesson;
    return badge(GROUP_TITLE[l.group] || "规律") + '<h2 class="rtitle">' + esc(l.title) + '</h2><p class="explain">' + esc(l.explain) +
      '</p><ul class="examples">' + l.examples.map(exampleHtml).join("") + "</ul>" +
      '<p class="sub">接下来的 ' + l.tests.length + " 个词你都没学过，用这条规律去猜。小心例外。</p>" +
      '<button class="primary" data-act="next">开始猜词</button>';
  }
  function ruleAskHtml() {
    const t = cur.t;
    const tag = badge("没学过的词");
    if (cur.type === "cognate") {
      return tag + '<p class="sub">英语</p><div class="big" lang="en">' + esc(t.en) + '</div><p class="zh small">' + esc(t.zh) +
        '</p><p class="ask">德语是哪一个？</p>';
    }
    if (cur.type === "compound") {
      return tag + '<div class="big">' + genderedHtml(t.de, null) + "</div>" + partsHtml(t) + '<p class="ask">猜猜整个词是什么意思？</p>';
    }
    if (cur.type === "form") {
      return tag + '<p class="sub">' + esc(t.label || "") + '</p><div class="big" lang="de">' + esc(t.q) + '</div><p class="zh small">' +
        esc(t.zh) + '</p><p class="ask">' + esc(S.lesson.ask || "哪一个是对的？") + "</p>";
    }
    return tag + '<div class="big">' + genderedHtml(t.de, null) + "</div>" + (t.parts ? partsHtml(t) : "") +
      '<p class="zh small">' + esc(t.zh) + '</p><p class="ask">der、die 还是 das？</p>';
  }
  function renderCard() {
    const { type, phase } = cur;
    const c = $("card");
    c.className = "card" + (phase === "feedback" ? (cur.ok ? " ok" : " bad") : "") + (type === "rule" ? " scrolly" : "");
    let h;
    if (type === "rule") h = ruleCardHtml();
    else if (cur.t) h = phase === "feedback" ? ruleFeedbackHtml() : ruleAskHtml();
    else {
      const w = cur.w, cat = CATS[w.cat] || "";
      if (phase === "feedback") h = wordFeedbackHtml();
      else if (type === "intro") {
        h = badge("新词 · " + cat) + '<div class="big">' + deHtml(w, true) + "</div>" + pluralHtml(w) +
          '<p class="zh">' + esc(w.zh) + "</p>" + (w.note ? '<p class="note">' + esc(w.note) + "</p>" : "") +
          '<div class="fbrow">' + replayBtn() + flagBtn() + "</div>";
      } else if (type === "meaning") {
        h = badge(cat) + '<div class="big">' + deHtml(w, true) + "</div>" + replayBtn() + '<p class="ask">这是什么意思？</p>';
      } else if (type === "reverse") {
        h = badge(cat) + '<div class="big zhbig">' + esc(w.zh) + '</div><p class="ask">德语怎么说？</p>';
      } else {
        h = badge("词性") + '<div class="big">' + deHtml(w, false) + '</div><p class="zh small">' + esc(w.zh) +
          '</p><p class="ask">der、die 还是 das？</p>';
      }
    }
    c.innerHTML = h;
    c.scrollTop = 0;
  }
  function targetLabel(dir) {
    const o = cur.options[dir];
    const arrow = { left: "← ", right: "", up: "↑ " }[dir], tail = dir === "right" ? " →" : "";
    if (cur.type === "meaning") return arrow + esc(o.zh) + tail;
    if (cur.type === "reverse") return '<span lang="de">' + arrow + esc(full(o)) + tail + "</span>";
    if (cur.type === "cognate" || cur.type === "form") return '<span lang="de">' + arrow + esc(o) + tail + "</span>";
    if (cur.type === "compound") return arrow + esc(o) + tail;
    const g = { der: "m", die: "f", das: "n" }[o];
    return '<span lang="de" class="g-' + g + '">' + arrow + o + tail + "</span>";
  }
  function renderTargets() {
    const asking = cur.phase === "ask" && cur.type !== "intro" && cur.type !== "rule";
    for (const [dir, id] of [["left", "tLeft"], ["right", "tRight"], ["up", "tUp"]]) {
      const el = $(id);
      const on = asking && !!cur.options[dir];
      el.classList.toggle("off", !on);
      el.classList.remove("hot");
      el.disabled = !on;
      el.innerHTML = on ? targetLabel(dir) : "&nbsp;";
    }
    // The up target only exists for gender questions; drop its row otherwise so the card gets the space.
    $("tUp").hidden = !(asking && cur.options.up);
    document.querySelector(".stage").classList.toggle("free", !asking);
    let hint = "";
    if (cur.phase === "feedback") hint = cur.ok && !(cur.t && cur.t.trap) ? "" : "看清楚正确答案，然后划走或点「继续」";
    else if (cur.type === "rule") hint = "看完规律和例子，点「开始猜词」或把卡片划走";
    else if (cur.type === "intro") hint = "听一听、记一记，然后向任意方向划走";
    else if (cur.options.up) hint = "左划 der · 右划 die · 上划 das";
    else hint = "把卡片划向正确的一边";
    $("hint").textContent = hint;
  }
  function updateTop() {
    const pct = Math.round((S.index / S.cards.length) * 100);
    $("progressFill").style.width = pct + "%";
    document.querySelector(".progress").setAttribute("aria-valuenow", pct);
    $("streak").textContent = S.streak >= 2 ? "连对 " + S.streak : "";
  }
  function startTimer() {
    const f = $("timerFill");
    f.classList.remove("late");
    f.style.transition = "none";
    f.style.width = "100%";
    // Rule questions are about reasoning, not speed, so they get no timer.
    const timed = S.mode === "words" && cur.type !== "intro";
    $("timer").style.visibility = timed ? "" : "hidden";
    clearTimeout(startTimer.t);
    if (!timed) return;
    void f.offsetWidth;
    f.style.transition = "width " + FAST_MS[cur.type] + "ms linear";
    f.style.width = "0%";
    startTimer.t = setTimeout(() => { if (cur && cur.phase === "ask") f.classList.add("late"); }, FAST_MS[cur.type]);
  }
  function stopTimer() {
    const f = $("timerFill");
    const width = getComputedStyle(f).width;
    f.style.transition = "none";
    f.style.width = width;
    clearTimeout(startTimer.t);
  }

  /* ------------------------------------------------------------ dragging */
  const cardEl = $("card");
  let drag = null;
  function resetCardPosition(animated) {
    cardEl.style.transition = animated ? "" : "none";
    cardEl.style.transform = "";
    cardEl.style.opacity = "";
    if (!animated) { void cardEl.offsetWidth; cardEl.style.transition = ""; }
  }
  function dirOf(dx, dy, limit) {
    const up = cur && (cur.phase !== "ask" || cur.type === "intro" || cur.type === "rule" || cur.options.up);
    if (up && -dy > limit && -dy > Math.abs(dx)) return "up";
    if (dx > limit) return "right";
    if (dx < -limit) return "left";
    return null;
  }
  function highlight(dir) {
    for (const [d, id] of [["left", "tLeft"], ["right", "tRight"], ["up", "tUp"]]) $(id).classList.toggle("hot", d === dir);
  }
  cardEl.addEventListener("pointerdown", (e) => {
    if (!cur || cur.leaving || e.target.closest("button")) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, dx: 0, dy: 0 };
    try { cardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    cardEl.style.transition = "none";
  });
  cardEl.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    if (Math.hypot(drag.dx, drag.dy) > 6) drag.moved = true;
    cardEl.style.transform = "translate(" + drag.dx + "px, " + drag.dy + "px) rotate(" + drag.dx / 18 + "deg)";
    if (cur.phase === "ask") highlight(dirOf(drag.dx, drag.dy, HOT_PX));
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    highlight(null);
    cardEl.style.transition = "";
    if (cancelled) return resetCardPosition(true);
    if (!d.moved) { resetCardPosition(true); return tapCard(); }
    const dir = dirOf(d.dx, d.dy, SWIPE_PX);
    if (dir) commit(dir); else resetCardPosition(true);
  }
  cardEl.addEventListener("pointerup", (e) => endDrag(e, false));
  cardEl.addEventListener("pointercancel", (e) => endDrag(e, true));

  // Replaying is only allowed when the audio cannot reveal the answer.
  function canReplay() { return cur && (cur.phase === "feedback" || cur.type === "intro" || cur.type === "meaning"); }
  function tapCard() { if (canReplay()) { clearTimeout(autoTimer); speakCur(); } }

  /* ------------------------------------------------------------ events */
  cardEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b || !cur) return;
    const act = b.dataset.act;
    if (act === "replay") { clearTimeout(autoTimer); speakCur(); if (cur.phase === "feedback" && cur.ok) showContinue(); }
    else if (act === "flag") {
      clearTimeout(autoTimer);
      const k = flagKey();
      P.flagged = P.flagged.includes(k) ? P.flagged.filter((x) => x !== k) : P.flagged.concat(k);
      save();
      b.outerHTML = flagBtn();
      if (cur.phase === "feedback" && cur.ok) showContinue();
    } else if (act === "next") advance(cur.chosen);
  });
  // After the learner interacts with a correct-answer card, stop auto-advancing and let them move on.
  function showContinue() {
    if (cardEl.querySelector('[data-act="next"]')) return;
    cardEl.insertAdjacentHTML("beforeend", '<button class="primary" data-act="next">继续</button>');
  }
  for (const id of ["tLeft", "tRight", "tUp"]) $(id).addEventListener("click", (e) => commit(e.currentTarget.dataset.dir));

  document.addEventListener("keydown", (e) => {
    if ($("play").hidden || !cur) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up" }[e.key];
    if (dir) { e.preventDefault(); commit(dir); return; }
    if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    if (e.key === " ") { e.preventDefault(); tapCard(); }
    else if (e.key === "Enter" && (cur.phase === "feedback" || cur.type === "rule")) { e.preventDefault(); advance(cur.chosen); }
  });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-audio]");
    if (a) { play(a.dataset.audio); return; }
    const u = e.target.closest("[data-unflag]");
    if (u) { P.flagged = P.flagged.filter((x) => x !== u.dataset.unflag); save(); renderHome(); return; }
    const l = e.target.closest("[data-lesson]");
    if (l) startLesson(l.dataset.lesson);
  });

  $("start").addEventListener("click", startRound);
  $("again").addEventListener("click", () => {
    if (S && S.mode === "rules") return startLesson(S.lesson.id);
    if (buildRound().cards.length) startRound(); else renderHome();
  });
  $("toHome").addEventListener("click", renderHome);
  $("quit").addEventListener("click", () => { clearTimeout(autoTimer); audio.pause(); renderHome(); });
  $("autoplay").addEventListener("change", (e) => { P.settings.autoplay = e.target.checked; save(); });
  const SAMPLE = WORDS.find((w) => w.id === "tisch") || WORDS[0];
  $("voice").addEventListener("change", (e) => { P.settings.voice = e.target.value; save(); play(SAMPLE.audio); });
  $("voiceTry").addEventListener("click", () => play(SAMPLE.audio));

  const ioMsg = (t) => { $("ioMsg").textContent = t; };
  $("export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(P, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "wortwahl-progress-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ioMsg("已导出进度文件。");
  });
  $("import").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      if (!p || p.version !== 1 || !p.items || typeof p.items !== "object") throw new Error("format");
      P = normalise(p);
      backfillReview();
      save();
      renderHome();
      ioMsg("已导入进度。");
    } catch (err) { ioMsg("导入失败：这不是 Wortwahl 的进度文件。"); }
  });
  $("reset").addEventListener("click", () => {
    if (!confirm("确定清空全部学习进度吗？这一步不能撤销。")) return;
    P = blankProgress();
    save();
    renderHome();
    ioMsg("进度已清空。");
  });

  renderHome();
})();
