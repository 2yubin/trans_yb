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

console.log(`\n${pass}개 시험 모두 통과`);
