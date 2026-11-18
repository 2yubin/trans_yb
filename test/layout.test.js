// 문단 알아내기 시험. 실행: node test/layout.test.js
const assert = require("assert");
const Core = require("../addon/content/trans_yb.js");
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("ok -", name); };

// 줄 하나 = 조각 하나(필요하면 여러 개). x: 왼쪽, y: 위쪽, 줄 높이 12, 줄 간격 14
let y = 100;
const P = [];
const line = (x, text, opt = {}) => {
  const h = opt.h || 12;
  if (opt.gap) y += opt.gap;
  const w = opt.w ?? Math.min(text.length * 6, 470);
  P.push({ raw: text, x, y, w, h });
  y += h + 2;
};
// 제목(큰 글씨)
line(60, "Week 3: Family Ideals: Care and Paid Work at Home", { h: 14, w: 420 });
// 본문 문단 1 (들여쓰기 없음, 마지막 줄 짧음, 줄 끝 하이픈)
line(70, "Care is where family ideals meet the daily routine. This unit pairs mother-", { w: 470 });
line(70, "hood and fatherhood on purpose, because rising expectations have reshaped them", { w: 470 });
line(70, "both. Compare the two national cases (Rowe 1996).", { w: 300 });
// 글머리표 참고문헌 (내어쓰기)
line(60, "•", { w: 6, gap: 6 }); P[P.length - 1].y = y - 14; // 글머리표와 글이 같은 줄
P.push({ raw: "Rowe, Ellen. 1996. The Quiet Work of Raising Children. Northfield University Press.", x: 76, y: y - 14, w: 460, h: 12 });
line(76, "(Chapter 2)", { w: 60 });
line(60, "•", { w: 6 }); P[P.length - 1].y = y - 14;
P.push({ raw: "Dunn, Mara, and Owen Pike. 2004. \"Small Towns and Big Plans.\"", x: 76, y: y - 14, w: 460, h: 12 });
line(76, "Journal of Family Life 77(4): 645–672.", { w: 230 });
// 본문 문단 2 (첫 줄 들여쓰기)
line(90, "Transnational families separate the household without dissolving it. Attend to", { gap: 8, w: 450 });
line(70, "what crosses borders, e.g. money and care.", { w: 220 });
line(300, "5", { gap: 20, w: 6 }); // 쪽 번호

const L = Core.buildLayout(P);
const paraTexts = L.paras.map((p) => [p.kind, L.text.slice(p.start, p.end)]);

t("문단을 6개로 나눠요(제목, 본문, 참고문헌 2개, 본문, 쪽 번호)", () => {
  assert.deepStrictEqual(paraTexts.map((x) => x[0]), ["heading", "body", "ref", "ref", "body", "other"]);
});
t("참고문헌 한 항목은 줄이 바뀌어도 한 덩어리예요", () => {
  assert.ok(paraTexts[2][1].endsWith("Northfield University Press. (Chapter 2)"), paraTexts[2][1]);
  assert.ok(paraTexts[3][1].includes("Plans.\" Journal of Family Life 77(4): 645–672."), paraTexts[3][1]);
});
t("줄 끝 하이픈은 번역에 보낼 때 지워요", () => {
  const units = Core.makeUnits(L.text, L.paras);
  const src = units.map((u) => Core.unitSource(L.text, u, L.soft));
  assert.ok(src.some((s) => s.includes("This unit pairs motherhood and fatherhood")), JSON.stringify(src));
});
t("본문은 문장으로, 참고문헌과 제목은 통째로 하나의 번역 단위예요", () => {
  const units = Core.makeUnits(L.text, L.paras);
  const kinds = units.map((u) => u.kind + ":" + u.para);
  assert.deepStrictEqual(kinds, [
    "heading:0", "body:1", "body:1", "body:1", "ref:2", "ref:3", "body:4", "body:4", "other:5",
  ]);
  const last = units.filter((u) => u.para === 4).map((u) => L.text.slice(u.start, u.end));
  assert.deepStrictEqual(last, [
    "Transnational families separate the household without dissolving it.",
    "Attend to what crosses borders, e.g. money and care.",
  ]);
});
t("조각 위치(ranges)는 원래 조각 글자를 가리켜요", () => {
  P.forEach((p, i) => {
    const r = L.ranges[i];
    if (!r) return;
    const norm = p.raw.replace(/\s+/g, " ").trim();
    assert.strictEqual(L.text.slice(r.start, r.end), norm);
  });
});
t("한 단어가 두 조각으로 나뉘어 붙어 있으면 띄어 쓰지 않아요", () => {
  const L2 = Core.buildLayout([
    { raw: "intima", x: 10, y: 10, w: 36, h: 12 },
    { raw: "cy is", x: 46, y: 10, w: 30, h: 12 },
    { raw: "social.", x: 82, y: 10, w: 40, h: 12 },
  ]);
  assert.strictEqual(L2.text, "intimacy is social.");
});
t("글머리표 없는 내어쓰기 참고문헌도 항목별로 한 덩어리예요", () => {
  const Q = [];
  let yy = 10;
  const ln = (x, raw, w = 470) => { Q.push({ raw, x, y: yy, w, h: 12 }); yy += 14; };
  ln(60, "References", 70);
  ln(60, "Hale, Anna. 1992. The Shape of Closeness: Friendship, Trust and Care in");
  ln(78, "Modern Cities. Northfield: Northfield University Press.", 380);
  ln(60, "Moss, Ruth. 1998. Close Ties: Everyday Relationships in Small Towns Today.");
  ln(78, "Cambridge: Polity Press.", 140);
  ln(60, "Lund, Peter. 2007. Private Days. Lakeside: Harbor.", 300);
  const L3 = Core.buildLayout(Q);
  const got = L3.paras.map((p) => p.kind + ": " + L3.text.slice(p.start, p.end));
  assert.deepStrictEqual(got, [
    "heading: References",
    "ref: Hale, Anna. 1992. The Shape of Closeness: Friendship, Trust and Care in Modern Cities. Northfield: Northfield University Press.",
    "ref: Moss, Ruth. 1998. Close Ties: Everyday Relationships in Small Towns Today. Cambridge: Polity Press.",
    "ref: Lund, Peter. 2007. Private Days. Lakeside: Harbor.",
  ]);
});

t("첫 줄 들여쓰기 문단이 이어져도 문단별로 나눠요", () => {
  const Q = [];
  let yy = 10;
  const ln = (x, raw, w = 470) => { Q.push({ raw, x, y: yy, w, h: 12 }); yy += 14; };
  ln(80, "Intimacy has changed. Couples now negotiate");
  ln(60, "roles openly.", 80);
  ln(80, "Kinship, however, persists. Families still");
  ln(60, "matter.", 50);
  const L4 = Core.buildLayout(Q);
  assert.deepStrictEqual(L4.paras.map((p) => L4.text.slice(p.start, p.end)), [
    "Intimacy has changed. Couples now negotiate roles openly.",
    "Kinship, however, persists. Families still matter.",
  ]);
});

t("두 줄짜리 큰 제목, 콜론 제목, 머리말, 큰 첫 글자를 알아봐요", () => {
  const Q = [];
  // 머리말: 맨 위 작은 글씨
  Q.push({ raw: "Language and Mobility Projects: Parents' Planning of Foreign Language Study in Coastal Towns", x: 60, y: 10, w: 400, h: 8 });
  // 두 줄 큰 제목
  Q.push({ raw: "Language and Mobility Projects: Parents'", x: 60, y: 50, w: 380, h: 18 });
  Q.push({ raw: "Planning of Foreign Language Study in Coastal Towns", x: 60, y: 72, w: 420, h: 18 });
  // 콜론으로 끝나는 짧은 소제목
  Q.push({ raw: "Methods and data:", x: 60, y: 110, w: 120, h: 12 });
  // 큰 첫 글자로 시작하는 본문
  Q.push({ raw: "E", x: 60, y: 135, w: 18, h: 30 });
  Q.push({ raw: "nglish has long served as a status marker in many towns: namely, skill", x: 79, y: 135, w: 400, h: 12 });
  Q.push({ raw: "in and ease with English have been a sign of opportunity for many.", x: 79, y: 149, w: 400, h: 12 });
  Q.push({ raw: "This paper considers the place of English in such towns today and", x: 60, y: 163, w: 420, h: 12 });
  Q.push({ raw: "beyond.", x: 60, y: 177, w: 40, h: 12 });
  const L5 = Core.buildLayout(Q);
  const got = L5.paras.map((p) => p.kind + ": " + L5.text.slice(p.start, p.end));
  assert.deepStrictEqual(got, [
    "other: Language and Mobility Projects: Parents' Planning of Foreign Language Study in Coastal Towns",
    "heading: Language and Mobility Projects: Parents' Planning of Foreign Language Study in Coastal Towns",
    "heading: Methods and data:",
    "body: English has long served as a status marker in many towns: namely, skill in and ease with English have been a sign of opportunity for many. This paper considers the place of English in such towns today and beyond.",
  ]);
});

t("저자 이름 머리말은 빼고, 기울임꼴과 발음 기호 단어에서 문장을 끊지 않고, 이어진 첫 줄은 제목이 아니에요", () => {
  const Q = [];
  Q.push({ raw: "LENA ORTIZ & JONAS BERG", x: 60, y: 10, w: 200, h: 12 });
  // 앞 페이지에서 이어진 문장(소문자로 시작), 기울임꼴/발음 기호 조각은 높이가 조금 달라요
  Q.push({ raw: "tutoring (", x: 60, y: 40, w: 50, h: 12 });
  Q.push({ raw: "kwaoe", x: 110, y: 39.5, w: 30, h: 13.4 });
  Q.push({ raw: "), language-focused cram schools (", x: 140, y: 40, w: 180, h: 12 });
  Q.push({ raw: "yŏngŏ chŏnmun", x: 320, y: 39, w: 90, h: 13.8 });
  Q.push({ raw: "hagwŏn", x: 60, y: 54, w: 40, h: 13.8 });
  Q.push({ raw: "), and online classes. We look at parents because they are the main", x: 100, y: 55, w: 380, h: 12 });
  Q.push({ raw: "planners of children's schooling.", x: 60, y: 69, w: 200, h: 12 });
  const L6 = Core.buildLayout(Q);
  const got = L6.paras.map((p) => p.kind + ": " + L6.text.slice(p.start, p.end));
  assert.deepStrictEqual(got, [
    "other: LENA ORTIZ & JONAS BERG",
    "body: tutoring (kwaoe), language-focused cram schools (yŏngŏ chŏnmun hagwŏn), and online classes. We look at parents because they are the main planners of children's schooling.",
  ]);
});

t("굵은 글꼴 소제목은 본문과 나누고, 짧은 저자·소속 줄은 줄마다 나누고, 참고문헌의 기울임꼴 줄은 이어요", () => {
  const Q = [];
  const L = (x, y, raw, w, font, h = 10) => Q.push({ raw, x, y, w, h, font });
  // 본문 마지막 줄
  L(48, 10, "shared rooms; being seen in the neighborhood; and the slow turn of seasons.", 320, "f3");
  // 굵은 글꼴 두 줄 소제목(간격이 아주 조금만 벌어짐)
  L(48, 30, "3.1 Sources of fatherhood- social class: 'it would be easier if I", 286, "f4");
  L(48, 42, "was a carpenter'", 65, "f4");
  L(48, 58, "To be placed at home as the main carer without first having succeeded", 335, "f3");
  L(48, 70, "at paid work signals that something is out of step.", 250, "f3");
  // 저자와 소속(소문자로 잘못 읽힌 첫 글자 포함)
  L(48, 100, "Dana Holt", 57, "f3", 11);
  L(48, 113, "i", 4, "f3", 11); L(52, 113, "nternational Lakeside University, Canada", 180, "f3", 11);
  L(48, 126, "Mira Sato", 55, "f3", 11);
  L(48, 139, "University of Westfield Harbor, UK", 180, "f3", 11);
  // 참고문헌: 둘째 줄 학술지 이름이 기울임꼴
  L(48, 170, "• Moreau, Claire. 2006. \"'Kitchen-Table Worlds': Fathers at Home Again.\"", 330, "f3");
  L(60, 182, "The Family Studies Review 54(4): 696–716.", 200, "f5");
  const R = Core.buildLayout(Q);
  const got = R.paras.map((p) => p.kind + ": " + R.text.slice(p.start, p.end));
  assert.deepStrictEqual(got, [
    "body: shared rooms; being seen in the neighborhood; and the slow turn of seasons.",
    "heading: 3.1 Sources of fatherhood- social class: 'it would be easier if I was a carpenter'",
    "body: To be placed at home as the main carer without first having succeeded at paid work signals that something is out of step.",
    "heading: Dana Holt",
    "body: international Lakeside University, Canada", // PDF가 첫 글자를 소문자로 기록함. 표시는 Claude의 bylines 판단을 따라요
    "heading: Mira Sato",
    "heading: University of Westfield Harbor, UK",
    "ref: • Moreau, Claire. 2006. \"'Kitchen-Table Worlds': Fathers at Home Again.\" The Family Studies Review 54(4): 696–716.",
  ]);
});

t("저작권 줄은 제목과 떼어 빼고, 콜론으로 끝나는 큰 제목은 줄 사이가 넓어도 한 덩어리예요", () => {
  const Q = [];
  Q.push({ raw: "© 2015 by The Author(s)", x: 54, y: 400, w: 110, h: 9, font: "f3" }); // 실제 PDF처럼 페이지 아래쪽
  Q.push({ raw: "Raising Quiet sons:", x: 206, y: 96, w: 172, h: 16, font: "f2" });
  Q.push({ raw: "Everyday american fatherhood and south Korea's Parent school", x: 54, y: 132, w: 324, h: 16, font: "f2" });
  Q.push({ raw: "How do fathers far from home take up new ideas of care? We examine this question here.", x: 54, y: 180, w: 324, h: 9, font: "f3" });
  Q.push({ raw: "The study draws on interviews in two towns and shows how men adapt to it.", x: 54, y: 191, w: 300, h: 9, font: "f3" });
  const R = Core.buildLayout(Q);
  const got = R.paras.map((p) => p.kind + ": " + R.text.slice(p.start, p.end));
  assert.ok(got.includes("other: © 2015 by The Author(s)"), JSON.stringify(got));
  assert.ok(got.includes("heading: Raising Quiet sons: Everyday american fatherhood and south Korea's Parent school"), JSON.stringify(got));
});

t("첫 쪽: 맨 위 제목이 두 단을 가로질러도 아래는 두 단으로 읽고, 단을 넘어가는 문장은 이어요", () => {
  const Q = [];
  Q.push({ raw: "A Long Paper Title That Runs Across Both Columns", x: 50, y: 20, w: 450, h: 17, font: "f3" });
  Q.push({ raw: "Some Author, Some Book: A Subtitle That Also Runs Across. Northfield: Press.", x: 50, y: 45, w: 440, h: 12, font: "f3" });
  const lw = 238;
  const left = [
    "Abstract This paper asks a question that matters a", "great deal to many readers. Its account of several",
    "young people and their troubles has raised new", "questions about how researchers write about others.",
    "It would be nice to write a review of this book on", "its own terms. But that is no longer possible. The",
    "book has been caught up in many debates. Its claims", "were widely praised in the press, but some readers",
    "were far less impressed. Such debates are not new.", "One famous study, for example, was condemned for",
    "failing to obtain consent from the",
  ];
  const right = [
    "men he studied, and for not protecting them well.", "The debate split apart a department at the time.",
    "Another classic study is widely seen as a model of", "fieldwork and a foundation of the method itself.",
    "Decades later, a critic published a review of it.", "She said the author had made things up in places.",
    "Recent cases have raised similar questions about", "memory, reliability, and honesty in the field.",
    "Each of these cases drew wide public attention.", "Each also left lasting marks on how people work.",
    "The present book now joins this long, odd list.",
  ];
  left.forEach((r, i) => Q.push({ raw: r, x: 50, y: 90 + i * 12.5, w: lw, h: 10, font: "f1" }));
  right.forEach((r, i) => Q.push({ raw: r, x: 306, y: 90 + i * 12.5, w: lw, h: 10, font: "f1" }));
  const R = Core.buildLayout(Q);
  const got = R.paras.map((p) => p.kind + ": " + R.text.slice(p.start, p.end));
  assert.strictEqual(got[0], "heading: A Long Paper Title That Runs Across Both Columns");
  // 문단 첫 줄을 소제목으로 끊지 않아요
  assert.ok(got.some((g) => g.startsWith("body: Abstract This paper asks a question that matters a great deal")), JSON.stringify(got));
  // 왼쪽 단 끝 "consent from the" 와 오른쪽 단 첫 줄 "men he studied" 가 한 문단이에요
  assert.ok(got.some((g) => g.includes("consent from the men he studied")), JSON.stringify(got));
});

console.log(`\n${pass}개 시험 모두 통과`);
