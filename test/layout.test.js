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

t("큰 글씨 제목이 네 줄로 나뉘어도(연결어로 끝나지 않아도) 한 제목이에요", () => {
  const Q = [];
  const T = (y, raw, w) => Q.push({ raw, x: 48, y, w, h: 16, font: "B" });
  T(64, "Updating “The Future of", 186);
  T(83, "Coding”: Qualitative", 154);
  T(102, "Coding with Generative", 178);
  T(121, "Large Language Models", 170);
  Q.push({ raw: "Nga Than, Leanne Fan, Tina Law", x: 48, y: 160, w: 180, h: 11, font: "R" });
  for (let i = 0; i < 12; i++) Q.push({ raw: "Body text line that runs across the whole column of the page here " + i, x: 48, y: 200 + i * 12, w: 340, h: 9.5, font: "R" });
  const R = Core.buildLayout(Q);
  const got = R.paras.map((p) => p.kind + ": " + R.text.slice(p.start, p.end));
  assert.strictEqual(got[0], "heading: Updating “The Future of Coding”: Qualitative Coding with Generative Large Language Models", JSON.stringify(got));
  assert.ok(got[1].includes("Nga Than"), JSON.stringify(got));
});

t("PDF 안 저장 순서가 뒤섞여도(본문이 먼저, 제목이 나중) 위치대로 읽어요", () => {
  const Q = [];
  // 저장 순서: 아래쪽 왼쪽 단 본문 -> 아래쪽 오른쪽 단 소속 -> 맨 위 제목 -> 초록
  const body = ["Despite decades of reforms to remove gendered", "policies and practices from the workplace, and", "despite the fact that women now outperform", "men in higher education, women remain under-", "represented in leadership positions in both", "industry and academia. Substantial research has"];
  body.forEach((r, i) => Q.push({ raw: r, x: 51, y: 549 + i * 12, w: 190, h: 10, font: "R" }));
  ["aUniversity of British Columbia", "bUniversity of Southern California", "cIndiana University Bloomington", "dMass General Brigham Hospital"].forEach((r, i) => Q.push({ raw: r, x: 252, y: 549 + i * 10, w: 120, h: 6, font: "R" }));
  ["Taking the Time: The", "Implications of Workplace", "Assessment for Organizational", "Gender Inequality"].forEach((r, i) => Q.push({ raw: r, x: 51, y: 90 + i * 20, w: 240, h: 18, font: "B" }));
  Q.push({ raw: "Abstract", x: 51, y: 273, w: 40, h: 10, font: "B" });
  for (let i = 0; i < 8; i++) Q.push({ raw: "Gendered differences in workload distribution shape who does tasks " + i + ".", x: 51, y: 287 + i * 11, w: 384, h: 9, font: "R" });
  const R = Core.buildLayout(Q);
  const got = R.paras.map((p) => R.text.slice(p.start, p.end));
  const at = (s) => got.findIndex((g) => g.includes(s));
  assert.ok(at("Taking the Time") === 0, JSON.stringify(got));
  assert.ok(got[0].includes("Gender Inequality"), JSON.stringify(got));
  assert.ok(at("Abstract") < at("Gendered differences") && at("Gendered differences") < at("Despite decades"), JSON.stringify(got));
  assert.ok(at("Despite decades") < at("aUniversity"), JSON.stringify(got));
  // 본문 문단은 소속 줄과 섞이지 않고 한 덩어리예요
  assert.ok(got[at("Despite decades")].includes("Substantial research has") && !got[at("Despite decades")].includes("University"), JSON.stringify(got));
});

t("표·그림 제목을 찾고, 표를 가리키는 본문 문장은 빼요", () => {
  const text = ["Table 1. Precision, Recall, and F1 Score", "Figure 3 shows the differences in means.", "figure 2. Regression Plot of Five Measures", "<표 1> 조사 항목의 기본 구성", "<표 6>에서 볼 수 있는 바와 같이", "그림 3. IRB 심의에 대한 대응"].join("\n");
  let pos = 0;
  const paras = text.split("\n").map((t) => { const p = { start: pos, end: pos + t.length, kind: "body" }; pos += t.length + 1; return p; });
  const got = Core.figureCaptions(text, paras).map((f) => f.kind + ":" + f.label);
  assert.deepStrictEqual(got, ["table:Table 1", "figure:Figure 2", "table:표 1", "figure:그림 3"]);
});

t("표 칸 글자는 번역 목록에서 빼요(제목이 위에 있는 표, 아래에 붙은 표)", () => {
  const mk = (rows) => {
    let text = "";
    const paras = rows.map(([kind, fh, t]) => { if (text) text += "\n"; const p = { start: text.length, end: text.length + t.length, kind, fh }; text += t; return p; });
    return { text, paras };
  };
  // 영어: 제목 -> 머리줄 -> 칸 -> Source -> 본문
  const A = mk([
    ["body", 10, "Women attendings wrote longer comments than men attendings in every hospital we studied, as Table 2 shows."],
    ["heading", 9, "Table 2. Descriptive Statistics Aggregated by Attending and Resident Gender"],
    ["heading", 9, "Mean Median Min. Max. Std.Dev. Count"],
    ["body", 8, "Word Count 1,393 425 4 23,305 3044 85 Medical Terms Count 101 28 0 1,902 235 85"],
    ["body", 8, "Source: Comments collected using InstantEval."],
    ["body", 10, "The longer comment provides more opportunity for learning and improvement, for both the resident and the attending."],
  ]);
  const PA = Core.markFigureParas(A.text, A.paras, 10);
  assert.deepStrictEqual(PA.map((p) => p.cell || p.kind), ["body", "heading", "Table 2", "Table 2", "body", "body"]);
  // 한국어: 표 마지막 줄에 제목이 붙어 있고, 제목 뒤에는 인용문이 와요
  const B = mk([
    ["body", 10, "교육 내용이 지나치게 기초적이었다는 데 대한 동의 정도가 높게 나타났다. 반면 다른 문항은 낮았다."],
    ["body", 8, "문항 전혀 동의안함 다소 동의안함 그저 그렇다 다소 동의함 매우 동의함 평균"],
    ["body", 8, "(13) 16.4% (25) 40.8% (62) 29.6% (45) 4.6% (7) 3.05"],
    ["body", 8, "(4) 15.8% (24) 27.0% (41) 36.2% (55) 18.4% (28) 3.52 <표 3> IRB 연구윤리 교육 관련 5점 척도 문항 (N=152)"],
    ["body", 9.4, "강사분이 사실은 심리학 쪽이었던 것 같아요. 그러다 보니까 실험 설계 위주로 되게 많이 말씀을 하시는 바람에, 저 같은 경우는 (3A)"],
  ]);
  const PB = Core.markFigureParas(B.text, B.paras, 10);
  const got = PB.map((p) => (p.cell ? "칸 " : p.kind + " ") + B.text.slice(p.start, p.end).slice(0, 12));
  assert.deepStrictEqual(got, ["body 교육 내용이 지나치게 ", "칸 문항 전혀 동의안함 다", "칸 (13) 16.4% (", "칸 (4) 15.8% (2", "body <표 3> IRB 연구", "body 강사분이 사실은 심리학"]);
});

t("본문과 같은 크기 글씨의 표도 칸이 세로로 줄을 맞추면 칸으로 알아봐요", () => {
  const Q = [];
  const P = (x, y, raw, w) => Q.push({ raw, x, y, w, h: 10, font: "R" });
  let y = 60;
  for (let i = 0; i < 6; i++) { P(60, y, "Before the table we discuss how respondents answered the survey items in detail " + i + ".", 420); y += 13; }
  y += 14;
  P(60, y, "Table 5. Responses by Group", 160); y += 20;
  const rows = [["Group", "Mean", "SD", "N"], ["Women attendings", "1,393", "3044", "85"], ["Men attendings", "1,169", "2160", "158"], ["Women residents", "462", "512", "222"], ["Men residents", "466", "452", "430"]];
  for (const r of rows) { P(60, y, r[0], 100); P(220, y, r[1], 30); P(300, y, r[2], 30); P(380, y, r[3], 25); y += 14; }
  y += 14;
  for (let i = 0; i < 6; i++) { P(60, y, "After the table the argument continues with a longer discussion of what these numbers mean " + i + ".", 420); y += 13; }
  const L = Core.buildLayout(Q);
  const PB = Core.markFigureParas(L.text, L.paras, 10);
  const cells = PB.filter((p) => p.cell === "Table 5").map((p) => L.text.slice(p.start, p.end));
  assert.ok(cells.length >= 4 && cells.some((c) => c.includes("Men residents")), JSON.stringify(cells));
  assert.ok(!cells.some((c) => /Before the table|After the table/.test(c)), JSON.stringify(cells));
  // 표 줄이 아닌 본문 문단에는 표 표시가 없어요
  assert.ok(!L.paras.some((p) => p.tab && /Before the table|After the table/.test(L.text.slice(p.start, p.end))));
});

t("문단 나누기가 바뀌어도 옛 번역을 문장별로 옮겨 써요(나뉜 제목은 이어 붙여요)", () => {
  // 옛 저장본: 제목이 세 줄로 나뉘어 번역돼 있었고, 문장별 원문은 저장되지 않았어요.
  const oldText = ["Updating The Future of Coding: Qualitative", "Coding with Generative", "Large Language Models", "Over the past decade, social scientists have adapted computational methods for qualitative text analysis since 2015. The emergence of GPT has transformed this process by shifting from programming to natural language in 2022."].join("\n");
  const oldLines = ["「코딩의 미래」 다시 보기: 생성형", "대규모 언어 모델을 활용한", "질적 코딩", "지난 10여 년간(2015년 이후) 사회과학자들은 계산 방법을 질적 텍스트 분석에 맞게 활용해 왔다.", "GPT의 등장은 2022년에 이 과정을 바꾸었다."];
  const g = Core.guessUnits(oldText, oldLines.length);
  assert.ok(g && Core.numbersAgree(g, oldLines), JSON.stringify(g));
  const newSrcs = ["Updating The Future of Coding: Qualitative Coding with Generative Large Language Models", "Over the past decade, social scientists have adapted computational methods for qualitative text analysis since 2015.", "The emergence of GPT has transformed this process by shifting from programming to natural language in 2022."];
  const m = Core.mapSaved(g, oldLines, newSrcs);
  assert.strictEqual(m.lines[0], "「코딩의 미래」 다시 보기: 생성형 대규모 언어 모델을 활용한 질적 코딩");
  assert.strictEqual(m.lines[2], "GPT의 등장은 2022년에 이 과정을 바꾸었다.");
  // 짝이 밀리면(숫자가 안 맞으면) 옮기지 않아요
  assert.ok(!Core.numbersAgree(["In 1990 we saw 45 cases.", "By 2001 there were 67.", "The 1985 law changed 12 rules.", "Since 1999, 88 more."], ["2001년에는 67건이었다.", "1985년 법은 12개 규칙을 바꿨다.", "1999년 이후 88건.", "1990년에 45건."]));
});

t("본문 크기의 기울임 소제목이 연결어로 끝나 두 줄로 나뉘면 한 소제목으로 읽어요", () => {
  // Nelson 외(2023) 645쪽: "Substantive Significance for" / "Attendings" (같은 기울임 글꼴, 본문과 같은 크기)
  const Q = [];
  let y = 100;
  const P = (x, text, w, font) => { Q.push({ raw: text, x, y, w, h: 12.5, font }); y += 12.5; };
  const R = "Melior-Roman", I = "Melior-Italic";
  for (let i = 0; i < 6; i++) P(51, "The body text of the results section keeps going with numbers and comparisons " + i, 240, R);
  P(51, "(and median) woman, compared to 7 (2) for the mean man.", 200, R);
  y += 10;
  P(51, "Substantive Significance for ", 150, I);
  P(51, "Attendings", 55, I);
  y += 4;
  for (let i = 0; i < 5; i++) P(51, "The difference in the amount and specificity of feedback is large for attendings " + i, 240, R);
  P(51, "and it matters for promotion.", 120, R);
  // 두 줄이 같은 글꼴이어도, 연결어로 끝나지 않는 소제목은 따로예요
  y += 10;
  P(51, "Data", 30, I);
  P(51, "Measures", 50, I);
  y += 4;
  for (let i = 0; i < 5; i++) P(51, "We measure feedback with a set of coded variables drawn from the evaluation forms " + i, 240, R);
  const L = Core.buildLayout(Q);
  const heads = L.paras.filter((p) => p.kind === "heading").map((p) => L.text.slice(p.start, p.end).trim());
  assert.ok(heads.includes("Substantive Significance for Attendings"), JSON.stringify(heads));
  assert.ok(heads.includes("Data") && heads.includes("Measures"), JSON.stringify(heads));
});

t("따로 떨어진 악센트 글자(caf|é)가 줄 뒤쪽 순서로 저장돼도 제자리에 끼워 문단을 끊지 않아요", () => {
  // Hamilton(2017) 2쪽: "high caf" "density " 다음에 "é"(다른 글꼴, 조금 위)가 저장돼 있어요.
  const Q = [];
  let y = 100;
  const R = "SandSm";
  const P = (x, text, w) => Q.push({ raw: text, x, y, w, h: 10.9, font: R });
  for (let i = 0; i < 4; i++) { P(62, "Today, the cafe lives on unperturbed by the relative views of those " + i, 200); y += 13.9; }
  P(62.6, "long in a country where high caf", 156.8);
  P(231.4, "density ", 32.7);
  Q.push({ raw: "é", x: 219.6, y: y - 0.6, w: 5.7, h: 10.6, font: "Haansoft Batang" });
  y += 13.9;
  P(62.7, "makes competition fierce, and where homosex- ", 201.4); y += 13.9;
  P(62.7, "uality is considered weird. This research aims to fill this void.", 180); y += 13.9;
  const L = Core.buildLayout(Q);
  const body = L.paras.filter((p) => p.kind === "body").map((p) => L.text.slice(p.start, p.end));
  assert.strictEqual(body.length, 1, JSON.stringify(body));
  assert.ok(body[0].includes("high café density makes competition fierce"), body[0]);
});

t("본문 첫 줄에 인용 연도가 있어도 참고문헌으로 보지 않고, 짧은 마지막 줄 다음 들여 쓴 줄에서 새 문단을 시작해요", () => {
  // Roseneil·Budgeon(2004) 6쪽: "...(Beck-" / "Gernsheim, 1999)." 다음 줄 "While this body..." 가 들여 써 있어요.
  const Q = [];
  let y = 149;
  const P = (x, text, w) => { Q.push({ raw: text, x, y, w, h: 10.7, font: "Times" }); y += 11.95; };
  P(148.6, "of \u2018great, and generalizable, importance\u2019 (Giddens, 1992: 2). He charts", 322.8);
  for (let i = 0; i < 6; i++) P(148.6, "changes in the nature of marriage such as the emergence of the pure relation " + i, 322.8);
  P(148.6, "same family, we are moving into a world of the \u2018post-familial family\u2019 (Beck-", 322.8);
  P(148.6, "Gernsheim, 1999).", 78.1);
  P(166.5, "While this body of work perhaps overstates the degree of change, and", 304.9);
  for (let i = 0; i < 4; i++) P(148.6, "underplays the continuance of gender inequalities and class differences in " + i, 322.8);
  const L = Core.buildLayout(Q);
  const body = L.paras.filter((p) => p.kind === "body").map((p) => L.text.slice(p.start, p.end));
  assert.strictEqual(body.length, 2, JSON.stringify(body));
  assert.ok(body[0].endsWith("(Beck-Gernsheim, 1999)."), body[0]);
  assert.ok(body[1].startsWith("While this body of work"), body[1]);
});

console.log(`\n${pass}개 시험 모두 통과`);
