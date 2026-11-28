// 조테로 없이 문장 나누기와 위치 계산을 시험해요.  실행: node test/core.test.js
const assert = require("assert");
const Core = require("../addon/content/trans_yb.js");

let pass = 0;
function t(name, fn) {
  fn();
  pass++;
  console.log("ok -", name);
}

// PDF에서는 한 줄이 여러 조각(span)으로 나뉘어 들어와요.
const pieces = [
  "Closeness has been studied by researchers (Hale et al.",
  "1992; Moss, 1998). It is",
  "often linked to self-disclo-",
  "sure, e.g. in couples. J. Smith argued otherwise.",
  "   ",
  "La intimidad cambia. Intimitet er bl.a. en relation.",
];

const page = Core.buildPageText(pieces);
const sents = Core.splitSentences(page.text);
const texts = sents.map((s) => page.text.slice(s.start, s.end));

t("빈 조각은 건너뛰어요", () => {
  assert.strictEqual(page.ranges[4], null);
});

t("줄 끝 하이픈은 띄어 쓰지 않아요", () => {
  assert.ok(page.text.includes("self-disclo-sure"));
});

t("et al., e.g., 이름 첫 글자, bl.a. 에서 문장을 자르지 않아요", () => {
  assert.deepStrictEqual(texts, [
    "Closeness has been studied by researchers (Hale et al. 1992; Moss, 1998).",
    "It is often linked to self-disclo-sure, e.g. in couples.",
    "J. Smith argued otherwise.",
    "La intimidad cambia.",
    "Intimitet er bl.a. en relation.",
  ]);
});

t("글자 위치로 문장을 찾아요", () => {
  const off = page.text.indexOf("Smith");
  assert.strictEqual(Core.sentenceAt(sents, off), 2);
});

t("두 줄에 걸친 문장은 두 조각 모두에 표시해요", () => {
  const parts = Core.piecesForSentence(page.ranges, sents[1]);
  assert.deepStrictEqual(parts.map((p) => p.piece), [1, 2, 3]);
  // 1번 조각에서는 "It is" 부분만
  assert.strictEqual(pieces[1].slice(parts[0].from, parts[0].to), "It is");
  // 3번 조각에서는 "sure, e.g. in couples." 부분만
  assert.strictEqual(pieces[3].slice(parts[2].from, parts[2].to), "sure, e.g. in couples.");
});

t("원래 조각의 공백이 여러 개여도 위치가 맞아요", () => {
  const p = Core.buildPageText(["  Hello    world.  Next one."]);
  const ss = Core.splitSentences(p.text);
  const parts = Core.piecesForSentence(p.ranges, ss[1]);
  assert.strictEqual("  Hello    world.  Next one.".slice(parts[0].from, parts[0].to), "Next one.");
});

t("번역 묶음은 글자 수 한도를 지켜요", () => {
  const chunks = Core.chunk(["a".repeat(500), "b".repeat(500), "c".repeat(500)], 1200);
  assert.strictEqual(chunks.length, 2);
});

t("색 코드와 정사각형 위치가 서로 바뀌어요", () => {
  for (const hex of ["#6b4423", "#1f3a5f", "#555555", "#000000", "#ffffff", "#ff0000"]) {
    const c = Core.hexToHsv(hex);
    const back = Core.hsvToHex(c.h, c.s, c.v);
    // 반올림 때문에 각 색 성분이 2 이내로만 달라도 같은 색으로 봐요
    const diff = [1, 3, 5].map((i) => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)));
    assert.ok(Math.max(...diff) <= 2, hex + " -> " + back);
  }
  assert.strictEqual(Core.hexToHsv("#abc").hex, "#aabbcc");
  assert.strictEqual(Core.hexToHsv("zzz"), null);
});

t("각주 번호만 골라내고, 연도와 쪽수는 건드리지 않아요", () => {
  const src = 'The market.4 It cost $3,333 million).5 (Ford and Rae 1998:27; Lim 2000).6 the "7.30 Plan" of y6ng6 kyoyuk (ydng5) and Min\'s Father7 in 1997 and the 1990s.';
  assert.deepStrictEqual([...Core.footnoteNumbers(src)], ["4", "5", "6", "7"]);
  const ko = '시장에 참여하고 있었다.4 약 3,333만 달러).5 (Ford and Rae 1998:27; Lim 2000).6 "7.30 계획" 민이 아빠7 1997년 G7 회의';
  const spans = Core.footnoteSpans(ko, Core.footnoteNumbers(src));
  assert.deepStrictEqual(spans.map(([a, b]) => ko.slice(a, b)), ["4", "5", "6", "7"]);
});

t("논문 끝 미주와 페이지 아래 각주의 내용을 찾아요", () => {
  const body = (t) => ({ text: t, h: 10, y: 0 });
  const small = (t) => ({ text: t, h: 7, y: 0 });
  const pages = [
    // 1쪽: 본문 + 페이지 아래 작은 글씨 각주
    [body("Body text with a note.1 More text here."), body("Another body line."), body("Third body line."), small("1 This is a page footnote that"), small("continues on the next line.")],
    // 끝쪽: 미주 (글자 인식 오류 포함: SAccording = 5, 121n = 12)
    [body("LENA ORTIZ"), body("ENDNOTES"), small("4First endnote text that is long and"), small("wraps over two lines."), small("SAccording to a report, numbers."), small("9Ninth note."), small("10Tenth note."), small("121n Spring Days, a film."), small("672")],
  ];
  const notes = Core.parseNotes(pages);
  assert.strictEqual(notes.get("4"), "First endnote text that is long and wraps over two lines.");
  assert.strictEqual(notes.get("5"), "According to a report, numbers.");
  assert.strictEqual(notes.get("10"), "Tenth note.");
  assert.strictEqual(notes.get("12"), "In Spring Days, a film.");
  assert.strictEqual(notes.get("1"), "This is a page footnote that continues on the next line.");
});

t("대문자 H가 소문자로 깨진 PDF도 문장을 나눠요", () => {
  const raw = "This is the New Parent (Baker 2008; hollis-Lane and Tate 1994). household care takes shape (hale 2003). however, it is fluid, e.g. parents who live apart.";
  const fixed = Core.repairBrokenCaps(raw);
  assert.strictEqual(fixed.length, raw.length);
  assert.ok(fixed.includes("(Baker 2008; Hollis-Lane") && fixed.includes(". Household") && fixed.includes("(Hale 2003)") && fixed.includes(". However,"));
  assert.ok(fixed.includes("e.g. parents"));
  assert.strictEqual(Core.splitSentences(fixed).length, 3);
  // 보통 글(줄임말 뒤 소문자)은 그대로
  const ok = "We use surveys, e.g. polls. and so on? et al. found it.";
  assert.strictEqual(Core.repairBrokenCaps(ok), ok);
});

t("옆으로 눕혀 스캔한 페이지(90도)를 바로 세우고 다시 PDF 좌표로 되돌려요", () => {
  const items = [];
  for (let k = 0; k < 10; k++) items.push({ str: "word" + k, t: [0, 10, -10, 0, 300, 100 + k * 40], w: 30, h: 10 });
  const u = Core.uprightItems(items, [0, 0, 728, 1031]);
  assert.deepStrictEqual(u.view, [0, 0, 1031, 728]);
  assert.deepStrictEqual(u.items[0].t.slice(0, 4), [10, 0, 0, 10]);
  // 글자가 왼쪽에서 오른쪽으로 놓여요
  assert.ok(u.items[1].t[4] > u.items[0].t[4]);
  const back = Core.mapRect(u.toPdf, [u.items[0].t[4], u.items[0].t[5], u.items[0].t[4] + 1, u.items[0].t[5] + 1]);
  assert.ok(Math.abs(back[0] - 299) < 1.01 && Math.abs(back[1] - 100) < 1.01);
  // 보통 페이지는 그대로
  assert.strictEqual(Core.uprightItems([{ str: "abc", t: [10, 0, 0, 10, 5, 5], w: 9, h: 10 }], [0, 0, 612, 792]).up, null);
});

t("펼친 책 두 쪽(왼쪽·오른쪽)을 따로 읽어요", () => {
  const P = [];
  for (let r = 0; r < 12; r++) {
    P.push({ raw: "left line number " + r + " of the page goes on here", x: 50, y: 100 + r * 14, w: 250, h: 11 });
    P.push({ raw: "right line number " + r + " of the page goes on here", x: 400, y: 100 + r * 14, w: 250, h: 11 });
  }
  const L = Core.buildLayout(P);
  const li = L.text.indexOf("left line number 11");
  const ri = L.text.indexOf("right line number 0");
  assert.ok(li >= 0 && ri > li, "왼쪽 쪽을 다 읽고 오른쪽 쪽을 읽어요");
  assert.ok(L.ranges.every((r) => r));
});

t("OCR이 쉼표를 마침표로 읽은 곳은 대문자로 고치지 않아 문장이 토막 나지 않아요", () => {
  // Callon(1984) 198쪽: 같은 글에 ". The", ". He"가 멀쩡히 있으니 ". their", ". or"는 깨진 글꼴이 아니에요.
  const raw = "Others turn to existing social forces. The sociologist tends to censor selectively the actors when they speak of themselves. their allies. their adversaries. or social backgrounds. He allows them to speak only of Nature. The few rare texts differ. or worse. they are used against them.";
  const fixed = Core.repairBrokenCaps(raw);
  assert.strictEqual(fixed, raw);
  const s = Core.splitSentences(fixed).map((p) => fixed.slice(p.start, p.end));
  assert.ok(s[1].endsWith("or social backgrounds."), JSON.stringify(s));
});

t("그림 속 화살표를 OCR이 글자로 읽은 키 큰 조각은 문단을 잇지 않아요", () => {
  // Callon(1984) 217쪽 그림 5: 화살표가 높이 50~85의 "j", "!", "1"로 읽혀 그림 전체를 덮는 문단이 생겼어요.
  const P = [];
  const add = (x, y, raw, w, h = 11) => P.push({ raw, x, y, w, h, font: "Helvetica" });
  add(166, 55, "Fishermen of", 50); add(166, 64, "St Brieuc Bay", 45);
  add(185, 75, "1", 12, 52); // 화살표
  add(166, 130, "Election", 30);
  add(185, 142, "1", 12, 50);
  add(166, 195, "Counting of votes", 60);
  for (let i = 0; i < 8; i++) add(55, 420 + i * 12, "Body text of the paper continues here with a long line of words " + i, 285, 13.9);
  const L = Core.buildLayout(P);
  const texts = L.paras.map((p) => L.text.slice(p.start, p.end));
  assert.ok(!texts.some((t) => /Bay.*Election|Election.*Counting/.test(t)), JSON.stringify(texts));
});

t("다음 단 맨 위에 쪽 번호·머리말이 있어도 앞 단에서 넘어온 문장을 이어요", () => {
  // Callon(1986) 펼친 책: 왼쪽 쪽 끝 "This is because they are" → 오른쪽 쪽 머리말 "The Sociology of an Actor-Network 21" → "continuously rebuilding ..."
  const P = [];
  const line = (x, y, text, w = 300) => P.push({ raw: text, x, y, w, h: 11, font: "Times" });
  let y = 60;
  for (let i = 0; i < 12; i++) { line(142, y, "Sociologists often believe that as a profession they can answer this question " + i); y += 12; }
  line(142, y, "However, scientists and technologists constantly undermine the"); y += 12;
  line(142, y, "knowledge of the sociologists. This is because they are");
  line(570, 39, "The Sociology of an Actor-Network 21", 230);
  y = 62;
  line(496, y, "continuously rebuilding society by introducing unpredictable variations"); y += 12;
  for (let i = 0; i < 12; i++) { line(496, y, "and new associations which the actors keep drawing into their world " + i + "."); y += 12; }
  const L = Core.buildLayout(P);
  const s = Core.makeUnits(L.text, L.paras.filter((p) => p.kind !== "other")).map((u) => Core.unitSource(L.text, u, L.soft));
  assert.ok(s.some((x) => /This is because they are continuously rebuilding society/.test(x)), JSON.stringify(s.slice(10, 16)));
});

t("들여쓰기로 새 문단을 알아봐요(꽉 찬 마지막 줄, OCR이 마침표를 쉼표로 읽은 줄, 여백 손글씨 표시). 참고문헌 내어쓰기는 그대로예요", () => {
  // Callon(1986) 22쪽 왼쪽: "…his own place."(꽉 찬 줄) / "-- Up to this point"(여백 표시 + 들여쓰기),
  // "(catalysts, electrons, etc.),"(짧은 줄, 마침표가 쉼표로) / "But just a moment"(들여쓰기)
  const P = [];
  const line = (x, y, text, w) => P.push({ raw: text, x, y, w, h: 10.5, font: "Noto" });
  let y = 60;
  const full = (t) => { line(141, y, t, 302); y += 12; };
  for (let i = 0; i < 4; i++) full("The EDF has defined the roles and then attempts to enrol other entities " + i);
  full("roles together by building a world where everyone has his own place.");
  line(132, y, "--", 6); line(151, y, "Up to this point, the entities are ones familiar to the sociologist.", 292); y += 12;
  for (let i = 0; i < 3; i++) full("There are consumers, social movements and ministries which we must list " + i);
  line(141, y, "(catalysts, electrons, etc.),", 112); y += 12;
  line(151, y, "But just a moment. EDF is not an actor that is faced with new and", 292); y += 12;
  for (let i = 0; i < 3; i++) full("unfamiliar technologies or knowledge located throughout the society " + i);
  // 참고문헌(내어쓰기): 둘째 줄이 들여 써 있고 대문자로 시작해도 같은 항목이에요
  y += 20;
  for (let i = 0; i < 4; i++) {
    line(141, y, "Armijo, Priscila Rodrigues, Julie K. Silver, Allison R.", 302); y += 12;
    line(151, y, "Larson, and Sash Shillcutt. 2021. Citation Gap. Journal " + i + ".", 292); y += 12;
  }
  const L = Core.buildLayout(P);
  const paras = L.paras.map((p) => L.text.slice(p.start, p.end));
  assert.ok(paras.some((t) => /^-* *Up to this point/.test(t)), JSON.stringify(paras.map((t) => t.slice(0, 30))));
  assert.ok(paras.some((t) => /^But just a moment/.test(t)), JSON.stringify(paras.map((t) => t.slice(0, 30))));
  assert.ok(paras.some((t) => /Allison R\. Larson, and Sash/.test(t)), "참고문헌 항목이 나뉘면 안 돼요");
});

t("들여쓰기로 문단을 나누는 책에서 다음 쪽 첫 줄이 들여 써 있지 않으면 앞 문단을 이어요(쪽 배율이 달라도)", () => {
  // Callon(1986) 22→23쪽: "…car manufacturer." / (머리말) / "Indeed, it will never regain that status." (오른쪽 쪽이 25% 크게 스캔됨)
  const P = [];
  const line = (x, y, text, w, h) => P.push({ raw: text, x, y, w, h, font: "Noto" });
  let y = 60;
  const para = (x0, n, h, first) => {
    line(x0 + h, y, first, 290, h); y += h * 1.15;
    for (let i = 0; i < n; i++) { line(x0, y, "the body text continues with ordinary words and more words " + i, 300, h); y += h * 1.15; }
    line(x0, y, "and it ends here.", 80, h); y += h * 1.15;
  };
  para(141, 4, 10.1, "Up to this point the entities are ones familiar to everyone here.");
  para(141, 4, 10.1, "But just a moment, EDF is not an actor that is faced with things.");
  line(151, y, "The actor-world not only determines the repertoire of entities.", 290, 10.1); y += 11.6;
  line(141, y, "company that seeks to be the largest European car manufacturer.", 300, 10.1);
  // (머리말을 건너뛰는 경우는 위 시험에서 따로 봐요)
  y = 60;
  line(492, y, "Indeed, it will never regain that status. Rather, it is reduced.", 300, 13); y += 15;
  line(492, y, "new demands.", 60, 13); y += 15;
  para(492, 4, 13, "The notion of the actor-world makes it possible to describe this.");
  para(492, 4, 13, "In the absence of one ingredient the whole would break down here.");
  const L = Core.buildLayout(P);
  const paras = L.paras.map((p) => L.text.slice(p.start, p.end));
  assert.ok(paras.some((t) => /car manufacturer\. Indeed, it will never regain/.test(t)), JSON.stringify(paras.map((t) => t.slice(-40))));
});

console.log(`\n${pass}개 시험 모두 통과`);
