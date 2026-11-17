/* trans_yb 0.1.0
 *
 * 하는 일
 *  1. 조테로 PDF 화면 오른쪽 사이드바에 "trans_yb" 칸을 만들어요.
 *  2. 지금 보는 페이지의 글자를 문장으로 나눠 번역하고, 문장 짝 목록을 보여 줘요.
 *  3. 목록의 문장에 커서를 대면 PDF의 원문 문장이 노랗게 칠해져요.
 *  4. PDF의 영어(또는 다른 언어) 문장에 커서를 대면 목록의 번역 문장이 강조돼요.
 *
 * 구조
 *  - TransYbCore: 조테로와 상관없는 순수 계산(문장 나누기, 위치 계산). node로 시험할 수 있어요.
 *  - TransYb: 조테로 화면과 연결하는 부분.
 */

/* ------------------------------------------------------------------ */
/* 1. 순수 계산 부분                                                    */
/* ------------------------------------------------------------------ */
var TransYbCore = {
  // 문장 끝 마침표가 아니라 줄임말인 경우. 영어, 덴마크어, 스페인어를 같이 넣었어요.
  ABBREVIATIONS: [
    "et al", "e.g", "i.e", "cf", "vs", "etc", "fig", "figs", "eq", "eqs",
    "pp", "p", "vol", "vols", "ch", "chap", "sec", "eds", "dr", "mr", "mrs", "ms",
    "prof", "st", "jr", "sr", "ca", "approx", "resp", "inc", "ltd", "u.s",
    // 덴마크어
    "bl.a", "f.eks", "dvs", "jf", "mv", "osv", "nr", "pga", "evt", "hhv",
    // 스페인어
    "p. ej", "pág", "págs", "núm", "sra", "srta", "ud", "uds", "cap", "aprox", "ej",
  ],

  // 공백을 하나로 줄이고 앞뒤 공백을 지운 글자와, 줄인 글자 위치 -> 원래 위치 표를 만들어요.
  normalizeWithMap(raw) {
    const out = [];
    const map = [];
    let pendingSpace = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) {
        if (out.length) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        out.push(" ");
        map.push(i - 1);
        pendingSpace = false;
      }
      out.push(ch);
      map.push(i);
    }
    map.push(raw.length); // 끝 위치
    return { text: out.join(""), map };
  },

  // PDF 한 페이지의 글자 조각(span)들을 이어 붙여 한 줄 글자로 만들고,
  // 조각마다 [시작, 끝] 위치를 기록해요.
  buildPageText(rawPieces) {
    let text = "";
    const ranges = [];
    for (const raw of rawPieces) {
      const { text: t, map } = TransYbCore.normalizeWithMap(raw);
      if (!t) {
        ranges.push(null);
        continue;
      }
      // 줄 끝 하이픈(trans-)이면 다음 조각과 띄어 쓰지 않아요.
      if (text && !text.endsWith("-")) text += " ";
      const start = text.length;
      text += t;
      ranges.push({ start, end: text.length, map });
    }
    return { text, ranges };
  },

  _endsWithAbbreviation(segment) {
    const s = segment.trim().toLowerCase();
    if (/(^|[\s(])[A-ZÀ-Þ]\.$/.test(segment.trim())) {
      return true; // 이름 첫 글자(J. Smith)
    }
    for (const a of TransYbCore.ABBREVIATIONS) {
      if (s.endsWith(" " + a + ".") || s.endsWith("(" + a + ".") || s === a + ".") return true;
    }
    return false;
  },

  // 글자를 문장 단위로 나눠 [{start, end}] 목록을 돌려줘요.
  splitSentences(text) {
    let pieces = [];
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: "sentence" });
      for (const s of seg.segment(text)) {
        pieces.push({ start: s.index, end: s.index + s.segment.length });
      }
    } else {
      const re = /[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g;
      let m;
      while ((m = re.exec(text)) && m[0]) {
        pieces.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    // 앞뒤 공백을 빼고 빈 조각은 버려요.
    pieces = pieces
      .map(({ start, end }) => {
        while (start < end && /\s/.test(text[start])) start++;
        while (end > start && /\s/.test(text[end - 1])) end--;
        return { start, end };
      })
      .filter((p) => p.end > p.start);

    // 줄임말 뒤에서 잘렸거나, 다음 조각이 소문자로 시작하면 다시 붙여요.
    const merged = [];
    for (const p of pieces) {
      const prev = merged[merged.length - 1];
      if (prev) {
        const prevText = text.slice(prev.start, prev.end);
        const nextFirst = text[p.start];
        const startsLower = /[a-zà-ÿ]/.test(nextFirst || "");
        const numAbbr = /\b(no|nos|vol|vols|pp|p|fig|figs|eq|ch|sec|art|nr|núm|pág|s)\.\s*$/i.test(prevText) && /^\d/.test(nextFirst || "");
        if (TransYbCore._endsWithAbbreviation(prevText) || startsLower || numAbbr) {
          prev.end = p.end;
          continue;
        }
      }
      merged.push({ ...p });
    }
    return merged;
  },

  /* ---------- 문단 알아내기 ----------
   * PDF 글자 조각마다 위치(x, y = 위쪽, w, h)가 있어요. 이걸로
   *  1) 같은 줄끼리 묶고 (조각 사이가 붙어 있으면 띄어 쓰지 않아요)
   *  2) 줄 사이 간격, 들여쓰기, 짧은 마지막 줄, 글머리표(•), 글자 크기 변화로 문단을 나눠요.
   *  3) 줄 끝 하이픈(self-disclo- / sure)은 번역에 보낼 때 지워요.
   * 결과: text(페이지 전체 글자), ranges(조각별 위치), soft(지울 하이픈 위치), paras(문단 목록)
   */
  REF_HEADING: /^(references|bibliography|works cited|literature|required readings|recommended readings|readings|참고\s*문헌|litteratur(liste)?|referencer|referencias|bibliograf[ií]a)\b/i,
  BULLET: /^([•◦▪●‣∙·–—-]|\(?\d{1,2}[.)])\s/,
  // 저작권, DOI, 내려받기 안내처럼 번역할 필요 없는 줄
  BOILER_LINE: /^(©|\(c\)\s*\d{4}|copyright\b|doi\s*:|https?:\/\/doi\.org|issn\b|e-?issn\b|downloaded from\b|this content downloaded)/i,

  /**
   * 한 장에 두 단(또는 펼친 책 두 쪽)이 나란히 있으면, 가운데의 빈 세로 띠를 찾아 왼쪽·오른쪽으로 나눠요.
   * 띠를 가로지르는 조각이 하나라도 있으면(가로 전체 제목 등) 나누지 않아요. 나눌 수 없으면 null.
   */
  splitColumns(pieces) {
    const ps = pieces.map((p, i) => ({ ...p, i })).filter((p) => String(p.raw).trim() && p.w > 0);
    if (ps.length < 20) return null;
    const minX = Math.min(...ps.map((p) => p.x));
    const maxX = Math.max(...ps.map((p) => p.x + p.w));
    const span = maxX - minX;
    const hs = ps.map((p) => p.h || 10).sort((a, b) => a - b);
    const H = hs[Math.floor(hs.length / 2)];
    const N = Math.ceil(span);
    const cover = new Uint8Array(N + 1);
    for (const p of ps) for (let x = Math.floor(p.x - minX); x < Math.ceil(p.x + p.w - minX) && x <= N; x++) cover[x] = 1;
    // 가운데(30%~70%)에서 가장 넓은 빈 띠
    let best = null;
    let runStart = -1;
    for (let x = Math.floor(N * 0.3); x <= Math.ceil(N * 0.7) + 1; x++) {
      const empty = x <= N && !cover[x];
      if (empty && runStart < 0) runStart = x;
      if (!empty && runStart >= 0) {
        if (!best || x - runStart > best.w) best = { at: runStart, w: x - runStart };
        runStart = -1;
      }
    }
    if (!best || best.w < H * 1.2) return null;
    const cut = minX + best.at + best.w / 2;
    const left = ps.filter((p) => p.x + p.w / 2 < cut);
    const right = ps.filter((p) => p.x + p.w / 2 >= cut);
    const chars = (a) => a.reduce((n, p) => n + String(p.raw).length, 0);
    const lineCount = (a) => new Set(a.map((p) => Math.round(p.y / H))).size;
    // 양쪽 모두 글줄이 여러 개 있어야 진짜 두 단이에요
    if (lineCount(left) < 4 || lineCount(right) < 4) return null;
    if (Math.min(chars(left), chars(right)) < chars(ps) * 0.1) return null;
    const leftSet = new Set(left.map((p) => p.i));
    const L = [];
    const R = [];
    pieces.forEach((p, i) => {
      // 빈 조각은 바로 앞 글자 조각과 같은 쪽에 둬요
      const side = String(p.raw).trim() && p.w > 0 ? leftSet.has(i) : (L.length && L[L.length - 1] === i - 1);
      (side ? L : R).push(i);
    });
    return [L, R];
  },

  /**
   * 비스듬히 스캔한 페이지는 한 줄 안에서도 오른쪽으로 갈수록 글자가 올라가거나 내려가요.
   * 같은 줄에서 바로 이어지는 조각끼리의 기울기 중앙값을 재서, 줄이 수평이 되도록 y 를 고쳐요.
   * (문단 나누기에만 쓰고, 화면에 칠하는 위치는 원래 좌표를 써요.)
   */
  deskew(pieces) {
    const slopes = [];
    for (let i = 0; i < pieces.length - 1; i++) {
      const a = pieces[i];
      const b = pieces[i + 1];
      const h = Math.min(a.h || 10, b.h || 10);
      const dx = b.x - a.x;
      const gap = b.x - (a.x + a.w);
      if (!String(a.raw).trim() || !String(b.raw).trim() || dx < h || gap < -h * 0.3 || gap > h * 3) continue;
      const dy = b.y - a.y;
      if (Math.abs(dy) > h * 0.6) continue;
      slopes.push(dy / dx);
    }
    if (slopes.length < 20) return pieces;
    slopes.sort((x, y) => x - y);
    const k = slopes[Math.floor(slopes.length / 2)];
    if (Math.abs(k) < 0.004 || Math.abs(k) > 0.15) return pieces;
    const x0 = Math.min(...pieces.map((p) => p.x));
    return pieces.map((p) => ({ ...p, y: p.y - k * (p.x + (p.w || 0) / 2 - x0) }));
  },

  buildLayout(piecesRaw) {
    const L = TransYbCore.buildLayoutCols(piecesRaw);
    L.text = TransYbCore.repairBrokenCaps(L.text);
    return L;
  },

  buildLayoutCols(piecesRaw) {
    const piecesIn = TransYbCore.deskew(piecesRaw);
    const cols = TransYbCore.splitColumns(piecesIn);
    if (!cols) return TransYbCore.buildLayoutOne(piecesIn);
    // 왼쪽 단을 다 읽고 오른쪽 단을 읽어요. 위치 정보는 원래 조각 번호로 되돌려요.
    const ranges = piecesIn.map(() => null);
    let text = "";
    const soft = [];
    const paras = [];
    let notesOpen = false;
    for (const idxs of cols) {
      const one = TransYbCore.buildLayoutOne(idxs.map((i) => piecesIn[i]));
      if (!one.text) continue;
      if (text) text += "\n";
      const off = text.length;
      text += one.text;
      one.ranges.forEach((r, k) => {
        if (r) ranges[idxs[k]] = { ...r, start: r.start + off, end: r.end + off };
      });
      for (const x of one.soft) soft.push(x + off);
      for (const pa of one.paras) paras.push({ ...pa, start: pa.start + off, end: pa.end + off });
      notesOpen = one.notesOpen;
    }
    return { text, ranges, soft, paras, notesOpen };
  },

  /**
   * 어떤 PDF는 글꼴 문제로 대문자 하나를 소문자로 넣어 둬요(예: "However" -> "however", "Heath 2003" -> "heath 2003").
   * 그러면 마침표 뒤가 소문자라서 문장이 안 나뉘고 한 덩어리로 번역돼요.
   * 마침표 뒤(줄임말 뒤 제외)나 인용(이름 연도) 자리에 같은 소문자가 되풀이되면 그 글자가 깨졌다고 보고 대문자로 고쳐요.
   * 글자 수는 그대로라 위치 정보는 바뀌지 않아요.
   */
  repairBrokenCaps(text) {
    const afterStop = /([.!?])(["”’)\]]*)(\s+)([a-z])(?=[a-z])/g;
    const cite = /(^|[\s(;])([a-z])(?=[a-z]+(?:-[A-Za-z]+)?(?:,? (?:and|&) [A-Za-z-]+)?(?: et al\.?)?,? \(?\d{4}[a-z]?\b)/g;
    const counts = {};
    const spots = [];
    let m;
    while ((m = afterStop.exec(text))) {
      const at = m.index + m[0].length - 1;
      if (TransYbCore._endsWithAbbreviation(text.slice(0, m.index + 1))) continue;
      counts[m[4]] = (counts[m[4]] || 0) + 1;
      spots.push([at, m[4]]);
    }
    const citeHits = {};
    while ((m = cite.exec(text))) {
      citeHits[m[2]] = (citeHits[m[2]] || 0) + 1;
      spots.push([m.index + m[1].length, m[2]]);
    }
    const broken = new Set(Object.keys(counts).filter((c) => counts[c] >= 2 || (counts[c] >= 1 && citeHits[c] >= 1)));
    if (!broken.size) return text;
    const chars = text.split("");
    for (const [at, c] of spots) if (broken.has(c) && chars[at] === c) chars[at] = c.toUpperCase();
    return chars.join("");
  },

  buildLayoutOne(piecesIn) {
    // 0) 큰 첫 글자(E|nglish): 크기와 위치를 다음 조각에 맞춰 같은 줄의 한 단어로 붙여요.
    const pieces = piecesIn.map((p) => ({ ...p }));
    for (let i = 0; i < pieces.length - 1; i++) {
      const p = pieces[i];
      const n = pieces[i + 1];
      if (!/^\s*\p{Lu}\s*$/u.test(p.raw) || !n.raw.trim()) continue;
      const big = p.h > n.h * 1.5;
      const beside = n.x >= p.x + p.w * 0.5 && n.x - (p.x + p.w) < p.w * 1.5;
      const overlaps = n.y >= p.y - n.h && n.y <= p.y + p.h;
      if (big && beside && overlaps) {
        p.y = n.y;
        p.h = n.h;
        p.w = n.x - p.x; // 틈 없이 붙어서 띄어 쓰지 않아요
      }
    }
    // 1) 줄 묶기
    const lines = [];
    let cur = null;
    pieces.forEach((p, idx) => {
      const { text: t, map } = TransYbCore.normalizeWithMap(p.raw);
      // 빈칸 조각은 위치가 엉뚱한 경우가 많아요(높이 0). 줄을 새로 만들지 않고 지금 줄에 붙여요.
      if (cur && !String(p.raw).trim()) {
        cur.items.push({ idx, t, map, x: p.x, w: p.w, raw: p.raw, font: p.font || "" });
        return;
      }
      const h = p.h || 10;
      const mid = p.y + h / 2;
      const sameLine =
        cur && Math.abs(mid - cur.mid) < Math.max(h, cur.h) * 0.5 && p.x >= cur.right - cur.h * 0.5;
      if (!sameLine) {
        cur = { items: [], left: p.x, right: p.x + p.w, top: p.y, bottom: p.y + h, h, mid };
        lines.push(cur);
      }
      cur.items.push({ idx, t, map, x: p.x, w: p.w, raw: p.raw, font: p.font || "" });
      cur.right = Math.max(cur.right, p.x + p.w);
      cur.left = Math.min(cur.left, p.x);
      cur.top = Math.min(cur.top, p.y);
      cur.bottom = Math.max(cur.bottom, p.y + h);
      cur.h = Math.max(cur.h, h);
    });
    for (const ln of lines) {
      ln.text = ln.items.map((it) => it.t).join(" ").trim();
      // 줄 글자 크기: 글자가 가장 많은 조각들의 높이(기울임꼴, ŏ 같은 발음 기호, 각주 번호에 흔들리지 않게)
      const hs = [];
      for (const it of ln.items) if (it.t) for (let k = 0; k < Math.min(it.t.length, 40); k++) hs.push(pieces[it.idx].h || 10);
      hs.sort((a, b) => a - b);
      ln.fh = hs.length ? hs[Math.floor(hs.length / 2)] : ln.h;
      // 줄 글꼴: 글자가 가장 많은 글꼴
      const fc = {};
      for (const it of ln.items) if (it.t && it.font) fc[it.font] = (fc[it.font] || 0) + it.t.length;
      ln.font = Object.keys(fc).sort((a, b) => fc[b] - fc[a])[0] || "";
      ln.chars = ln.items.reduce((n, it) => n + (it.t ? it.t.length : 0), 0);
      ln.firstText = (ln.items.find((it) => it.t) || {}).t || "";
      // 글머리표(•) 다음 글자가 시작하는 위치: 들여쓰기는 이걸로 재요
      const firstWord = ln.items.find((it) => it.t && !/^[•◦▪●‣∙·]$/.test(it.t));
      ln.textLeft = firstWord ? firstWord.x : ln.left;
    }
    const real = lines.filter((l) => l.text);
    if (!real.length) return { text: "", ranges: pieces.map(() => null), soft: [], paras: [] };

    // 단 왼쪽, 오른쪽 경계(가장 흔한 값 근처)
    const sorted = (a) => a.slice().sort((x, y) => x - y);
    const lefts = sorted(real.map((l) => l.left));
    const rights = sorted(real.map((l) => l.right));
    const colRight = rights[Math.floor(rights.length * 0.8)];
    const colLeft = lefts[Math.floor(lefts.length * 0.1)];
    const colWidth = Math.max(1, colRight - colLeft);
    // 여러 줄 제목이 이어지려면: 앞 줄이 단 폭의 60% 이상이거나 연결어로 끝나야 해요(짧은 저자 이름 줄은 따로).
    const titleFlows = (l) => l.right - l.left >= colWidth * 0.75 || /([:,\-–—&/]|\b(of|and|the|in|for|on|to|a|an|with|und|og|y|de)\b)\s*$/i.test(l.text);
    const lineHs = sorted(real.map((l) => l.fh));
    const H = lineHs[Math.floor(lineHs.length / 2)];
    // 스캔 OCR 페이지는 줄마다 글자 높이가 들쭉날쭉해요. 흔들림이 크면 "큰 글씨(제목)" 기준을 그만큼 높여요.
    // 흔들림 = 줄 높이가 가운데 값에서 벗어난 정도의 중앙값(보통 PDF는 거의 0)
    const devs = sorted(real.map((l) => Math.abs(l.fh - H) / Math.max(H, 1)));
    const noise = devs[Math.floor(devs.length / 2)];
    const BIG = H * Math.min(1.5, 1.15 + Math.max(0, noise - 0.03) * 2.5);
    const gaps = [];
    for (let i = 1; i < real.length; i++) {
      const g = real[i].top - real[i - 1].bottom;
      if (g > -H && g < H * 3) gaps.push(g);
    }
    const normalGap = gaps.length ? sorted(gaps)[Math.floor(gaps.length / 2)] : H * 0.3;
    // 페이지 본문 글꼴: 글자가 가장 많은 글꼴
    const fontChars = {};
    for (const l of real) if (l.font) fontChars[l.font] = (fontChars[l.font] || 0) + l.chars;
    const bodyFont = Object.keys(fontChars).sort((a, b) => fontChars[b] - fontChars[a])[0] || "";
    const endsSentence = (s) => /[.!?:;。？！]["'”’)\]]*[¹²³⁰-⁹\d*†‡]{0,3}$/.test(s);
    const isBullet = (s) => TransYbCore.BULLET.test(s) || /^[•◦▪●‣]/.test(s);

    // 2) 문단 나누기
    let text = "";
    const ranges = pieces.map(() => null);
    const soft = [];
    const paras = [];
    let para = null;
    let prev = null;
    const startPara = () => {
      if (para) para.end = text.length;
      if (text) text += "\n";
      para = { start: text.length, end: text.length, lines: [] };
      paras.push(para);
    };
    for (const ln of real) {
      let brk = !prev;
      if (prev) {
        const h = Math.max(H, 1);
        const gap = ln.top - prev.bottom;
        const newColumn = ln.top < prev.top - h; // 위로 올라감 = 다음 단
        if (!newColumn) {
          const gapLarge = gap > normalGap + h * 0.5;
          // 글꼴이 바뀌면(굵은 소제목 -> 본문) 새 문단. 단 앞 줄이 짧게 끝났거나 줄 간격이 조금이라도 벌어졌을 때만
          // (참고문헌 둘째 줄의 기울임꼴 학술지 이름 같은 건 이어져요)
          const fontChange = ln.font && prev.font && ln.font !== prev.font && (ln.font === bodyFont || prev.font === bodyFont);
          const prevShortish = prev.right < colRight - h * 2.5;
          if (fontChange && (prevShortish || gap > normalGap + h * 0.25)) brk = true;
          if (gapLarge) brk = true; // 줄 간격이 벌어짐
          // 글자 크기가 확실히 바뀜(제목). 본문 크기 안의 작은 흔들림(발음 기호, 기울임꼴)은 무시해요.
          const bigPrev = prev.fh > BIG;
          const bigNow = ln.fh > BIG;
          const sizeJump = (bigPrev !== bigNow) || Math.abs(ln.fh - prev.fh) > Math.max(prev.fh, ln.fh) * (0.25 + (BIG / H - 1.15));
          const sameBigTitle = bigPrev && bigNow && Math.abs(ln.fh - prev.fh) < prev.fh * 0.12 && titleFlows(prev);
          if (sizeJump && !sameBigTitle) brk = true;
          const short = prev.right < colRight - h * 2.5;
          if (short && endsSentence(prev.text) && !sameBigTitle) brk = true; // 짧은 마지막 줄
          // 짧은 한 줄 = 제목. 단, 본문보다 큰 글씨가 같은 크기로 이어지면 여러 줄 제목이라 나누지 않아요.
          const bigTitleGoesOn = prev.fh > BIG && ln.fh > BIG && Math.abs(ln.fh - prev.fh) < prev.fh * 0.12 && titleFlows(prev);
          // (소문자로 시작하는 줄은 앞 페이지에서 이어진 문장이라 제목이 아니에요)
          const headLike = /^[\p{Lu}\d"“‘'(]/u.test(prev.text);
          if (short && para.lines.length === 1 && !endsSentence(prev.text) && !bigTitleGoesOn && headLike) brk = true;
          // 짧은 줄 다음에 또 짧은 줄이 대문자로 시작하면(저자 이름, 소속, 주소 목록) 줄마다 따로예요.
          const lnShort = ln.right < colRight - h * 2.5;
          if (short && lnShort && !bigTitleGoesOn && /^[\p{Lu}\d]/u.test(ln.text) && !endsSentence(prev.text)) brk = true;
          // 첫 줄 들여쓰기: 앞 줄이 마침표로 끝나고 오른쪽 끝까지 꽉 차지 않았을 때만(참고문헌 이어지는 줄과 구분)
          if (ln.textLeft > prev.textLeft + h * 0.8 && endsSentence(prev.text) && prev.right < colRight - h * 0.8) brk = true;
          // 내어쓰기(참고문헌): 문단 첫 줄이 왼쪽 끝이고 이어지는 줄이 들여져 있다가 다시 왼쪽 끝으로 오면 새 항목
          const first = para.lines[0];
          const refLike = /\b(1[6-9]|20)\d{2}[a-z]?\b/.test(first.text) || isBullet(first.firstText);
          if (refLike && para.lines.length > 1 && ln.left < prev.left - h * 0.8 && Math.abs(ln.left - first.left) < h * 0.8) brk = true;
        } else if (endsSentence(prev.text) && prev.right < colRight - h * 2.5) {
          brk = true;
        }
        // 문장이 분명히 이어지면 나누지 않아요:
        // 앞 줄이 문장 중간에서 끝났고, 줄 사이가 벌어지지 않았고, 앞 줄이 머리말(전부 대문자)이 아니며,
        // 다음 줄이 소문자로 시작하거나 앞 줄이 오른쪽 끝까지 꽉 찬 경우
        const gap2 = ln.top - prev.bottom;
        const allCaps = !/\p{Ll}/u.test(prev.text) && /\p{Lu}{3}/u.test(prev.text);
        const fullWidth = prev.right >= colRight - Math.max(H, 1) * 1.0;
        // 소문자로 시작해도, 앞 줄이 짧게 끝났으면(저자 이름 같은 줄) 이어진 문장이 아니에요.
        const prevLong = prev.right >= colRight - Math.max(H, 1) * 6;
        const sameFont = !ln.font || !prev.font || ln.font === prev.font;
        const continues =
          sameFont &&
          prevLong &&
          !endsSentence(prev.text) &&
          gap2 <= normalGap + Math.max(H, 1) * 0.6 &&
          !allCaps &&
          (/^[\p{Ll}(]/u.test(ln.text) || fullWidth) &&
          !isBullet(ln.firstText);
        if (continues) brk = false;
        // 참고문헌·글머리표 항목의 들여 쓴 다음 줄은 같은 항목이에요.
        const pFirst = para && para.lines[0];
        if (pFirst && (isBullet(pFirst.firstText) || /\b(1[6-9]|20)\d{2}[a-z]?\b/.test(pFirst.text)) && ln.left > pFirst.left + Math.max(H, 1) * 0.5 && !isBullet(ln.firstText) && Math.abs(ln.fh - prev.fh) < prev.fh * 0.25 && ln.top - prev.bottom <= normalGap + Math.max(H, 1) * 0.5) brk = false;
        if (isBullet(ln.firstText)) brk = true;
        // 큰 글씨 제목이 콜론이나 연결어로 끝나고 같은 크기로 이어지면, 줄 사이가 넓어도 같은 제목이에요.
        if (
          prev.fh > BIG && ln.fh > BIG && Math.abs(ln.fh - prev.fh) < prev.fh * 0.12 &&
          ln.top - prev.bottom < prev.fh * 1.6 &&
          /([:\-–—,&]|\b(of|and|the|in|for|on|to|with|a|an))\s*$/i.test(prev.text.trim())
        ) brk = false;
        // 저작권(©), DOI 같은 안내 줄은 앞뒤 줄과 항상 따로예요
        if (TransYbCore.BOILER_LINE.test(ln.text) || TransYbCore.BOILER_LINE.test(prev.text)) brk = true;
      }
      if (brk) startPara();
      else {
        // 같은 문단의 다음 줄: 줄 끝 하이픈이면 붙이고, 아니면 띄어 써요.
        const hy = /[\p{L}]-$/u.test(prev.text) && /^\p{Ll}/u.test(ln.text);
        if (hy) soft.push(text.length - 1);
        else text += " ";
      }
      // 줄 안의 조각 이어 붙이기
      let lastRight = null;
      ln.items.forEach((it) => {
        if (!it.t) return;
        if (lastRight !== null) {
          const gap = it.x - lastRight;
          const spaced = gap > ln.h * 0.12 || /\s$/.test(ln.items[ln.items.indexOf(it) - 1]?.raw || "");
          if (spaced) text += " ";
        }
        const start = text.length;
        text += it.t;
        ranges[it.idx] = { start, end: text.length, map: it.map };
        lastRight = it.x + it.w;
      });
      para.lines.push(ln);
      prev = ln;
    }
    if (para) para.end = text.length;
    const pageTop = Math.min(...real.map((l) => l.top));
    const pageBottom = Math.max(...real.map((l) => l.bottom));

    // 3) 문단 종류: 제목, 참고문헌, 기타(쪽 번호 등), 본문
    let inRefs = false;
    let inNotes = false; // "Notes / Endnotes" 제목 아래는 주석
    const pageMid = (pageTop + pageBottom) / 2;
    const endsFull = (s) => /[.!?;。？！]["'”’)\]]*[¹²³⁰-⁹\d*†‡]{0,3}$/.test(s); // 콜론(:)은 제목 끝에도 와요
    paras.forEach((p, pi) => {
      const t = text.slice(p.start, p.end);
      const oneLine = p.lines.length === 1;
      const pfc = {};
      for (const l of p.lines) if (l.font) pfc[l.font] = (pfc[l.font] || 0) + l.chars;
      const pFont = Object.keys(pfc).sort((a, b) => pfc[b] - pfc[a])[0] || "";
      const otherFont = pFont && bodyFont && pFont !== bodyFont;
      const numbered = /^(\d{1,2}(\.\d{1,2})*\.?|[IVX]{1,4}\.)\s+[\p{Lu}"“‘']/u.test(t);
      const hs = p.lines.map((l) => l.fh).sort((a, b) => a - b);
      const ph = hs[Math.floor(hs.length / 2)];
      const atEdge = Math.min(...p.lines.map((l) => l.top)) - pageTop < H * 2.5 || pageBottom - Math.max(...p.lines.map((l) => l.bottom)) < H * 2.5;
      p.edge = atEdge && (pi <= 1 || pi >= paras.length - 2);
      const hasYear = /\b(1[6-9]|20)\d{2}[a-z]?\b/.test(t);
      const looksRef =
        hasYear &&
        (/^([•◦▪●‣∙·–—-]\s*)?[\p{Lu}][\p{L}'’\-]+,\s+(\p{Lu}|[\p{Lu}][\p{L}]+)/u.test(t) ||
          /^([•◦▪●‣∙·–—-]\s*)?[\p{Lu}][\p{L}'’\-]+(\s+(and|&|og|y)\s+[\p{Lu}][\p{L}'’\-]+)?\s*\(?(1[6-9]|20)\d{2}/u.test(t));
      const tt = t.trim();
      if (TransYbCore.NOTES_HEADING.test(tt)) {
        p.kind = "heading";
        inNotes = true;
        return;
      }
      if (inNotes && TransYbCore.NOTES_END.test(tt) && tt.length < 60) {
        p.kind = "heading";
        inNotes = false;
        return;
      }
      if (/^\d{1,4}$/.test(tt) || tt.length <= 2) p.kind = "other";
      else if (/This content downloaded from|All use subject to|about\.jstor\.org\/terms|^\d{1,3}(\.\d{1,3}){3} on \w{3}, \d/i.test(t)) p.kind = "other";
      else if (TransYbCore.BOILER_LINE.test(tt) && tt.length < 200) p.kind = "other";
      // 페이지 맨 위나 맨 아래의 작은 글씨 = 머리말, 꼬리말, 내려받기 안내
      else if (atEdge && ph < H * 0.9 && t.length < 300 && !isBullet(t)) p.kind = "other";
      // 본문보다 큰 글씨의 짧은 문단 = 제목(두세 줄짜리 논문 제목 포함)
      else if (ph > BIG && t.length < 300 && p.lines.length <= 4 && !endsFull(t) && !/[.!?]["”’)]*\s+[\p{Lu}"“‘(]/u.test(t)) p.kind = "heading";
      // 본문과 다른 글꼴(굵은 글꼴 등)의 짧은 문단, 번호로 시작하는 짧은 문단(3.1 ...) = 소제목
      else if (
        (otherFont || numbered) && t.length < 250 && p.lines.length <= 3 && !endsFull(t) && !isBullet(t) &&
        !/[.!?]["”’)]*\s+[\p{Lu}"“‘(]/u.test(t) // 안에 문장이 둘 이상 있으면 소제목이 아니에요
      ) p.kind = "heading";
      // 페이지 맨 위나 맨 아래의 짧은 한 줄(마침표 없음) = 저자 이름, 학술지 이름 같은 머리말
      else if (atEdge && oneLine && (pi === 0 || pi === paras.length - 1) && t.length < 120 && !endsFull(t)) p.kind = "other";
      // 짧은 한 줄 소제목: 대문자나 숫자로 시작하고, 단어가 적고, 앞 페이지에서 이어진 문장이 아닐 때만
      else if (
        oneLine && t.length < 100 && !endsFull(t) && !hasYear && !isBullet(t) &&
        /^[\p{Lu}\d"“‘'(]/u.test(t) && t.split(/\s+/).length <= 14
      ) p.kind = "heading";
      else if (looksRef || (inRefs && hasYear)) p.kind = "ref";
      else p.kind = "body";
      if (p.kind === "heading" || TransYbCore.REF_HEADING.test(t.trim()) || /\b(readings|references)\s*:?\s*$/i.test(t.trim())) {
        inRefs = TransYbCore.REF_HEADING.test(t.trim()) || /\b(readings|references)\s*:?\s*$/i.test(t.trim());
        if (TransYbCore.REF_HEADING.test(t.trim())) p.kind = "heading";
      }
      // 주석: "Notes" 제목 아래의 문단, 또는 페이지 아래쪽의 작은 글씨로 번호가 붙은 문단
      if (p.kind !== "other" && p.kind !== "heading") {
        const numbered = /^(\d{1,3}|[*†‡])\s?[\p{Lu}"“‘'(\[]/u.test(tt) || /^[S1l]\p{Lu}\p{Ll}/u.test(tt);
        const footArea = Math.min(...p.lines.map((l) => l.top)) > pageMid && ph < H * 0.92;
        if (inNotes || (numbered && footArea)) p.kind = "note";
      }
    });
    for (const p of paras) delete p.lines;
    return { text, ranges, soft, paras, notesOpen: inNotes };
  },

  /* ---------- OCR 글자 폭 보정 ----------
   * 스캔 PDF 에 덧입힌 보이지 않는 글자가 가로로 눌린 글꼴로 기록된 경우(가로 크기 << 세로 크기),
   * PDF 가 알려 주는 줄 폭이 실제 화면보다 훨씬 짧아요. 문단 중간 줄은 오른쪽 끝까지 찬다는 점으로 보정해요.
   * items: [{str, t:[a,b,c,d,e,f], w, h}], view: [x0, y0, x1, y1]
   */
  /**
   * 스캔한 책을 옆으로 눕혀 넣은 PDF(페이지 회전 90·180·270도)는 글자가 PDF 좌표에서 세로로 놓여 있어요.
   * 글자 방향을 보고 화면에 보이는 대로 바로 선 좌표로 바꿔요.
   * 돌려준 toPdf 는 바로 선 좌표 -> PDF 좌표, up 은 PDF 좌표 -> 바로 선 좌표 변환표예요.
   */
  uprightItems(items, view) {
    const mul = (m, n) => [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
    // 글자 수로 가중한 가장 흔한 글자 방향(0, 90, 180, 270도)
    const votes = [0, 0, 0, 0];
    for (const it of items) {
      const ang = Math.atan2(it.t[1], it.t[0]);
      votes[(Math.round(ang / (Math.PI / 2)) + 4) % 4] += it.str.length;
    }
    const q = votes.indexOf(Math.max(...votes));
    if (!q) return { items, view, up: null, toPdf: null };
    const [x0, y0, x1, y1] = view;
    const W = x1 - x0;
    const H = y1 - y0;
    const sh = [1, 0, 0, 1, -x0, -y0];
    // q=1: 글자가 위로(90도) 놓임, q=2: 거꾸로, q=3: 아래로
    const rot = [null, [0, -1, 1, 0, 0, W], [-1, 0, 0, -1, W, H], [0, 1, -1, 0, H, 0]][q];
    const up = mul(rot, sh);
    const back = [null, [0, 1, -1, 0, W, 0], [-1, 0, 0, -1, W, H], [0, -1, 1, 0, 0, H]][q];
    const toPdf = mul([1, 0, 0, 1, x0, y0], back);
    const out = items.map((it) => ({ ...it, t: mul(up, it.t) }));
    const nv = q === 2 ? [0, 0, W, H] : [0, 0, H, W];
    return { items: out, view: nv, up, toPdf };
  },

  // 변환표 m 으로 사각형 [x1, y1, x2, y2] 를 옮기고, 옮긴 네 꼭짓점을 감싸는 사각형을 돌려줘요.
  mapRect(m, r) {
    const xs = [];
    const ys = [];
    for (const [x, y] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) {
      xs.push(m[0] * x + m[2] * y + m[4]);
      ys.push(m[1] * x + m[3] * y + m[5]);
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  },

  fixSqueezedWidths(items, view) {
    const ratios = items.filter((it) => it.str.trim().length > 5 && it.t[3]).map((it) => Math.abs(it.t[0] / it.t[3]));
    if (ratios.length < 5) return items;
    ratios.sort((a, b) => a - b);
    if (ratios[Math.floor(ratios.length / 2)] > 0.75) return items; // 보통 PDF
    // 줄 묶기(같은 높이)
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      // 작은 글자 높이 기준으로 묶어요(큰 첫 글자가 섞인 줄과 그 아래 줄을 한 줄로 묶지 않게)
      if (last && Math.abs(it.t[5] - last.y) < Math.min(it.h, last.h) * 0.5) {
        last.items.push(it);
        last.h = Math.max(last.h, it.h);
      } else lines.push({ y: it.t[5], h: it.h, items: [it] });
    }
    for (const ln of lines) {
      ln.left = Math.min(...ln.items.map((it) => it.t[4]));
      ln.right = Math.max(...ln.items.map((it) => it.t[4] + it.w));
    }
    const lefts = lines.map((l) => l.left).sort((a, b) => a - b);
    const margin = lefts[Math.floor(lefts.length * 0.1)] - view[0];
    const R = Math.max(Math.max(...lines.map((l) => l.right)), view[2] - margin);
    const need = lines.map((l) => (l.right > l.left ? (R - l.left) / (l.right - l.left) : 1));
    const cands = need.filter((f) => f > 1.25 && f < 2.6).sort((a, b) => a - b);
    if (!cands.length) return items;
    const F = cands[Math.floor(cands.length / 2)];
    const out = new Map();
    lines.forEach((ln, i) => {
      const f = need[i];
      const k = f > F * 0.9 && f < F * 1.1 ? f : f > 1.05 ? Math.min(F, f) : 1; // 꽉 찬 줄은 끝까지, 짧은 줄은 평균 비율로
      for (const it of ln.items) {
        out.set(it, { ...it, t: [...it.t.slice(0, 4), ln.left + (it.t[4] - ln.left) * k, it.t[5]], w: it.w * k });
      }
    });
    return items.map((it) => out.get(it) || it);
  },

  /* ---------- 부분 위치 찾기 ----------
   * 번역에 보낸 원문(unitSource)은 줄 끝 하이픈을 빼고 공백을 줄인 글자예요.
   * 그 글자 위치와 페이지 글자(page.text) 위치를 서로 바꾸는 표를 만들어요.
   */
  sourceMap(text, unit, soft) {
    const softSet = new Set(soft || []);
    let src = "";
    const idx = [];
    let space = false;
    for (let i = unit.start; i < unit.end; i++) {
      if (softSet.has(i)) continue;
      const ch = text[i];
      if (/\s/.test(ch)) {
        if (src) space = true;
        continue;
      }
      if (space) {
        src += " ";
        idx.push(i - 1);
        space = false;
      }
      for (const c of ch.normalize("NFKC")) {
        src += c;
        idx.push(i);
      }
    }
    return { src, idx };
  },

  // 비교용으로 다듬기: 소문자, 따옴표 통일, 공백 하나
  looseKey(t) {
    return String(t).toLowerCase().normalize("NFKC").replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
  },

  // 문장 안에서 needle 이 있는 페이지 글자 위치 [시작, 끝] (없으면 null)
  findInUnit(text, unit, soft, needle) {
    const { src, idx } = TransYbCore.sourceMap(text, unit, soft);
    const a = TransYbCore.looseKey(src);
    const b = TransYbCore.looseKey(needle);
    if (!b || a.length !== src.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim().length) {
      // 길이가 달라지는 정규화가 있으면 단순 검색으로
      const k = src.toLowerCase().indexOf(String(needle).toLowerCase().trim());
      return k < 0 ? null : [idx[k], idx[k + needle.trim().length - 1] + 1];
    }
    const k = a.indexOf(b);
    if (k < 0) return null;
    return [idx[k], idx[Math.min(idx.length - 1, k + b.length - 1)] + 1];
  },

  // 조테로 주석 글자(annText)가 페이지 글자의 어디인지: 공백과 하이픈을 빼고 비교해요. [시작, 끝] 또는 null
  findAnnotationSpan(pageText, annText) {
    const strip = (t) => {
      const chars = [];
      const map = [];
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (/[\s\-‐‑–]/.test(c)) continue;
        for (const x of c.normalize("NFKC").toLowerCase().replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"')) {
          chars.push(x);
          map.push(i);
        }
      }
      return { s: chars.join(""), map };
    };
    const P = strip(pageText);
    const A = strip(annText).s;
    if (A.length < 2) return null;
    let k = P.s.indexOf(A);
    if (k < 0 && A.length > 40) {
      // 끝까지 똑같지 않으면 앞 20글자와 뒤 20글자로 찾아요
      const h = P.s.indexOf(A.slice(0, 20));
      const t = h < 0 ? -1 : P.s.indexOf(A.slice(-20), h);
      if (h >= 0 && t >= 0) return [P.map[h], P.map[t + 19] + 1];
      return null;
    }
    if (k < 0) return null;
    return [P.map[k], P.map[k + A.length - 1] + 1];
  },

  // 제목 비교용: 소문자, 글자와 숫자만
  titleKey(t) {
    return String(t || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
  },

  // 문단 글자가 논문 제목과 같은지(앞부분이 같고 길이가 비슷하면 같다고 봐요)
  isPaperTitle(text, title) {
    const a = TransYbCore.titleKey(text);
    const b = TransYbCore.titleKey(title);
    if (b.length < 12 || !a) return false;
    if (a === b) return true;
    const ratio = a.length / b.length;
    return ratio > 0.85 && ratio < 1.2 && (a.startsWith(b.slice(0, 30)) || b.startsWith(a.slice(0, 30)));
  },

  // 번역 단위 만들기: 본문은 문장으로, 제목/참고문헌/기타는 문단 통째로 하나.
  makeUnits(text, paras) {
    const units = [];
    paras.forEach((p, pi) => {
      if (p.kind !== "body") {
        units.push({ start: p.start, end: p.end, para: pi, kind: p.kind, title: !!p.isTitle }); // 제목, 참고문헌, 주석은 통째로
        return;
      }
      const sub = text.slice(p.start, p.end);
      for (const s of TransYbCore.splitSentences(sub)) {
        units.push({ start: p.start + s.start, end: p.start + s.end, para: pi, kind: "body" });
      }
    });
    return units;
  },

  // 번역에 보낼 글자: 줄 끝 하이픈을 지워요(self-disclo-sure -> self-disclosure).
  unitSource(text, unit, soft) {
    let out = "";
    for (let i = unit.start; i < unit.end; i++) {
      if (soft.includes(i)) continue;
      out += text[i];
    }
    return out.normalize("NFKC").replace(/\s+/g, " ").trim();
  },

  // 각주 번호 찾기: 단어나 문장부호 바로 뒤에 띄어쓰기 없이 붙은 1~3자리 숫자(Mother14, market.4, million).3)
  // 뒤에는 띄어쓰기, 문장 끝, 쉼표 같은 부호가 와야 해요(1998:27, 2003:4 같은 쪽수는 빼요).
  FOOTNOTE_RE: /(?<=[\p{L}.,;!?)"”’'\]])(\d{1,3})(?=$|[\s,;)\]"”’]|[.](?!\d))/gu,

  // 문장 하나에서 각주 번호 후보를 차례대로 찾아요(걸러 낼 것은 걸러 내고).
  footnoteCandidates(src) {
    const out = [];
    for (const m of String(src).matchAll(TransYbCore.FOOTNOTE_RE)) {
      const i = m.index;
      const prev = src[i - 1];
      const prev2 = src[i - 2] || "";
      if (prev === ":") continue; // 1998:27 같은 쪽수
      if ((prev === "," || prev === ".") && /\d/.test(prev2)) continue; // $3,333 / 7.30
      const word = src.slice(0, i).split(/\s/).pop();
      // y6ng6 처럼 글자 사이에 숫자가 섞인 단어(잘못 읽힌 글자). 인용 뒤 각주(2000).9)는 살려요.
      if (/\p{L}/u.test(prev) && /\d/.test(word)) continue;
      out.push(m[1]);
    }
    return out;
  },

  // 한 페이지의 문장들에서 각주 번호를 찾아요. 각주 번호는 페이지 안에서 차례대로 커져요.
  // 결과: 문장마다 각주 번호 모음(Set)
  pageFootnotes(srcs) {
    let last = null;
    return srcs.map((src) => {
      const keep = new Set();
      for (const c of TransYbCore.footnoteCandidates(src)) {
        const n = Number(c);
        if (last === null ? n <= 300 : n > last && n - last <= 5) {
          keep.add(c);
          last = n;
        }
      }
      return keep;
    });
  },

  footnoteNumbers(src) {
    return TransYbCore.pageFootnotes([src])[0];
  },

  // 번역문에서 원문 각주 번호와 같은 숫자가 붙어 있는 자리를 찾아요. 결과: [[시작, 끝], ...]
  footnoteSpans(text, nums) {
    if (!nums || !nums.size) return [];
    const byNum = new Map(); // 번호마다 후보 자리들
    for (const m of String(text).matchAll(TransYbCore.FOOTNOTE_RE)) {
      const prev = text[m.index - 1];
      if (!nums.has(m[1]) || prev === ":" || ((prev === "," || prev === ".") && /\d/.test(text[m.index - 2] || ""))) continue;
      if (!byNum.has(m[1])) byNum.set(m[1], []);
      byNum.get(m[1]).push({ at: m.index, latinCap: /[A-Z]/.test(prev) });
    }
    // 각주 번호 하나당 한 자리: 대문자 바로 뒤(G7 같은)가 아닌 자리를 먼저 골라요.
    const spans = [];
    for (const [n, list] of byNum) {
      const pick = list.find((c) => !c.latinCap) || list[0];
      spans.push([pick.at, pick.at + n.length]);
    }
    return spans.sort((x, y) => x[0] - y[0]);
  },


  /* ---------- 각주 내용 찾기 ----------
   * pages: [[{ text, h, y }...], ...]  (페이지마다 위에서 아래 순서의 줄)
   * 1) "Notes / Endnotes / 미주" 제목 아래의 번호 붙은 문단 (논문 끝 미주)
   * 2) 페이지 아래쪽의 작은 글씨로 된 번호 붙은 줄 (페이지 각주)
   * 결과: Map(번호 문자열 -> 각주 내용)
   */
  NOTES_HEADING: /^(end\s?notes|notes|footnotes|미주|각주|주|noter|notas)$/i,
  NOTES_END: /^(references|bibliography|works cited|literature cited|appendix|acknowledg|참고\s*문헌|litteratur|referencias|bibliograf)/i,
  NOTE_START: /^(\d{1,3})(?=[\p{Lu}"“‘'(\[]|[.)]?\s+\S)[.)]?\s*/u,

  parseNotes(pages) {
    const notes = new Map();
    const boiler = (t) =>
      /^\d{1,4}$/.test(t) || /This content downloaded from|All use subject to|jstor\.org\/terms|^\d{1,3}(\.\d{1,3}){3} on /i.test(t);
    const add = (cur, t) => {
      if (/[\p{L}]-$/u.test(cur.text) && /^\p{Ll}/u.test(t)) cur.text = cur.text.slice(0, -1) + t;
      else cur.text += (cur.text ? " " : "") + t;
    };
    const putNote = (num, text) => {
      if (!notes.has(num) || notes.get(num).length < text.length) notes.set(num, text.trim());
    };
    // 1) 미주
    let inNotes = false;
    let cur = null;
    let last = 0;
    pages.forEach((lines) => {
      lines.forEach((ln, li) => {
        const t = ln.text.trim();
        if (!t || boiler(t)) return;
        if (TransYbCore.NOTES_HEADING.test(t)) {
          inNotes = true;
          cur = null;
          last = 0;
          return;
        }
        if (!inNotes) return;
        if (TransYbCore.NOTES_END.test(t) && t.length < 60) {
          if (cur) putNote(cur.num, cur.text);
          inNotes = false;
          cur = null;
          return;
        }
        // 페이지 맨 위 머리말(짧고 마침표 없음)은 건너뛰어요
        if (li === 0 && t.length < 120 && !/[.!?]$/.test(t) && !TransYbCore.NOTE_START.test(t)) return;
        const m = TransYbCore.NOTE_START.exec(t);
        const n = m ? Number(m[1]) : NaN;
        // 다음 번호(또는 그다음 번호: 번호 하나가 통째로 안 읽힌 경우)와 비슷하게 생긴 줄
        let ocrNum = null;
        let ocr = null;
        if (!(m && n > last && n - last <= 6)) {
          for (const e of [last + 1, last + 2]) {
            ocr = TransYbCore.ocrNoteStart(t, e);
            if (ocr !== null) {
              ocrNum = e;
              break;
            }
          }
        }
        if (m && n > last && n - last <= 6) {
          if (cur) putNote(cur.num, cur.text);
          cur = { num: m[1], text: "" };
          add(cur, t.slice(m[0].length));
          last = n;
        } else if (ocr !== null) {
          if (cur) putNote(cur.num, cur.text);
          cur = { num: String(ocrNum), text: "" };
          add(cur, ocr);
          last = ocrNum;
        } else if (cur) {
          add(cur, t);
        }
      });
    });
    if (cur) putNote(cur.num, cur.text);
    // 2) 페이지 아래 각주(작은 글씨)
    pages.forEach((lines) => {
      const hs = lines.map((l) => l.h).filter(Boolean).sort((a, b) => a - b);
      if (!hs.length) return;
      const med = hs[Math.floor(hs.length / 2)];
      let fc = null;
      const half = Math.floor(lines.length * 0.5);
      lines.forEach((ln, li) => {
        const t = ln.text.trim();
        if (li < half || !t || boiler(t) || !(ln.h < med * 0.9)) {
          if (fc && li >= half && !(ln.h < med * 0.9)) {
            putNote(fc.num, fc.text);
            fc = null;
          }
          return;
        }
        const m = TransYbCore.NOTE_START.exec(t);
        if (m) {
          if (fc) putNote(fc.num, fc.text);
          fc = { num: m[1], text: "" };
          add(fc, t.slice(m[0].length));
        } else if (fc) add(fc, t);
      });
      if (fc) putNote(fc.num, fc.text);
    });
    return notes;
  },

  // 글자 인식 오류로 번호가 망가진 줄(SAccording = 5According, 121n = 12In)을 다음 번호로 알아봐요.
  // 맞으면 번호 뒤의 내용을, 아니면 null 을 돌려줘요.
  ocrNoteStart(t, expected) {
    const exp = String(expected);
    const head = t.slice(0, exp.length).replace(/[Ss]/g, "5").replace(/[lI|]/g, "1").replace(/O/g, "0");
    if (head !== exp) return null;
    let rest = t.slice(exp.length);
    if (/^[1l]n\s/.test(rest)) rest = "In" + rest.slice(2); // 1n -> In
    if (!/^[\p{Lu}"“‘'(]/u.test(rest)) return null;
    if (head === t.slice(0, exp.length) && /^\p{Lu}/u.test(rest)) return rest; // 이미 정상(위에서 걸렀어야 함)
    return rest;
  },

  // PDF 글자 조각을 줄로 묶어요(각주 찾기용, 간단한 방식)
  itemsToLines(items) {
    const lines = [];
    let cur = null;
    for (const it of items) {
      const y = it.t[5];
      if (!cur || Math.abs(y - cur.y) > Math.max(it.h, cur.h) * 0.5) {
        cur = { parts: [], y, h: it.h };
        lines.push(cur);
      }
      const x = it.t[4];
      if (cur.parts.length && cur.endX !== undefined && x - cur.endX > it.h * 0.15 && !/\s$/.test(cur.parts[cur.parts.length - 1])) {
        cur.parts.push(" ");
      }
      cur.parts.push(it.str);
      cur.endX = x + (it.w || 0);
      cur.h = Math.max(cur.h, it.h);
    }
    return lines.map((l) => ({ text: l.parts.join("").replace(/\s+/g, " ").trim(), y: l.y, h: l.h }));
  },

  // 글자 위치(offset)가 몇 번째 문장에 들어가는지 찾아요.
  sentenceAt(sentences, offset) {
    for (let i = 0; i < sentences.length; i++) {
      if (offset >= sentences[i].start && offset < sentences[i].end) return i;
    }
    // 문장 사이 공백이면 바로 앞 문장
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (offset >= sentences[i].end) return i;
    }
    return -1;
  },

  // 한 문장이 어떤 조각의 어느 부분에 걸쳐 있는지 계산해요.
  // 결과: [{piece: 조각 번호, from: 원래 글자 시작, to: 원래 글자 끝}]
  piecesForSentence(ranges, sentence) {
    const out = [];
    ranges.forEach((r, idx) => {
      if (!r) return;
      const s = Math.max(sentence.start, r.start);
      const e = Math.min(sentence.end, r.end);
      if (e <= s) return;
      const localS = s - r.start;
      const localE = e - r.start;
      out.push({ piece: idx, from: r.map[localS], to: r.map[localE - 1] + 1 });
    });
    return out;
  },

  // 색 변환: HSV(색상 0~360, 진하기 0~1, 밝기 0~1) <-> "#rrggbb"
  // 정사각형 색 고르기에서 가로가 진하기, 세로가 밝기예요.
  hsvToHex(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
    return "#" + to(f(5)) + to(f(3)) + to(f(1));
  },

  hexToHsv(hex) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex).trim());
    if (!m) return null;
    let x = m[1];
    if (x.length === 3) x = x.split("").map((c) => c + c).join("");
    const r = parseInt(x.slice(0, 2), 16) / 255;
    const g = parseInt(x.slice(2, 4), 16) / 255;
    const b = parseInt(x.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max, hex: "#" + x.toLowerCase() };
  },

  // 번역할 문장들을 URL 길이에 맞게 묶어요.
  chunk(sentences, maxChars) {
    const chunks = [];
    let cur = [];
    let len = 0;
    for (const s of sentences) {
      if (cur.length && len + s.length + 1 > maxChars) {
        chunks.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(s);
      len += s.length + 1;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  },
};

if (typeof module !== "undefined") module.exports = TransYbCore;

/* ------------------------------------------------------------------ */
/* 2. 조테로와 연결하는 부분                                            */
/* ------------------------------------------------------------------ */
var TransYb = {
  id: null,
  rootURI: null,
  paneID: null,
  HTML: "http://www.w3.org/1999/xhtml",
  PREF: "extensions.trans_yb.",
  STYLE_ID: "trans_yb-style",
  HL_NAME: "trans_yb",

  // 논문(reader)마다 번역 결과를 기억해요. key: itemID -> Map(pageIndex -> 페이지 정보)
  cache: new Map(),
  // PDF 화면에 붙인 이벤트들 (끌 때 정리용)
  hooked: new Set(),
  cleanups: [],
  panes: new Set(),

  LANGS: [
    ["ko", "한국어"],
    ["en", "영어"],
    ["ja", "일본어"],
    ["zh-CN", "중국어"],
    ["da", "덴마크어"],
    ["es", "스페인어"],
  ],

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
  },

  log(msg) {
    Zotero.debug("[TransYb] " + msg);
  },

  // 문제를 찾기 쉽도록 조테로 데이터 폴더(~/Zotero)의 trans_yb-log.txt 에도 적어요.
  logLines: [],
  logLoaded: null,
  fileLog(msg) {
    this.log(msg);
    try {
      const path0 = Zotero.DataDirectory.dir + "/trans_yb-log.txt";
      if (!this.logLoaded) {
        // 처음 한 번은 예전 기록을 읽어 와서 이어 적어요.
        this.logLoaded = Zotero.File.getContentsAsync(path0)
          .then((old) => {
            const prev = String(old || "").split("\n").filter(Boolean).slice(-300).map((l) => l + "\n");
            this.logLines = prev.concat(this.logLines);
          })
          .catch(() => {});
      }
      this.logLines.push(new Date().toISOString() + "  " + msg + "\n");
      if (this.logLines.length > 500) this.logLines.splice(0, this.logLines.length - 500);
      const path = Zotero.DataDirectory.dir + "/trans_yb-log.txt";
      this.logLoaded.then(() =>
        Zotero.File.putContentsAsync(path, this.logLines.join("")).catch((e) =>
          Zotero.debug("[TransYb] log write failed: " + e)
        )
      );
    } catch (e) {
      Zotero.debug("[TransYb] log failed: " + e);
    }
  },

  errText(e) {
    return (e && (e.stack || e.message)) || String(e);
  },

  pref(name) {
    return Zotero.Prefs.get(this.PREF + name, true);
  },
  setPref(name, value) {
    Zotero.Prefs.set(this.PREF + name, value, true);
  },

  /* ---------- 창, 사이드바 등록 ---------- */

  addToAllWindows() {
    for (const win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  addToWindow(win) {
    try {
      win.MozXULElement.insertFTLIfNeeded("trans_yb.ftl");
    } catch (e) {
      this.log("ftl insert failed: " + e);
    }
  },

  removeFromWindow(win) {
    try {
      win.document.querySelector('[href="trans_yb.ftl"]')?.remove();
      win.document.getElementById(this.PANE_STYLE_ID)?.remove();
    } catch (e) {}
  },

  registerPane() {
    this.startObserver();
    this.paneID = Zotero.ItemPaneManager.registerSection({
      paneID: "trans_yb-pane",
      pluginID: this.id,
      header: {
        l10nID: "trans_yb-pane-header",
        icon: "chrome://trans_yb/content/icon16-v3.svg",
        darkIcon: "chrome://trans_yb/content/icon16-dark-v3.svg",
      },
      sidenav: {
        l10nID: "trans_yb-pane-sidenav",
        icon: "chrome://trans_yb/content/icon20-v3.svg",
        darkIcon: "chrome://trans_yb/content/icon20-dark-v3.svg",
      },
      onItemChange: ({ tabType, setEnabled }) => {
        setEnabled(tabType === "reader");
      },
      onRender: ({ doc, body }) => {
        try {
          this.renderPane(doc, body);
          this.fileLog("render ok");
        } catch (e) {
          this.fileLog("render failed: " + this.errText(e));
          try {
            body.textContent = "trans_yb 오류: " + (e && e.message ? e.message : e);
          } catch (e2) {}
        }
      },
      onDestroy: ({ body }) => {
        const pane = body._trans_yb;
        if (pane) {
          pane.destroy();
          this.panes.delete(pane);
        }
      },
    });
  },

  shutdown() {
    this.stopObserver();
    for (const pane of this.panes) pane.destroy();
    this.panes.clear();
    if (this.paneID) Zotero.ItemPaneManager.unregisterSection(this.paneID);
    for (const fn of this.cleanups) {
      try {
        fn();
      } catch (e) {}
    }
    this.cleanups = [];
    this.hooked.clear();
    this.cache.clear();
    for (const win of Zotero.getMainWindows()) this.removeFromWindow(win);
  },

  /* ---------- PDF 화면 접근 ---------- */

  readerForDoc(doc) {
    const win = doc.defaultView;
    const tabID = win?.Zotero_Tabs?.selectedID;
    return tabID ? Zotero.Reader.getByTabID(tabID) : null;
  },

  viewer(reader) {
    try {
      const internal = reader?._internalReader;
      const view = internal?._primaryView;
      const iframeWin = view?._iframeWindow;
      if (!iframeWin) return null;
      const raw = iframeWin.wrappedJSObject ?? iframeWin;
      const app = raw.PDFViewerApplication;
      if (!app?.pdfViewer) return null;
      return { iframeWin, doc: iframeWin.document, app, pdfViewer: app.pdfViewer };
    } catch (e) {
      this.log("viewer failed: " + e);
      return null;
    }
  },

  // 한 페이지의 글자 조각(span)들. 글자가 있는 맨 안쪽 span만 골라요.
  pageSpans(v, pageIndex) {
    const pageView = v.pdfViewer.getPageView(pageIndex);
    const layer = pageView?.div?.querySelector(".textLayer");
    if (!layer) return null;
    return Array.from(layer.querySelectorAll("span")).filter(
      (s) => !s.querySelector("span") && s.textContent.length
    );
  },

  // 글자 조각마다 화면 위치를 재요(문단 알아내기에 써요).
  pagePieces(spans) {
    return spans.map((sp) => {
      const r = sp.getBoundingClientRect();
      return { raw: sp.textContent, x: r.left, y: r.top, w: r.width, h: r.height };
    });
  },

  // 현재 화면의 span과 저장해 둔 페이지 글자를 다시 맞춰요(확대/축소하면 span이 새로 만들어져요).
  liveRanges(v, pageIndex, page, spansIn) {
    const spans = spansIn || this.pageSpans(v, pageIndex);
    if (!spans || !page?.ranges) return null;
    if (spans.length !== page.ranges.length) {
      if (!this._warned) this.fileLog(`span mismatch on page ${pageIndex + 1}: screen ${spans.length}, pdf ${page.ranges.length}`);
      this._warned = true;
      return null;
    }
    return { spans, ranges: page.ranges };
  },


  /* ---------- 번역 ---------- */

  // Claude가 알려 준 제목 번호(1부터)를 0부터 세는 번호로 바꾸고 이상한 값은 버려요.
  cleanHeadings(nums, n) {
    if (!Array.isArray(nums)) return null;
    return [...new Set(nums.map((x) => Number(x) - 1).filter((x) => Number.isInteger(x) && x >= 0 && x < n))];
  },

  // 엔진 고르기
  async translatePage(sentences, target, ctx) {
    if ((this.pref("engine") || "claude-code") === "claude-code") {
      const r = await this.claudeCodeTranslate(sentences, target, ctx);
      return { lines: r.lines, headings: r.headings, bylines: r.bylines, lang: null, engine: "Claude Code" };
    }
    if (this.pref("engine") === "codex") {
      const r = await this.codexTranslate(sentences, target, ctx);
      return { lines: r.lines, headings: r.headings, bylines: r.bylines, lang: null, engine: "Codex" };
    }
    if (this.pref("engine") === "claude") {
      const r = await this.claudeTranslate(sentences, target, ctx);
      return { lines: r.lines, headings: r.headings, bylines: r.bylines, lang: null, engine: "Claude" };
    }
    const res = await this.translateBatch(sentences, target);
    return { ...res, engine: "Google" };
  },

  LANG_NAMES: {
    ko: "Korean", en: "English", ja: "Japanese", "zh-CN": "Simplified Chinese",
    da: "Danish", es: "Spanish",
  },

  claudePrompt(sentences, target, ctx) {
    const lang = this.LANG_NAMES[target] || target;
    const units = ctx?.units || sentences.map((_, i) => ({ para: i, kind: "body" }));
    const system =
      `You translate academic papers into ${lang} for an academic reader. ` +
      `Translation quality comes first: the result must read as natural, precise ${lang} academic writing ` +
      `that a scholar in the field would accept. ` +
      `The page is given as paragraphs. Each paragraph is labeled with its type and contains numbered items ` +
      `(sentences of body text, or a whole heading or reference entry). ` +
      `Before translating, read the whole page, the paper title, and the context from the previous page, ` +
      `and understand each paragraph as a unit of meaning: who "it", "this", "they" refer to, ` +
      `how sentences connect, what each technical term means in this field. ` +
      `Then translate item by item, so that translation n corresponds to item [n] and, ` +
      `read in order, the translations of a paragraph form one natural, connected ${lang} paragraph ` +
      `(use connectives and word order that flow across sentence boundaries; do not translate each sentence in isolation). ` +
      `Keep established academic terms in the conventional ${lang} rendering used in sociology` +
      (target === "ko" ? ` (e.g. intimacy -> 친밀성, social capital -> 사회자본), and add the original term in parentheses the first time a key concept appears on the page` : "") +
      `. Keep citations such as (Giddens 1992), numbers, and formulas exactly as they are. ` +
      `Footnote reference numbers appear glued to a word or punctuation mark (e.g. "Mother14", "market.4"); ` +
      `keep each one glued, with no space, right after the corresponding word or clause in the translation (e.g. "훈이 엄마14", "참여하고 있었다.4"). ` +
      (target === "ko" ? `Write in Korean academic prose ending in "-다". ` : "") +
      `Headings: translate concisely. ` +
      `Author names: write the ${lang} transliteration followed by the original name in parentheses, ` +
      (target === "ko" ? `e.g. "앨런 김(Allen Kim)"; affiliations likewise, e.g. "국제기독교대학(International Christian University), 일본". ` : `. `) +
      `When one item holds several authors or affiliations, put each author with their affiliation on its own line (separate lines with "\n"). ` +
      `Reference entries: keep author names, years, journal or publisher names, volume, and page numbers in the original, ` +
      `and translate only the title, followed by the original title in parentheses. ` +
      `Page numbers, running headers, and footers ("other"): copy unchanged. ` +
      `Notes (footnotes or endnotes): translate fully, and keep the note number at the very start followed by a space (e.g. "14 우리는 …"). ` +
      `Page breaks: a sentence that is cut by a page break is given to you already joined into one complete item ` +
      `(its end comes from the next page). Translate it as one complete, grammatical sentence; never leave it unfinished ` +
      `and never translate only the part before the break. ` +
      `The first paragraph of this page may continue the previous page's last paragraph: translate it as a continuation ` +
      `(keep the same referents and terms, do not start as if a new topic). ` +
      `Use the next-page context only to understand how the last paragraph continues. ` +
      `Return exactly one translation per item, in order; never merge, split, or skip items. ` +
      `Also return "headings": the numbers of the items that are real titles or section headings in context ` +
      `(the paper title, including on a cover page, and section or subsection titles). An item labeled "heading" above is only a guess from the layout: ` +
      `include it only if it truly works as a heading. Never include ordinary sentences, the first line of a page, ` +
      `author names, journal names, running headers, figure captions, or reference entries. ` +
      `Also return "bylines": the numbers of the items that are author names or author affiliations.`;
    const parts = [];
    if (ctx?.title) parts.push(`Paper title: ${ctx.title}`);
    if (ctx?.prev) parts.push(`Context from the previous page, last paragraph (do not translate):\n${ctx.prev}`);
    if (ctx?.next) parts.push(`Context from the next page, first paragraph (do not translate):\n${ctx.next}`);
    const label = { body: "body paragraph", heading: "heading", ref: "reference entry", note: "note (footnote or endnote)", other: "page number / header / footer" };
    const lines = [];
    let lastPara = null;
    let pn = 0;
    sentences.forEach((sent, i) => {
      const u = units[i] || { para: i, kind: "body" };
      if (u.para !== lastPara) {
        pn++;
        lines.push(`\n<paragraph ${pn}: ${label[u.kind] || "body paragraph"}>`);
        lastPara = u.para;
      }
      lines.push(`[${i + 1}] ${sent}`);
    });
    parts.push(`Translate these ${sentences.length} items:` + lines.join("\n"));
    return { system, user: parts.join("\n\n") };
  },

  // Claude에 페이지 전체를 한 번에 보내서, 앞뒤 맥락을 보고 문장마다 번역하게 해요.
  // 결과는 JSON 형식으로 강제해서 문장 수가 어긋나지 않게 해요.
  async claudeTranslate(sentences, target, ctx) {
    const key = String(this.pref("anthropicKey") || "").trim();
    if (!key) {
      const err = new Error("Claude API 키가 없어요. 아래 설정에서 키를 넣어 주세요.");
      err.userFacing = true;
      throw err;
    }
    const { system, user } = this.claudePrompt(sentences, target, ctx);
    const body = {
      model: this.pref("claudeModel") || "claude-opus-5-5",
      max_tokens: 16000,
      fallbacks: "default",
      system,
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              translations: { type: "array", items: { type: "string" } },
              headings: { type: "array", items: { type: "integer" } },
              bylines: { type: "array", items: { type: "integer" } },
            },
            required: ["translations", "headings", "bylines"],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: "user", content: user }],
    };
    let xhr;
    try {
      xhr = await Zotero.HTTP.request("POST", "https://api.anthropic.com/v1/messages", {
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2026-10-21",
          "anthropic-beta": "server-side-fallback-2026-07-01",
        },
        body: JSON.stringify(body),
        responseType: "json",
        timeout: 180000,
        successCodes: false,
      });
    } catch (e) {
      const err = new Error("Claude 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
      err.userFacing = true;
      throw err;
    }
    const data = xhr.response;
    if (xhr.status !== 200) {
      const apiMsg = data?.error?.message || "";
      this.fileLog(`claude http ${xhr.status}: ${apiMsg}`);
      const msg =
        xhr.status === 401 ? "API 키가 맞지 않아요. 키를 다시 확인해 주세요." :
        xhr.status === 429 ? "요청이 너무 많아요. 잠시 뒤 다시 눌러 주세요." :
        xhr.status === 400 ? "요청 형식 오류예요: " + apiMsg :
        xhr.status >= 500 ? "Claude 서버가 바빠요. 잠시 뒤 다시 눌러 주세요." :
        `Claude 오류 (${xhr.status}): ${apiMsg}`;
      const err = new Error(msg);
      err.userFacing = true;
      throw err;
    }
    if (data?.stop_reason === "refusal") {
      const err = new Error("Claude가 이 페이지 번역을 거절했어요. Google 번역으로 바꿔 시도해 주세요.");
      err.userFacing = true;
      throw err;
    }
    if (data?.stop_reason === "max_tokens") {
      const err = new Error("번역이 길어서 중간에 끊겼어요.");
      err.userFacing = true;
      throw err;
    }
    const textBlock = (data?.content || []).find((b) => b.type === "text");
    let list;
    let headings = null;
    try {
      const out = JSON.parse(textBlock?.text || "");
      list = out.translations;
      headings = out.headings;
      var bylinesApi = out.bylines;
    } catch (e) {
      list = null;
    }
    if (!Array.isArray(list) || list.length !== sentences.length) {
      this.fileLog(`claude count mismatch: got ${list?.length} expected ${sentences.length}`);
      const err = new Error(`번역 문장 수가 맞지 않아요 (${list?.length ?? 0}/${sentences.length}). 다시 눌러 주세요.`);
      err.userFacing = true;
      throw err;
    }
    this.fileLog(`claude ok: ${sentences.length} sentences, model ${data.model}, out ${data.usage?.output_tokens} tokens`);
    return { lines: list.map((x) => String(x)), headings: this.cleanHeadings(headings, list.length), bylines: this.cleanHeadings(bylinesApi, list.length) };
  },

  // 이 맥에 깔린 Claude Code 프로그램 위치를 찾아요.
  findClaudeCode() {
    const custom = String(this.pref("claudeCodePath") || "").trim();
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    const candidates = [];
    if (custom) candidates.push(custom);
    candidates.push(
      home + "/.local/bin/claude",
      home + "/.claude/local/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude"
    );
    // VS Code / Cursor 확장에 같이 깔린 Claude Code (버전마다 폴더 이름이 달라서 가장 최근 것을 골라요)
    for (const extDir of [home + "/.vscode/extensions", home + "/.cursor/extensions"]) {
      try {
        const dir = Zotero.File.pathToFile(extDir);
        if (!dir.exists()) continue;
        const found = [];
        const entries = dir.directoryEntries;
        while (entries.hasMoreElements()) {
          const f = entries.nextFile;
          if (f.leafName.startsWith("anthropic.claude-code-")) {
            found.push({ path: f.path + "/resources/native-binary/claude", time: f.lastModifiedTime });
          }
        }
        found.sort((x, y) => y.time - x.time);
        candidates.push(...found.map((x) => x.path));
      } catch (e) {}
    }
    for (const c of candidates) {
      try {
        const f = Zotero.File.pathToFile(c);
        if (f.exists() && f.isExecutable()) return c;
      } catch (e) {}
    }
    return null;
  },

  // Claude Code를 "한 번 물어보고 끝내는" 방식(-p)으로 실행해요. 로그인된 계정을 쓰므로 API 키가 필요 없어요.
  async claudeCodeTranslate(sentences, target, ctx) {
    const fail = (msg) => {
      const err = new Error(msg);
      err.userFacing = true;
      return err;
    };
    const bin = this.findClaudeCode();
    if (!bin) throw fail("이 맥에서 Claude Code를 찾지 못했어요. 번역 엔진 설정에서 다른 엔진을 골라 주세요.");
    const { system, user } = this.claudePrompt(sentences, target, ctx);
    const schema = JSON.stringify({
      type: "object",
      properties: {
        translations: { type: "array", items: { type: "string" } },
        headings: { type: "array", items: { type: "integer" } },
        bylines: { type: "array", items: { type: "integer" } },
      },
      required: ["translations", "headings", "bylines"],
      additionalProperties: false,
    });
    const args = [
      "-p",
      "--output-format", "json",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--tools", "",
      "--json-schema", schema,
      "--system-prompt", system,
      user,
    ];
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    let proc;
    try {
      proc = await Subprocess.call({
        command: bin,
        arguments: args,
        workdir: Zotero.DataDirectory.dir,
        environment: {
          HOME: home,
          PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + home + "/.local/bin",
        },
        environmentAppend: true,
        stderr: "pipe",
      });
    } catch (e) {
      this.fileLog("claude code start failed: " + this.errText(e));
      throw fail("Claude Code를 실행하지 못했어요.");
    }
    proc.stdin.close();
    const readAll = async (pipe) => {
      let out = "";
      let chunk;
      while ((chunk = await pipe.readString())) out += chunk;
      return out;
    };
    const [stdout, stderr] = await Promise.all([readAll(proc.stdout), readAll(proc.stderr)]);
    const { exitCode } = await proc.wait();
    let data = null;
    try {
      data = JSON.parse(stdout);
    } catch (e) {}
    if (!data || data.is_error || exitCode !== 0) {
      const detail = (data && data.result) || stderr || stdout || "exit " + exitCode;
      this.fileLog("claude code error: " + String(detail).slice(0, 500));
      if (/log ?in|auth|credential/i.test(detail)) {
        throw fail("Claude Code에 로그인이 안 되어 있어요. 터미널이나 VS Code에서 Claude Code에 로그인해 주세요.");
      }
      if (/limit|quota|usage/i.test(detail)) {
        throw fail("Claude Code 사용 한도에 걸렸어요. 잠시 뒤 다시 눌러 주세요.");
      }
      throw fail("Claude Code 번역에 실패했어요: " + String(detail).slice(0, 120));
    }
    let out = data.structured_output;
    if (!out || !Array.isArray(out.translations)) {
      try {
        out = JSON.parse(data.result);
      } catch (e) {}
    }
    const list = out?.translations;
    if (!Array.isArray(list) || list.length !== sentences.length) {
      this.fileLog(`claude code count mismatch: got ${list?.length} expected ${sentences.length}`);
      throw fail(`번역 문장 수가 맞지 않아요 (${list?.length ?? 0}/${sentences.length}). 다시 눌러 주세요.`);
    }
    const u = data.usage || {};
    this.fileLog(
      `claude code ok: ${sentences.length} sentences, ${data.duration_ms} ms, ` +
        `in ${(u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)} / out ${u.output_tokens || 0} tokens, ` +
        `list price $${Number(data.total_cost_usd || 0).toFixed(4)}`
    );
    return { lines: list.map((x) => String(x)), headings: this.cleanHeadings(out?.headings, list.length), bylines: this.cleanHeadings(out?.bylines, list.length) };
  },

  // 지금 고른 엔진에 짧은 질문을 하고 JSON 으로 답을 받아요(부분 짝 찾기에 써요). Google 이면 null.
  async askJSON(system, user, schema) {
    const engine = this.pref("engine") || "claude-code";
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    const env = { HOME: home, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + home + "/.local/bin" };
    const run = async (bin, args, workdir) => {
      const proc = await Subprocess.call({ command: bin, arguments: args, workdir, environment: env, environmentAppend: true, stderr: "stdout" });
      proc.stdin.close();
      let out = "";
      let chunk;
      while ((chunk = await proc.stdout.readString())) out += chunk;
      const { exitCode } = await proc.wait();
      return { out, exitCode };
    };
    if (engine === "claude-code") {
      const bin = this.findClaudeCode();
      if (!bin) return null;
      const r = await run(
        bin,
        ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--tools", "",
          "--json-schema", JSON.stringify(schema), "--system-prompt", system, user],
        Zotero.DataDirectory.dir
      );
      try {
        const d = JSON.parse(r.out);
        return d.structured_output || JSON.parse(d.result);
      } catch (e) {
        this.fileLog("askJSON claude code failed: " + r.out.slice(-300));
        return null;
      }
    }
    if (engine === "codex") {
      const bin = this.findCodex();
      if (!bin) return null;
      const work = Zotero.DataDirectory.dir + "/trans_yb/codex";
      await Zotero.File.createDirectoryIfMissingAsync(work, { from: Zotero.DataDirectory.dir });
      const sp = work + "/ask-schema.json";
      await Zotero.File.putContentsAsync(sp, JSON.stringify(schema));
      const op = work + "/ask-" + Date.now() + ".txt";
      const r = await run(bin, ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", work, "--output-schema", sp, "-o", op, system + "\n\n" + user], work);
      try {
        const d = JSON.parse(await Zotero.File.getContentsAsync(op));
        Zotero.File.removeIfExists(op);
        return d;
      } catch (e) {
        this.fileLog("askJSON codex failed: " + r.out.slice(-300));
        return null;
      }
    }
    if (engine === "claude") {
      const key = String(this.pref("anthropicKey") || "").trim();
      if (!key) return null;
      const xhr = await Zotero.HTTP.request("POST", "https://api.anthropic.com/v1/messages", {
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2026-10-21" },
        body: JSON.stringify({
          model: this.pref("claudeModel") || "claude-opus-5-5",
          max_tokens: 2000,
          system,
          output_config: { effort: "low", format: { type: "json_schema", schema } },
          messages: [{ role: "user", content: user }],
        }),
        responseType: "json",
        timeout: 60000,
        successCodes: false,
      });
      try {
        return JSON.parse((xhr.response?.content || []).find((b) => b.type === "text")?.text || "");
      } catch (e) {
        return null;
      }
    }
    return null;
  },

  ALIGN_SYSTEM:
    "You align a translation with its source sentence. You receive a source sentence, its translation, and a selected part of one of them. " +
    "Return the exact contiguous substring of the other text that expresses the same meaning as the selected part. " +
    "Copy it character for character from that text (same spelling, punctuation, and spacing). Keep it as short as the meaning allows.",

  // 번역문 일부 -> 원문의 같은 부분(페이지 글자 위치 [시작, 끝]). 못 찾으면 null(문장 전체로 해요).
  async alignToSource(page, uIdx, koFrom, koTo) {
    const ko = page.lines[uIdx] || "";
    const unit = page.sentences[uIdx];
    const part = ko.slice(koFrom, koTo).trim();
    if (!part || (koFrom <= 0 && koTo >= ko.trim().length)) return null;
    const src = TransYbCore.unitSource(page.text, unit, page.soft);
    const ans = await this.askJSON(
      this.ALIGN_SYSTEM,
      `Source sentence:\n${src}\n\nTranslation:\n${ko}\n\nSelected part of the translation:\n${part}\n\nReturn {"match": the corresponding substring of the SOURCE sentence}.`,
      { type: "object", properties: { match: { type: "string" } }, required: ["match"], additionalProperties: false }
    );
    if (!ans?.match) return null;
    const r = TransYbCore.findInUnit(page.text, unit, page.soft, ans.match);
    this.fileLog(`align ko->src: "${part.slice(0, 30)}" -> "${String(ans.match).slice(0, 40)}" ${r ? "found" : "not found"}`);
    return r ? { start: r[0], end: r[1], text: ans.match } : null;
  },

  // 원문 일부 -> 번역문의 같은 부분 [from, to]. 못 찾으면 null(문장 전체로 해요).
  async alignToTarget(page, uIdx, srcPart) {
    const ko = page.lines[uIdx] || "";
    const src = TransYbCore.unitSource(page.text, page.sentences[uIdx], page.soft);
    const ans = await this.askJSON(
      this.ALIGN_SYSTEM,
      `Source sentence:\n${src}\n\nTranslation:\n${ko}\n\nSelected part of the source:\n${srcPart}\n\nReturn {"match": the corresponding substring of the TRANSLATION}.`,
      { type: "object", properties: { match: { type: "string" } }, required: ["match"], additionalProperties: false }
    );
    const m = String(ans?.match || "").trim();
    const k = m ? ko.indexOf(m) : -1;
    this.fileLog(`align src->ko: "${srcPart.slice(0, 30)}" -> "${m.slice(0, 30)}" ${k >= 0 ? "found" : "not found"}`);
    return k >= 0 ? [k, k + m.length] : null;
  },

  // 이 맥에 깔린 Codex 프로그램 위치를 찾아요.
  findCodex() {
    const custom = String(this.pref("codexPath") || "").trim();
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    const candidates = [];
    if (custom) candidates.push(custom);
    candidates.push("/opt/homebrew/bin/codex", "/usr/local/bin/codex", home + "/.local/bin/codex");
    // VS Code / Cursor 의 ChatGPT(Codex) 확장에 같이 깔린 Codex (가장 최근 것)
    for (const extDir of [home + "/.vscode/extensions", home + "/.cursor/extensions"]) {
      try {
        const dir = Zotero.File.pathToFile(extDir);
        if (!dir.exists()) continue;
        const found = [];
        const entries = dir.directoryEntries;
        while (entries.hasMoreElements()) {
          const f = entries.nextFile;
          if (f.leafName.startsWith("openai.chatgpt-")) {
            for (const arch of ["macos-aarch64", "macos-x86_64"]) {
              found.push({ path: f.path + "/bin/" + arch + "/codex", time: f.lastModifiedTime });
            }
          }
        }
        found.sort((x, y) => y.time - x.time);
        candidates.push(...found.map((x) => x.path));
      } catch (e) {}
    }
    for (const c of candidates) {
      try {
        const f = Zotero.File.pathToFile(c);
        if (f.exists() && f.isExecutable()) return c;
      } catch (e) {}
    }
    return null;
  },

  // Codex 를 "한 번 물어보고 끝내는" 방식(codex exec)으로 실행해요. 로그인된 ChatGPT 계정을 써요.
  // 파일을 고치지 못하게 읽기 전용으로 실행하고, 결과는 정해진 JSON 형식으로만 받아요.
  async codexTranslate(sentences, target, ctx) {
    const fail = (msg) => this.userErr(msg);
    const bin = this.findCodex();
    if (!bin) throw fail("이 맥에서 Codex를 찾지 못했어요. 번역 엔진 설정에서 다른 엔진을 골라 주세요.");
    const { system, user } = this.claudePrompt(sentences, target, ctx);
    const work = Zotero.DataDirectory.dir + "/trans_yb/codex";
    await Zotero.File.createDirectoryIfMissingAsync(work, { from: Zotero.DataDirectory.dir });
    const schemaPath = work + "/schema.json";
    await Zotero.File.putContentsAsync(
      schemaPath,
      JSON.stringify({
        type: "object",
        properties: {
          translations: { type: "array", items: { type: "string" } },
          headings: { type: "array", items: { type: "integer" } },
          bylines: { type: "array", items: { type: "integer" } },
        },
        required: ["translations", "headings", "bylines"],
        additionalProperties: false,
      })
    );
    const outPath = work + "/out-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".txt";
    const prompt =
      system +
      `\n\nReturn only JSON: {"translations": [one string per item], "headings": [item numbers that are real headings], "bylines": [item numbers that are author names or affiliations]}.\n\n` +
      user;
    const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", work, "--output-schema", schemaPath, "-o", outPath, prompt];
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    let proc;
    const started = Date.now();
    try {
      proc = await Subprocess.call({
        command: bin,
        arguments: args,
        workdir: work,
        environment: {
          HOME: home,
          PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + home + "/.local/bin",
        },
        environmentAppend: true,
        stderr: "stdout",
      });
    } catch (e) {
      this.fileLog("codex start failed: " + this.errText(e));
      throw fail("Codex를 실행하지 못했어요.");
    }
    proc.stdin.close(); // 닫지 않으면 Codex가 입력을 기다리며 멈춰요
    let log = "";
    let chunk;
    while ((chunk = await proc.stdout.readString())) log += chunk;
    const { exitCode } = await proc.wait();
    let out = null;
    try {
      out = JSON.parse(await Zotero.File.getContentsAsync(outPath));
    } catch (e) {}
    try {
      Zotero.File.removeIfExists(outPath);
    } catch (e) {}
    if (!out || exitCode !== 0) {
      const tail = log.slice(-600);
      this.fileLog("codex error (exit " + exitCode + "): " + tail.replace(/\s+/g, " "));
      if (/log ?in|auth|sign in|unauthorized/i.test(tail)) throw fail("Codex에 로그인이 안 되어 있어요. 터미널에서 codex login 을 해 주세요.");
      if (/limit|quota|usage|rate/i.test(tail)) throw fail("Codex 사용 한도에 걸렸어요. 잠시 뒤 다시 눌러 주세요.");
      throw fail("Codex 번역에 실패했어요.");
    }
    const list = out.translations;
    if (!Array.isArray(list) || list.length !== sentences.length) {
      this.fileLog(`codex count mismatch: got ${list?.length} expected ${sentences.length}`);
      throw fail(`번역 문장 수가 맞지 않아요 (${list?.length ?? 0}/${sentences.length}). 다시 눌러 주세요.`);
    }
    const used = /tokens used\s*\n?\s*([\d,]+)/i.exec(log);
    this.fileLog(`codex ok: ${sentences.length} sentences, ${Date.now() - started} ms` + (used ? `, ${used[1]} tokens` : ""));
    return { lines: list.map((x) => String(x)), headings: this.cleanHeadings(out.headings, list.length), bylines: this.cleanHeadings(out.bylines, list.length) };
  },

  async translateBatch(sentences, target) {
    const chunks = TransYbCore.chunk(sentences, 1200);
    const out = [];
    let detected = null;
    for (const chunk of chunks) {
      const res = await this.googleTranslate(chunk.join("\n"), target);
      detected = detected || res.lang;
      let lines = res.text.split("\n");
      if (lines.length !== chunk.length) {
        // 문장 수가 어긋나면 한 문장씩 다시 번역해요.
        this.log(`line mismatch ${lines.length} vs ${chunk.length}, retry one by one`);
        lines = [];
        for (const s of chunk) {
          lines.push((await this.googleTranslate(s, target)).text);
          await Zotero.Promise.delay(150);
        }
      }
      out.push(...lines);
      if (chunks.length > 1) await Zotero.Promise.delay(200);
    }
    return { lines: out, lang: detected };
  },

  async googleTranslate(text, target) {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
      encodeURIComponent(target) +
      "&dt=t&q=" +
      encodeURIComponent(text);
    const xhr = await Zotero.HTTP.request("GET", url, { responseType: "json", timeout: 30000 });
    const data = xhr.response;
    const parts = (data?.[0] || []).map((p) => p?.[0] || "");
    return { text: parts.join("").trim(), lang: data?.[2] || null };
  },

  /* ---------- 페이지 준비, 저장, 미리 번역 ----------
   * 화면에 안 뜬 페이지도 PDF에서 글자와 위치를 바로 읽어서 번역할 수 있어요.
   * 번역 결과는 ~/Zotero/trans_yb/cache/<첨부파일 키>.json 에 저장해서, 다시 열어도 바로 보여요.
   */
  layouts: new Map(), // "itemID:page" -> 문단 정보
  inflight: new Map(), // "itemID:page:언어" -> 진행 중인 번역
  disk: new Map(), // itemID -> { key, pages, underlines }
  started: new Set(), // 번역을 한 번이라도 시작한 논문(자동 번역용)
  slots: 2, // 동시에 번역하는 페이지 수
  running: 0,
  waiting: [],
  queue: null,

  userErr(msg) {
    const err = new Error(msg);
    err.userFacing = true;
    return err;
  },

  pdfDocument(reader) {
    const v = this.viewer(reader);
    return v?.pdfViewer?.pdfDocument || v?.app?.pdfDocument || null;
  },

  numPages(reader) {
    return Number(this.pdfDocument(reader)?.numPages) || 0;
  },

  // PDF 한 페이지의 글자 조각과 위치를 읽어요(화면에 안 떠 있어도 돼요).
  async pageItems(reader, pageIndex) {
    const v = this.viewer(reader);
    const pdfDoc = this.pdfDocument(reader);
    if (!pdfDoc?.getPage) throw this.userErr("PDF를 아직 다 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    const page = await pdfDoc.getPage(pageIndex + 1);
    const rp = page?.wrappedJSObject ?? page;
    let content;
    try {
      // 화면의 글자층과 똑같이 읽으려고 글자 정규화를 꺼요.
      content = await rp.getTextContent(Components.utils.cloneInto({ disableNormalization: true }, v.iframeWin));
    } catch (e) {
      content = await rp.getTextContent();
    }
    const rc = content?.wrappedJSObject ?? content;
    const rawItems = rc?.items?.wrappedJSObject ?? rc?.items ?? [];
    const items = [];
    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const str = it?.str;
      if (typeof str !== "string" || !str.length) continue;
      const t = Array.from(it.transform || [1, 0, 0, 1, 0, 0]).map(Number);
      items.push({ str: String(str), t, w: Number(it.width) || 0, h: Number(it.height) || Math.hypot(t[2], t[3]) || 10, font: String(it.fontName || "") });
    }
    // 옆으로 눕혀 스캔한 페이지면 글자를 화면에 보이는 방향으로 바로 세워요.
    const upr = TransYbCore.uprightItems(items, Array.from(rp.view || [0, 0, 612, 792]).map(Number));
    const view = upr.view;
    // 스캔 PDF 의 OCR 글자 폭이 눌려 있으면 실제 화면 폭으로 보정해요.
    const fixed = TransYbCore.fixSqueezedWidths(upr.items, view);
    return { items: fixed, pageHeight: view[3] - view[1], pageBottom: view[1], up: upr.up, toPdf: upr.toPdf };
  },

  // 문단 나누기만 한 결과(배우기 전). 옆 페이지와 비교할 때도 써요.
  async rawLayout(reader, pageIndex) {
    this.raws = this.raws || new Map();
    const key = reader.itemID + ":" + pageIndex;
    if (this.raws.has(key)) return this.raws.get(key);
    const { items, pageHeight, pageBottom, up, toPdf } = await this.pageItems(reader, pageIndex);
    const pieces = items.map((it) => ({ raw: it.str, x: it.t[4], y: -it.t[5] - it.h, w: it.w, h: it.h, font: it.font }));
    const raw = { L: TransYbCore.buildLayout(pieces), items, pageHeight, pageBottom, up, toPdf };
    this.raws.set(key, raw);
    return raw;
  },

  // 반복되는 줄을 비교하기 좋게: 소문자, 숫자는 #, 공백 하나
  boilerKey(t) {
    return String(t).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  },

  // 페이지를 문단과 번역 단위로 나눠 둬요.
  // 여러 쪽의 맨 위나 맨 아래에 반복되는 줄(머리말, 꼬리말, 내려받기 안내)은 배워서 번역하지 않아요.
  async buildPage(reader, pageIndex) {
    const key = reader.itemID + ":" + pageIndex;
    if (this.layouts.has(key)) return this.layouts.get(key);
    const raw = await this.rawLayout(reader, pageIndex);
    const L = raw.L;
    const paras = L.paras.map((p) => ({ ...p }));
    const rec = await this.diskFor(reader.itemID);
    rec.boiler = rec.boiler || [];
    // 옆 페이지(앞뒤 두 쪽)의 맨 위/맨 아래 줄 모으기
    const n = this.numPages(reader);
    const seen = new Set();
    for (const q of [pageIndex - 2, pageIndex - 1, pageIndex + 1, pageIndex + 2]) {
      if (q < 0 || (n && q >= n)) continue;
      try {
        const o = (await this.rawLayout(reader, q)).L;
        for (const op of o.paras) if (op.edge) seen.add(this.boilerKey(o.text.slice(op.start, op.end)));
      } catch (e) {}
    }
    // 조테로에 저장된 논문 제목과 같은 문단은 제목으로(맨 위 머리말로 반복되는 제목은 빼요)
    let paperTitle = "";
    try {
      const att = Zotero.Items.get(reader.itemID);
      paperTitle = (att?.parentItem || att)?.getField("title") || "";
    } catch (e) {}
    for (const p of paras) {
      if (p.kind === "other") continue;
      if (TransYbCore.isPaperTitle(L.text.slice(p.start, p.end), paperTitle)) {
        p.kind = "heading";
        p.isTitle = true;
      }
    }
    // 앞 쪽들에 "Notes" 제목이 있고 아직 끝나지 않았으면, 이 쪽의 문단도 주석이에요.
    let notesOpen = false;
    for (let q = pageIndex - 1; q >= Math.max(0, pageIndex - 15); q--) {
      try {
        const ql = (await this.rawLayout(reader, q)).L;
        const kinds = ql.paras.map((pp) => ql.text.slice(pp.start, pp.end).trim());
        if (kinds.some((t) => TransYbCore.NOTES_HEADING.test(t))) {
          notesOpen = ql.notesOpen;
          break;
        }
        if (kinds.some((t) => TransYbCore.NOTES_END.test(t) && t.length < 60)) break;
      } catch (e) {
        break;
      }
    }
    if (notesOpen) {
      for (const p of paras) {
        const t = L.text.slice(p.start, p.end).trim();
        if (TransYbCore.NOTES_END.test(t) && t.length < 60) break;
        if (p.kind === "body" || p.kind === "ref") p.kind = "note";
      }
    }
    let learned = false;
    for (const p of paras) {
      if (!p.edge || p.kind === "other") continue;
      const k = this.boilerKey(L.text.slice(p.start, p.end));
      if (k.length < 4) continue;
      if (rec.boiler.includes(k) || seen.has(k)) {
        p.kind = "other";
        if (!rec.boiler.includes(k)) {
          rec.boiler.push(k);
          learned = true;
        }
      }
    }
    if (learned) {
      this.fileLog(`learned running header/footer on page ${pageIndex + 1}`);
      this.saveDisk(reader.itemID);
    }
    const built = {
      itemID: reader.itemID,
      pageIndex,
      text: L.text,
      soft: L.soft,
      paras,
      ranges: L.ranges,
      sentences: TransYbCore.makeUnits(L.text, paras),
      items: raw.items,
      pageHeight: raw.pageHeight,
      pageBottom: raw.pageBottom,
      up: raw.up,
      toPdf: raw.toPdf,
    };
    // 페이지를 넘는 문장: 앞 쪽 마지막 문장이 안 끝났으면 이 쪽 첫 문장은 그 뒷부분(contPrev),
    // 이 쪽 마지막 문장이 안 끝났으면 다음 쪽 첫 부분까지 합쳐서 번역해요(joinNext).
    const endsS = (t) => /[.!?]["'”’)\]]*[\d¹²³⁰-⁹*†‡]{0,3}$/.test(String(t).trim());
    // 문장이 다음 쪽으로 이어지는지: 본문 문장이 마침표 없이 쪽 끝에서 끊겼으면 이어진 거예요.
    // (뒤 쪽 첫 글자가 대문자 이름이나 숫자여도 이어져요. 예: "...began in" / "Seoul in 1995")
    const flows = (a, b) => !endsS(a) && !!String(b || "").trim() && !/^[•◦▪●‣]/.test(String(b).trim());
    const units = built.sentences;
    const firstIdx = units.findIndex((u) => u.kind !== "other");
    let lastIdx = -1;
    for (let i = units.length - 1; i >= 0; i--) if (units[i].kind !== "other") { lastIdx = i; break; }
    if (firstIdx >= 0 && units[firstIdx].kind === "body" && pageIndex > 0) {
      try {
        const pr = (await this.rawLayout(reader, pageIndex - 1)).L;
        const pu = TransYbCore.makeUnits(pr.text, pr.paras).filter((u) => u.kind !== "other");
        const pl = pu[pu.length - 1];
        if (pl && pl.kind === "body" && flows(TransYbCore.unitSource(pr.text, pl, pr.soft), TransYbCore.unitSource(L.text, units[firstIdx], L.soft))) units[firstIdx].contPrev = true;
      } catch (e) {}
    }
    if (lastIdx >= 0 && units[lastIdx].kind === "body" && !endsS(TransYbCore.unitSource(L.text, units[lastIdx], L.soft)) && (!n || pageIndex + 1 < n)) {
      try {
        const nx = (await this.rawLayout(reader, pageIndex + 1)).L;
        const nf = TransYbCore.makeUnits(nx.text, nx.paras).filter((u) => u.kind !== "other")[0];
        const nxt = nf && TransYbCore.unitSource(nx.text, nf, nx.soft);
        if (nf && nf.kind === "body" && flows(TransYbCore.unitSource(L.text, units[lastIdx], L.soft), nxt)) units[lastIdx].joinNext = { text: nxt };
      } catch (e) {}
    }
    this.layouts.set(key, built);
    return built;
  },

  cacheDir() {
    return Zotero.DataDirectory.dir + "/trans_yb/cache";
  },

  async diskFor(itemID) {
    if (this.disk.has(itemID)) return this.disk.get(itemID);
    const att = Zotero.Items.get(itemID);
    const rec = { key: att?.key || String(itemID), pages: {}, underlines: {} };
    try {
      const j = JSON.parse(await Zotero.File.getContentsAsync(this.cacheDir() + "/" + rec.key + ".json"));
      rec.pages = j.pages || {};
      rec.underlines = j.underlines || {};
      rec.boiler = j.boiler || [];
      rec.notes = j.notes || {};
      rec.meta = j.meta || {};
    } catch (e) {}
    if (Object.keys(rec.pages).length) this.started.add(itemID);
    this.fileLog(`cache loaded for ${rec.key}: ${Object.keys(rec.pages).length} pages`);
    this.disk.set(itemID, rec);
    return rec;
  },

  saveDisk(itemID) {
    const rec = this.disk.get(itemID);
    if (!rec) return;
    const win = Zotero.getMainWindow();
    if (rec._timer) win.clearTimeout(rec._timer);
    rec._timer = win.setTimeout(async () => {
      try {
        await Zotero.File.createDirectoryIfMissingAsync(this.cacheDir(), { from: Zotero.DataDirectory.dir });
        await Zotero.File.putContentsAsync(
          this.cacheDir() + "/" + rec.key + ".json",
          JSON.stringify({ pages: rec.pages, underlines: rec.underlines, boiler: rec.boiler || [], notes: rec.notes || {}, meta: rec.meta || {} })
        );
      } catch (e) {
        this.fileLog("cache save failed: " + this.errText(e));
      }
    }, 600);
  },

  // 저장해 둔 번역이 있으면 꺼내요(새로 번역하지 않아요).
  async loadSaved(reader, pageIndex) {
    const itemID = reader.itemID;
    const target = this.pref("targetLang") || "ko";
    const mem = this.cache.get(itemID)?.get(pageIndex);
    if (mem && mem.target === target) return mem;
    const built = await this.buildPage(reader, pageIndex);
    const rec = await this.diskFor(itemID);
    const entry = rec.pages[pageIndex];
    // 예전 형식({target, lines})도 읽어요.
    const saved = entry?.byTarget ? entry.byTarget[target] : entry?.target === target ? entry : null;
    if (!saved || entry.text !== built.text || saved.lines?.length !== built.sentences.length) {
      return null;
    }
    // 쪽을 넘는 문장이 있는 쪽인데, 문장 합치기(xpage)를 넣기 전에 번역한 것이면 새로 번역해요(잘린 문장으로 번역돼 있어서)
    if ((saved.xpage || 0) < 2 && built.sentences.some((u) => u.joinNext || u.contPrev)) return null;
    const page = { ...built, lines: saved.lines, headings: saved.headings || null, bylines: saved.bylines || null, engine: saved.engine, lang: null, target };
    if (!this.cache.has(itemID)) this.cache.set(itemID, new Map());
    this.cache.get(itemID).set(pageIndex, page);
    return page;
  },

  // 동시에 두 페이지까지만 번역해요. 지금 보는 페이지는 줄 맨 앞으로 보내요.
  acquire(front, key) {
    if (this.running < this.slots) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((res) => {
      const w = { res, key };
      if (front) this.waiting.unshift(w);
      else this.waiting.push(w);
    });
  },
  release() {
    const w = this.waiting.shift();
    if (w) w.res();
    else this.running = Math.max(0, this.running - 1);
  },
  bump(key) {
    const i = this.waiting.findIndex((w) => w.key === key);
    if (i > 0) this.waiting.unshift(...this.waiting.splice(i, 1));
  },

  // 한 페이지 번역을 받아요: 메모리 -> 저장 파일 -> 새로 번역 순서로 찾아요.
  getTranslation(reader, pageIndex, opts = {}) {
    const itemID = reader.itemID;
    const target = this.pref("targetLang") || "ko";
    const mem = this.cache.get(itemID)?.get(pageIndex);
    if (mem && mem.target === target) return Promise.resolve(mem);
    const key = itemID + ":" + pageIndex + ":" + target;
    if (this.inflight.has(key)) {
      if (opts.front) this.bump(key);
      return this.inflight.get(key);
    }
    this.started.add(itemID);
    const p = (async () => {
      const saved = await this.loadSaved(reader, pageIndex);
      if (saved) {
        this.fileLog(`page ${pageIndex + 1}: used saved translation (0 tokens)`);
        return saved;
      }
      const built = await this.buildPage(reader, pageIndex);
      await this.acquire(opts.front, key);
      let page;
      try {
        page = await this.translateBuilt(reader, built, target);
      } finally {
        this.release();
      }
      const rec = await this.diskFor(itemID);
      const old = rec.pages[pageIndex];
      // 이 쪽을 새로 번역했으니, 칠해 둔 표시는 원문 주석을 기준으로 새 번역문에서 위치를 다시 찾아요.
      const marks = rec.underlines?.[pageIndex];
      if (marks?.length) {
        for (const m of marks) m.relocate = true;
        this._repairedPages?.delete(itemID + ":" + pageIndex);
      }
      const byTarget = old?.text === built.text ? { ...(old.byTarget || (old.target ? { [old.target]: old } : {})) } : {};
      byTarget[target] = { engine: page.engine, lines: page.lines, headings: page.headings, bylines: page.bylines, xpage: 2 };
      rec.pages[pageIndex] = { text: built.text, byTarget };
      this.saveDisk(itemID);
      if (!this.cache.has(itemID)) this.cache.set(itemID, new Map());
      this.cache.get(itemID).set(pageIndex, page);
      return page;
    })();
    this.inflight.set(key, p);
    p.then(
      (page) => {
        this.inflight.delete(key);
        for (const pane of this.panes) pane.onPageReady(itemID, pageIndex, page);
      },
      () => this.inflight.delete(key)
    );
    return p;
  },

  // 문단 정보가 준비된 페이지를 실제로 번역해요.
  async translateBuilt(reader, built, target) {
    const ctx = {};
    try {
      const att = Zotero.Items.get(reader.itemID);
      ctx.title = (att?.parentItem || att)?.getField("title") || "";
    } catch (e) {}
    if (built.pageIndex > 0) {
      try {
        // 앞 페이지 마지막 본문 문단(이 페이지 첫 문단이 이어질 수 있어요)
        const prev = await this.buildPage(reader, built.pageIndex - 1);
        const lastBody = [...prev.paras].reverse().find((p) => p.kind === "body");
        if (lastBody) ctx.prev = TransYbCore.unitSource(prev.text, lastBody, prev.soft);
      } catch (e) {}
    }
    if (built.sentences.some((u) => u.joinNext)) {
      try {
        // 다음 쪽 첫 본문 문단(이 쪽 마지막 문장이 그리로 이어져요)
        const next = await this.buildPage(reader, built.pageIndex + 1);
        const firstBody = next.paras.find((p) => p.kind === "body");
        if (firstBody) ctx.next = TransYbCore.unitSource(next.text, firstBody, next.soft);
      } catch (e) {}
    }
    const units = built.sentences;
    // 쪽 번호, 머리말 같은 "other"는 번역하지 않고 그대로 둬요.
    const toSend = units.map((u, i) => i).filter((i) => units[i].kind !== "other" && !units[i].contPrev);
    const srcOf = (i) => {
      const own = TransYbCore.unitSource(built.text, units[i], built.soft);
      const nx = units[i].joinNext?.text;
      if (!nx) return own;
      return /\p{L}-$/u.test(own) && /^\p{Ll}/u.test(nx) ? own.slice(0, -1) + nx : own + " " + nx;
    };
    ctx.units = toSend.map((i) => units[i]);
    const res = !toSend.length
      ? { lines: [], lang: null, engine: null }
      : await this.translatePage(
          toSend.map((i) => srcOf(i)),
          target,
          ctx
        );
    const lines = units.map((u) => (u.contPrev ? "" : TransYbCore.unitSource(built.text, u, built.soft)));
    toSend.forEach((i, k) => (lines[i] = res.lines[k]));
    const headings = Array.isArray(res.headings) ? res.headings.map((k) => toSend[k]) : null;
    const bylines = Array.isArray(res.bylines) ? res.bylines.map((k) => toSend[k]) : null;
    return { ...built, lines, headings, bylines, lang: res.lang, engine: res.engine, target };
  },

  // 지금 페이지 다음 두 쪽을 몰래 미리 번역해 둬요.
  prefetchAhead(reader, pageIndex) {
    if (this.pref("autoNextPage") === false) return; // "자동 번역"을 끄면 미리 번역도 안 해요
    const n = this.numPages(reader);
    for (const pi of [pageIndex + 1, pageIndex + 2]) {
      if (pi < n) this.getTranslation(reader, pi).catch((e) => this.fileLog("prefetch failed: " + (e.message || e)));
    }
  },

  // "미리 번역" 줄: 여러 쪽을 차례로 번역해요.
  async runQueue(reader, pages) {
    if (this.queue && !this.queue.finished) this.queue.stopped = true;
    const q = { itemID: reader.itemID, total: pages.length, done: 0, failed: 0, stopped: false, finished: false };
    this.queue = q;
    this.notifyQueue();
    const next = [...pages];
    const worker = async () => {
      while (!q.stopped && next.length) {
        const pi = next.shift();
        try {
          await this.getTranslation(reader, pi);
          q.done++;
        } catch (e) {
          q.failed++;
          q.lastError = e.userFacing ? e.message : String(e.message || e);
          this.fileLog("queue page " + (pi + 1) + " failed: " + q.lastError);
          if (/한도|로그인|찾지 못|키가/.test(q.lastError)) q.stopped = true;
        }
        this.notifyQueue();
      }
    };
    await Promise.all(Array.from({ length: this.slots }, worker));
    q.finished = true;
    this.notifyQueue();
  },

  notifyQueue() {
    for (const pane of this.panes) pane.renderQueue?.();
  },

  /* ---------- 서지 정보(맨 앞 칸) ----------
   * 논문, 책, 책의 한 장일 때 조테로에 저장된 제목, 저자, 연도, 학술지·책 이름을 보여 줘요.
   */
  META_TYPES: ["journalArticle", "book", "bookSection", "thesis", "report", "conferencePaper", "magazineArticle", "preprint", "manuscript"],
  META_KIND: { journalArticle: "논문", book: "책", bookSection: "책의 장", thesis: "학위논문", report: "보고서", conferencePaper: "학회 발표문", magazineArticle: "기사", preprint: "프리프린트", manuscript: "원고" },

  paperInfo(itemID) {
    const att = Zotero.Items.get(itemID);
    const item = att?.parentItem || att;
    if (!item || !this.META_TYPES.includes(item.itemType)) return null;
    const f = (k) => {
      try {
        return String(item.getField(k) || "");
      } catch (e) {
        return "";
      }
    };
    const authors = [];
    const lastNames = [];
    for (const c of item.getCreators()) {
      let type = "";
      try {
        type = Zotero.CreatorTypes.getName(c.creatorTypeID);
      } catch (e) {}
      if (!["author", "bookAuthor", "editor"].includes(type)) continue;
      authors.push([c.firstName, c.lastName].filter(Boolean).join(" ") || c.lastName || "");
      lastNames.push(c.lastName || c.firstName || "");
    }
    const year = (f("date").match(/\d{4}/) || [""])[0];
    return {
      itemKey: item.key,
      type: item.itemType,
      title: f("title"),
      book: f("bookTitle"),
      publication: f("publicationTitle"),
      volume: f("volume"),
      issue: f("issue"),
      pages: f("pages"),
      publisher: f("publisher"),
      authors: authors.filter(Boolean),
      lastNames: lastNames.filter(Boolean),
      year,
    };
  },

  // 제목, 책 이름, 저자 이름을 번역해서 저장해 둬요(한 논문에 한 번).
  async metaTranslation(reader, info) {
    const target = this.pref("targetLang") || "ko";
    const rec = await this.diskFor(reader.itemID);
    rec.meta = rec.meta || {};
    const saved = rec.meta[target];
    if (saved && saved.src === info.title) return saved;
    const lang = this.LANG_NAMES[target] || target;
    let out = null;
    const ans = await this.askJSON(
      `You translate bibliographic information into ${lang} for an academic reader. ` +
        `Translate titles naturally, as published ${lang} scholarship would. ` +
        (target === "ko" ? `Write each person's name as Korean transliteration followed by the original in parentheses, e.g. "앨런 김(Allen Kim)". ` : "") +
        `Return JSON only.`,
      `Title: ${info.title}\n` + (info.book ? `Book title: ${info.book}\n` : "") + `Authors: ${JSON.stringify(info.authors)}`,
      {
        type: "object",
        properties: { title: { type: "string" }, book: { type: "string" }, authors: { type: "array", items: { type: "string" } } },
        required: ["title", "book", "authors"],
        additionalProperties: false,
      }
    ).catch(() => null);
    if (ans?.title) out = { src: info.title, title: ans.title, book: ans.book || "", authors: Array.isArray(ans.authors) ? ans.authors : info.authors };
    else if ((this.pref("engine") || "claude-code") === "google") {
      try {
        const t = await this.googleTranslate(info.title, target);
        const b = info.book ? await this.googleTranslate(info.book, target) : { text: "" };
        out = { src: info.title, title: t.text, book: b.text, authors: info.authors };
      } catch (e) {}
    }
    if (out) {
      rec.meta[target] = out;
      this.saveDisk(reader.itemID);
    }
    return out;
  },

  /* ---------- 각주 ----------
   * 위첨자를 누르면 그 각주 내용을 찾아서 번역해 보여 줘요.
   * 각주 목록은 논문을 처음 열 때 한 번 만들고, 각주 번역은 저장해서 다시 쓰지 않아요.
   */
  noteIndexes: new Map(),

  noteIndex(reader) {
    const itemID = reader.itemID;
    if (this.noteIndexes.has(itemID)) return this.noteIndexes.get(itemID);
    const p = (async () => {
      const n = this.numPages(reader);
      const pages = [];
      for (let i = 0; i < n; i++) {
        try {
          pages.push(TransYbCore.itemsToLines((await this.pageItems(reader, i)).items));
        } catch (e) {
          pages.push([]);
        }
      }
      const notes = TransYbCore.parseNotes(pages);
      this.fileLog(`found ${notes.size} notes: ${[...notes.keys()].join(",")}`);
      return notes;
    })();
    this.noteIndexes.set(itemID, p);
    p.catch(() => this.noteIndexes.delete(itemID));
    return p;
  },

  async noteTranslation(reader, num, text) {
    const target = this.pref("targetLang") || "ko";
    const rec = await this.diskFor(reader.itemID);
    rec.notes = rec.notes || {};
    const box = (rec.notes[target] = rec.notes[target] || {});
    if (box[num] && box[num].src === text) return box[num].text;
    let title = "";
    try {
      const att = Zotero.Items.get(reader.itemID);
      title = (att?.parentItem || att)?.getField("title") || "";
    } catch (e) {}
    const res = await this.translatePage([text], target, { title, units: [{ para: 0, kind: "body" }] });
    const out = String(res.lines?.[0] || "");
    box[num] = { src: text, text: out };
    this.saveDisk(reader.itemID);
    return out;
  },

  /* ---------- 형광펜과 밑줄 ----------
   * 번역문에 형광펜이나 밑줄을 칠하면, 그 문장의 원문에도 같은 종류, 같은 색의 조테로 주석을 만들어요.
   * 번역문 표시 위치는 저장 파일에 같이 기억해요.
   * 기록 하나: { u: 문장 번호, from, to: 번역문 글자 위치, type: "highlight" | "underline", color, ann: 원문 주석 키 }
   */
  // 조테로 주석과 같은 8가지 색
  MARK_COLORS: [
    ["#ffd400", "노랑"],
    ["#ff6666", "빨강"],
    ["#5fb236", "초록"],
    ["#2ea8e5", "파랑"],
    ["#a28ae5", "보라"],
    ["#e56eee", "자홍"],
    ["#f19837", "주황"],
    ["#aaaaaa", "회색"],
  ],

  underlinesFor(itemID, pageIndex) {
    const rec = this.disk.get(itemID);
    if (!rec) return [];
    const list = rec.underlines[pageIndex] || (rec.underlines[pageIndex] = []);
    // 예전 기록(빨간 밑줄만 있던 때)도 읽어요.
    for (const x of list) {
      if (!x.type) x.type = "underline";
      if (!x.color) x.color = "#ff6666";
    }
    return list;
  },

  // range: 원문 일부 {start, end, text} (없으면 문장 전체)
  async createMarkAnnotation(page, uIdx, type, color, range = null) {
    const att = Zotero.Items.get(page.itemID);
    if (!att) return null;
    const unit = range || page.sentences[uIdx];
    const rects = this.rangeRects(page, unit);
    if (!rects.length) return null;
    const upRects = page.toPdf ? this.rangeRects(page, unit, true) : rects;
    const top = Math.max(0, Math.round(page.pageHeight + page.pageBottom - Math.max(...upRects.map((r) => r[3]))));
    const pad = (n, k) => String(n).padStart(k, "0");
    const json = {
      key: Zotero.DataObjectUtilities.generateKey(),
      type,
      color,
      text: range?.text || TransYbCore.unitSource(page.text, unit, page.soft),
      comment: "",
      pageLabel: String(page.pageIndex + 1),
      sortIndex: [pad(page.pageIndex, 5), pad(Math.min(unit.start, 999999), 6), pad(Math.min(top, 99999), 5)].join("|"),
      position: { pageIndex: page.pageIndex, rects },
      tags: [],
    };
    this.ownAnn.add(json.key); // 내가 만든 주석은 "원문에서 새로 칠함"으로 다시 받지 않아요
    await Zotero.Annotations.saveFromJSON(att, json);
    return json.key;
  },

  ownAnn: new Set(),

  // 조테로가 항목 변화를 알려 줄 때 듣는 귀를 달아요.
  startObserver() {
    if (this.notifierID) return;
    this.notifierID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type, ids, extraData) => {
          this.onItemsChanged(event, ids, extraData).catch((e) => this.fileLog("observer failed: " + this.errText(e)));
        },
      },
      ["item"],
      "trans_yb"
    );
  },

  stopObserver() {
    if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
    this.notifierID = null;
  },

  // 원문(영어)에서 주석을 지우면 번역문 표시도 지우고, 색을 바꾸면 번역문 색도 바꿔요.
  async onItemsChanged(event, ids, extraData) {
    if (event === "add") return this.onAnnotationsAdded(ids);
    if (!["delete", "trash", "modify"].includes(event)) return;
    const changed = new Map(); // 주석 키 -> null(지움) 또는 {type, color}
    for (const id of ids) {
      if (event === "delete") {
        const key = extraData?.[id]?.key;
        if (key) changed.set(key, null);
        continue;
      }
      const item = Zotero.Items.get(id);
      if (!item || !item.isAnnotation?.()) continue;
      if (event === "trash" || item.deleted) changed.set(item.key, null);
      else changed.set(item.key, { type: item.annotationType, color: item.annotationColor });
    }
    if (!changed.size) return;
    for (const [itemID, rec] of this.disk) {
      let dirty = false;
      for (const pageIndex of Object.keys(rec.underlines)) {
        const list = rec.underlines[pageIndex];
        for (let i = list.length - 1; i >= 0; i--) {
          const x = list[i];
          if (!x.ann || !changed.has(x.ann)) continue;
          const c = changed.get(x.ann);
          if (c === null) {
            list.splice(i, 1);
            dirty = true;
          } else if (["highlight", "underline"].includes(c.type) && (c.color !== x.color || c.type !== x.type)) {
            x.color = c.color;
            x.type = c.type;
            dirty = true;
          }
        }
        if (dirty) {
          for (const pane of this.panes) {
            const b = pane.blocks?.get(Number(pageIndex));
            if (b && b.page.itemID === itemID) pane.renderList(b.page);
          }
        }
      }
      if (dirty) {
        this.fileLog(`synced annotation changes from the original (${event})`);
        this.saveDisk(itemID);
      }
    }
  },

  // 원문(영어)에서 사용자가 새로 형광펜/밑줄을 칠하면, 번역문의 같은 부분에도 칠해요.
  async marksFromAnnotation(page, ann, origin) {
    const span = TransYbCore.findAnnotationSpan(page.text, ann.annotationText || "");
    if (!span) return [];
    const out = [];
    for (let u = 0; u < page.sentences.length; u++) {
      const un = page.sentences[u];
      const s0 = Math.max(span[0], un.start);
      const e0 = Math.min(span[1], un.end);
      if (e0 <= s0 || un.kind === "other") continue;
      const ko = page.lines[u] || "";
      const coversAll = s0 - un.start <= 2 && un.end - e0 <= 2;
      let range = [0, ko.length];
      if (!coversAll) {
        const part = TransYbCore.unitSource(page.text, { start: s0, end: e0 }, page.soft);
        range = (await this.alignToTarget(page, u, part).catch(() => null)) || [0, ko.length];
      }
      const rec = { u, from: range[0], to: range[1], type: ann.annotationType, color: ann.annotationColor, ann: ann.key, whole: coversAll };
      if (origin) rec.origin = origin;
      out.push(rec);
    }
    return out;
  },

  async onAnnotationsAdded(ids) {
    for (const id of ids) {
      const ann = Zotero.Items.get(id);
      if (!ann?.isAnnotation?.() || this.ownAnn.has(ann.key)) continue;
      if (!["highlight", "underline"].includes(ann.annotationType)) continue;
      const itemID = ann.parentItemID;
      let pos;
      try {
        pos = JSON.parse(ann.annotationPosition);
      } catch (e) {
        continue;
      }
      const pageIndex = pos?.pageIndex;
      let page = this.cache.get(itemID)?.get(pageIndex);
      if (!page) {
        const reader = (Zotero.Reader._readers || []).find((r) => r.itemID === itemID);
        if (reader) page = await this.loadSaved(reader, pageIndex).catch(() => null);
      }
      if (!page?.lines) continue; // 번역하지 않은 페이지
      await this.diskFor(itemID);
      const span = TransYbCore.findAnnotationSpan(page.text, ann.annotationText || "");
      if (!span) {
        this.fileLog(`original mark on page ${pageIndex + 1}: text not found in page`);
        continue;
      }
      const list = this.underlinesFor(itemID, pageIndex);
      let changed = false;
      for (let u = 0; u < page.sentences.length; u++) {
        const un = page.sentences[u];
        const s0 = Math.max(span[0], un.start);
        const e0 = Math.min(span[1], un.end);
        if (e0 <= s0 || un.kind === "other") continue;
        const ko = page.lines[u] || "";
        const coversAll = s0 - un.start <= 2 && un.end - e0 <= 2;
        let range = [0, ko.length];
        if (!coversAll) {
          const part = TransYbCore.unitSource(page.text, { start: s0, end: e0 }, page.soft);
          range = (await this.alignToTarget(page, u, part).catch(() => null)) || [0, ko.length];
        }
        list.push({ u, from: range[0], to: range[1], type: ann.annotationType, color: ann.annotationColor, ann: ann.key, whole: coversAll, origin: "pdf" });
        changed = true;
      }
      if (changed) {
        this.saveDisk(itemID);
        this.fileLog(`synced new original mark to translation on page ${pageIndex + 1}`);
        for (const pane of this.panes) if (pane.itemID === itemID) pane.rerender?.();
      }
    }
  },

  async deleteAnnotation(itemID, key) {
    try {
      const att = Zotero.Items.get(itemID);
      const ann = att && Zotero.Items.getByLibraryAndKey(att.libraryID, key);
      if (ann) await ann.eraseTx();
    } catch (e) {
      this.fileLog("annotation delete failed: " + this.errText(e));
    }
  },

  // pieces: [{u: 문장 번호, from, to}] (번역문 안의 글자 위치), style: {type, color}
  // 번역문 표시는 바로 하고(onLocal), 원문 주석은 같은 부분을 찾은 뒤에 만들어요.
  async addMarks(page, pieces, style, onLocal) {
    const list = this.underlinesFor(page.itemID, page.pageIndex);
    const added = pieces.map((pc) => {
      const rec = { u: pc.u, from: pc.from, to: pc.to, type: style.type, color: style.color, ann: null };
      list.push(rec);
      return rec;
    });
    onLocal?.();
    for (const rec of added) {
      const ko = page.lines[rec.u] || "";
      const whole = rec.from <= 0 && rec.to >= ko.trim().length - 1;
      try {
        let range = null;
        if (!whole) range = await this.alignToSource(page, rec.u, rec.from, rec.to);
        if (whole) {
          // 문장 전체: 같은 문장, 같은 종류, 같은 색의 원문 주석이 있으면 같이 써요
          rec.ann = list.find((x) => x !== rec && x.u === rec.u && x.type === rec.type && x.color === rec.color && x.ann && x.whole)?.ann || null;
          if (!rec.ann) rec.ann = await this.createMarkAnnotation(page, rec.u, rec.type, rec.color);
          rec.whole = true;
        } else if (!range) {
          // 같은 부분을 못 찾았어요(예: 사용 한도). 우선 문장 전체에 칠해 두고, 다음에 이 쪽을 열 때 다시 찾아 일부분으로 바꿔요.
          rec.ann = await this.createMarkAnnotation(page, rec.u, rec.type, rec.color);
          rec.pending = true;
        } else {
          rec.ann = await this.createMarkAnnotation(page, rec.u, rec.type, rec.color, range);
        }
      } catch (e) {
        this.fileLog("annotation create failed: " + this.errText(e));
      }
    }
    this.saveDisk(page.itemID);
  },

  /**
   * 번역문에서 일부만 칠했는데 원문에는 문장 전체가 칠해진 표시를 찾아, 원문도 같은 부분만 칠하도록 바꿔요.
   * (예전 버전에서 만든 표시, 사용 한도 때문에 대응을 못 찾았던 표시)
   * 원문에서 직접 칠한 주석(origin: "pdf")은 건드리지 않아요.
   */
  async repairMarks(page) {
    this._repairedPages = this._repairedPages || new Set();
    const key = page.itemID + ":" + page.pageIndex;
    if (this._repairedPages.has(key)) return;
    this._repairedPages.add(key);
    const att = Zotero.Items.get(page.itemID);
    if (!att) return;
    const list = this.underlinesFor(page.itemID, page.pageIndex);
    const hints = await this.markHints();
    let changed = false;
    // (가) 다시 번역한 쪽: 원문 주석 글자로 문장을 찾고, 그 부분에 맞는 새 번역문 위치를 찾아요.
    const moving = list.filter((x) => x.relocate);
    for (const annKey of new Set(moving.map((x) => x.ann))) {
      const olds = moving.filter((x) => x.ann === annKey);
      const ann = annKey && Zotero.Items.getByLibraryAndKey(att.libraryID, annKey);
      const fresh = ann ? await this.marksFromAnnotation(page, ann, olds[0].origin) : [];
      for (const o of olds) list.splice(list.indexOf(o), 1);
      if (!fresh.length) {
        this.fileLog(`relocate p${page.pageIndex + 1}: ${annKey} not found, mark dropped from translation`);
        changed = true;
        continue;
      }
      for (const f of fresh) {
        if (olds[0].origin !== "pdf") f.partialOk = true;
        list.push(f);
      }
      changed = true;
    }
    for (const rec of list.slice()) {
      if (!rec.ann || rec.origin === "pdf" || rec.partialOk) continue;
      const ko = page.lines[rec.u] || "";
      const unit = page.sentences[rec.u];
      if (!ko || !unit || rec.to <= rec.from || rec.to > ko.length + 1) continue; // 번역이 바뀌어 위치가 맞지 않는 기록
      if ((rec.to - rec.from) / ko.trim().length >= 0.9) continue; // 거의 문장 전체
      const ann = Zotero.Items.getByLibraryAndKey(att.libraryID, rec.ann);
      if (!ann) continue;
      const src = TransYbCore.looseKey(TransYbCore.unitSource(page.text, unit, page.soft));
      const annText = TransYbCore.looseKey(ann.annotationText || "");
      const coversAll = rec.pending || annText.length >= src.length * 0.9;
      if (!coversAll) {
        rec.partialOk = true;
        changed = true;
        continue;
      }
      let range = null;
      const hint = hints[rec.ann + "|" + rec.u + "|" + rec.from + "|" + rec.to];
      if (hint) {
        const r = TransYbCore.findInUnit(page.text, unit, page.soft, hint);
        if (r) range = { start: r[0], end: r[1], text: hint };
        this.fileLog(`repair hint: "${hint.slice(0, 30)}" ${r ? "found" : "not found"}`);
      }
      if (!range) {
        try {
          range = await this.alignToSource(page, rec.u, rec.from, rec.to);
        } catch (e) {
          this.fileLog("repair align failed: " + this.errText(e));
        }
      }
      if (!range) continue; // 다음에 다시 해요
      const newKey = await this.createMarkAnnotation(page, rec.u, rec.type, rec.color, range);
      if (!newKey) continue;
      const old = rec.ann;
      rec.ann = newKey;
      delete rec.whole;
      delete rec.pending;
      rec.partialOk = true;
      changed = true;
      if (!list.some((x) => x.ann === old)) {
        this.ownAnn.add(old); // 지우는 것도 "원문에서 지움"으로 다시 받지 않아요
        await this.deleteAnnotation(page.itemID, old);
      }
      this.fileLog(`repaired mark p${page.pageIndex + 1} u${rec.u}: ${old} -> ${newKey}`);
    }
    if (changed) this.saveDisk(page.itemID);
    return changed;
  },

  // 미리 맞춰 둔 대응표(~/Zotero/trans_yb/mark-hints.json). 없으면 빈 표.
  async markHints() {
    if (this._markHints) return this._markHints;
    this._markHints = {};
    try {
      const path = Zotero.DataDirectory.dir + "/trans_yb/mark-hints.json";
      this._markHints = JSON.parse(await Zotero.File.getContentsAsync(path)) || {};
    } catch (e) {
      // 파일이 없으면 그냥 넘어가요
    }
    return this._markHints;
  },

  async removeMarks(page, pieces) {
    const list = this.underlinesFor(page.itemID, page.pageIndex);
    const before = new Set(list.map((x) => x.ann).filter(Boolean));
    for (const pc of pieces) {
      for (let i = list.length - 1; i >= 0; i--) {
        const x = list[i];
        if (x.u !== pc.u || x.to <= pc.from || x.from >= pc.to) continue;
        const keep = [];
        if (x.from < pc.from) keep.push({ ...x, to: pc.from });
        if (x.to > pc.to) keep.push({ ...x, from: pc.to });
        list.splice(i, 1, ...keep);
      }
    }
    // 더 이상 어떤 번역문 표시도 쓰지 않는 원문 주석은 지워요.
    const after = new Set(list.map((x) => x.ann).filter(Boolean));
    for (const key of before) if (!after.has(key)) await this.deleteAnnotation(page.itemID, key);
    this.saveDisk(page.itemID);
  },

  /* ---------- PDF 위 강조 ---------- */

  ensureStyle(doc) {
    if (doc.getElementById(this.STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = this.STYLE_ID;
    style.textContent = `
      .tyb-ov { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
      .tyb-ov-rect { position: absolute; background: rgba(110, 110, 110, 0.16); border-radius: 2px; mix-blend-mode: multiply; }
      ::highlight(${this.HL_NAME}) { background-color: rgba(255, 196, 0, 0.45); color: transparent; }
      .textLayer span.trans_yb-hl { background-color: rgba(255, 196, 0, 0.35) !important; border-radius: 2px; }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  },

  // 한 문장이 원본 PDF에서 차지하는 사각형들(PDF 좌표). 조테로 주석과 화면 칠하기에 같이 써요.
  unitRects(page, uIdx) {
    return this.rangeRects(page, page.sentences[uIdx]);
  },

  // 페이지 글자 범위 {start, end} 가 차지하는 사각형들(PDF 좌표)
  rangeRects(page, unit, upright = false) {
    if (!unit) return [];
    if (page.toPdf && !upright) return this.rangeRects(page, unit, true).map((r) => TransYbCore.mapRect(page.toPdf, r).map((n) => Math.round(n * 1000) / 1000));
    const rects = [];
    for (const p of TransYbCore.piecesForSentence(page.ranges, unit)) {
      const it = page.items[p.piece];
      if (!it) continue;
      const len = it.str.length || 1;
      const x1 = it.t[4] + it.w * (p.from / len);
      const x2 = it.t[4] + it.w * (p.to / len);
      const y1 = it.t[5] - it.h * 0.22;
      const y2 = it.t[5] + it.h * 0.85;
      // 같은 줄에 붙은 조각은 한 사각형으로 합쳐요.
      const last = rects[rects.length - 1];
      if (last && Math.abs(last[1] - y1) < it.h * 0.3 && x1 - last[2] < it.h * 0.6 && x1 >= last[0]) {
        last[2] = Math.max(last[2], x2);
        last[3] = Math.max(last[3], y2);
      } else {
        rects.push([x1, y1, x2, y2]);
      }
    }
    return rects.map((r) => r.map((n) => Math.round(n * 1000) / 1000));
  },

  // 화면에 보이는 페이지의 좌표 변환표(PDF 좌표 -> 페이지 화면 위치)
  pageViewport(v, pageIndex) {
    const pv = v.pdfViewer.getPageView(pageIndex);
    const vp = pv?.viewport;
    if (!pv?.div || !vp) return null;
    const m = Array.from(vp.transform || []).map(Number);
    if (m.length !== 6) return null;
    return { div: pv.div, m };
  },

  clearPdfHighlight(v) {
    try {
      for (const el of v.doc.querySelectorAll(".tyb-ov")) el.textContent = "";
    } catch (e) {}
  },

  // 문장 하나를 PDF 위에 옅은 회색으로 칠해요(글자의 실제 좌표로 그려서 줄마다 정확해요).
  // 다음 쪽으로 이어지는 문장이면 다음 쪽의 이어지는 부분도 같이 칠해요.
  highlightPdfSentence(v, pageIndex, page, sIdx) {
    this.clearPdfHighlight(v);
    if (sIdx < 0 || !page?.items) return null;
    const first = this.drawUnit(v, pageIndex, page, sIdx);
    if (page.sentences[sIdx]?.joinNext) {
      const next = this.layouts.get(page.itemID + ":" + (pageIndex + 1));
      const ti = next ? next.sentences.findIndex((u) => u.contPrev) : -1;
      if (ti >= 0) this.drawUnit(v, pageIndex + 1, next, ti);
    }
    return first;
  },

  drawUnit(v, pageIndex, page, sIdx) {
    const pvp = this.pageViewport(v, pageIndex);
    if (!pvp) return null;
    this.ensureStyle(v.doc);
    let ov = pvp.div.querySelector(":scope > .tyb-ov");
    if (!ov) {
      ov = v.doc.createElement("div");
      ov.className = "tyb-ov";
      pvp.div.appendChild(ov);
    }
    const [a, b, c, d, e, f] = pvp.m;
    let first = null;
    for (const [x1, y1, x2, y2] of this.unitRects(page, sIdx)) {
      const pts = [
        [a * x1 + c * y1 + e, b * x1 + d * y1 + f],
        [a * x2 + c * y2 + e, b * x2 + d * y2 + f],
      ];
      const left = Math.min(pts[0][0], pts[1][0]);
      const top = Math.min(pts[0][1], pts[1][1]);
      const el = v.doc.createElement("div");
      el.className = "tyb-ov-rect";
      el.style.left = left + "px";
      el.style.top = top + "px";
      el.style.width = Math.abs(pts[1][0] - pts[0][0]) + "px";
      el.style.height = Math.abs(pts[1][1] - pts[0][1]) + "px";
      ov.appendChild(el);
      if (!first) first = el;
    }
    return first;
  },

  // 커서 위치를 PDF 좌표로 바꿔서, 그 자리에 있는 글자 조각을 찾아요.
  hitTest(v, x, y, pages) {
    for (const pageDiv of v.doc.querySelectorAll(".page[data-page-number]")) {
      const pr = pageDiv.getBoundingClientRect();
      if (x < pr.left || x > pr.right || y < pr.top || y > pr.bottom) continue;
      const pageIndex = Number(pageDiv.getAttribute("data-page-number")) - 1;
      const page = pages.get(pageIndex);
      const pvp = page?.items && this.pageViewport(v, pageIndex);
      if (!pvp) return null;
      // 페이지 안 위치(테두리 두께 포함) -> PDF 좌표
      const px = x - pr.left - pageDiv.clientLeft;
      const py = y - pr.top - pageDiv.clientTop;
      const [a, b, c, d, e, f] = pvp.m;
      const det = a * d - b * c;
      if (!det) return null;
      let X = (d * (px - e) - c * (py - f)) / det;
      let Y = (-b * (px - e) + a * (py - f)) / det;
      if (page.up) {
        const u = page.up;
        [X, Y] = [u[0] * X + u[2] * Y + u[4], u[1] * X + u[3] * Y + u[5]];
      }
      for (let i = 0; i < page.items.length; i++) {
        const it = page.items[i];
        const x1 = it.t[4];
        const x2 = it.t[4] + it.w;
        const y1 = it.t[5] - it.h * 0.25;
        const y2 = it.t[5] + it.h * 0.9;
        if (X >= x1 && X <= x2 && Y >= y1 && Y <= y2) {
          const rawOffset = Math.floor(((X - x1) / (it.w || 1)) * it.str.length);
          return { pageIndex, page, itemIndex: i, rawOffset };
        }
      }
      return { pageIndex, page, itemIndex: -1 };
    }
    return null;
  },

  // PDF 화면에 커서 이벤트를 한 번만 붙여요.
  hookViewer(reader, v) {
    if (this.hooked.has(v.doc)) return;
    this.hooked.add(v.doc);
    let frame = 0;
    let last = "";
    const onMove = (e) => {
      if (frame) return;
      const x = e.clientX;
      const y = e.clientY;
      frame = v.iframeWin.requestAnimationFrame(() => {
        frame = 0;
        try {
          this.onPdfHover(reader, v, x, y, (key) => {
            const changed = key !== last;
            last = key;
            return changed;
          });
        } catch (err) {
          this.log("hover error: " + err);
        }
      });
    };
    v.doc.addEventListener("mousemove", onMove, true);
    const unhook = () => {
      try {
        v.doc.removeEventListener("mousemove", onMove, true);
        this.clearPdfHighlight(v);
      } catch (e) {}
      this.hooked.delete(v.doc);
    };
    this.cleanups.push(unhook);
  },

  onPdfHover(reader, v, x, y, changed) {
    const pages = this.cache.get(reader.itemID);
    if (!pages) return;
    const hit = this.hitTest(v, x, y, pages);
    if (!hit || hit.itemIndex < 0) return; // 글자 사이 빈 곳이면 그대로 둬요(깜빡임 방지)
    const page = hit.page;
    const r = page.ranges[hit.itemIndex];
    if (!r) return;
    // 원래 글자 위치 -> 정리된 글자 위치
    let local = r.map.findIndex((rawIdx) => rawIdx >= hit.rawOffset);
    if (local < 0) local = r.end - r.start - 1;
    let sIdx = TransYbCore.sentenceAt(page.sentences, r.start + Math.min(local, r.end - r.start - 1));
    let pi = hit.pageIndex;
    let pg = page;
    if (page.sentences[sIdx]?.contPrev && !page.lines?.[sIdx]) {
      // 앞 쪽에서 이어진 부분: 번역은 앞 쪽 마지막 문장에 있어요
      const prev = pages.get(pi - 1);
      const hi = prev ? prev.sentences.findIndex((u) => u.joinNext) : -1;
      if (hi >= 0) {
        pi = pi - 1;
        pg = prev;
        sIdx = hi;
      }
    }
    if (!changed(pi + ":" + sIdx)) return;
    this.highlightPdfSentence(v, pi, pg, sIdx);
    for (const pane of this.panes) pane.markRow(reader.itemID, pi, sIdx, true);
  },

  /* ---------- 사이드바 화면 ---------- */

  // 애플 "시스템 설정" 같은 접기 칸: 제목 줄 + 오른쪽 꺾쇠(›), 누르면 아래에 둥근 카드가 펼쳐져요.
  makeToggle(h, label, prefName) {
    const root = h("div");
    root.className = "tyb-group";
    const head = h("button");
    head.className = "tyb-disclosure";
    const chev = h("span", null, "›");
    chev.className = "tyb-chev";
    head.append(h("span", null, label), chev);
    const body = h("div");
    body.className = "tyb-card";
    const set = (open) => {
      body.style.display = open ? "" : "none";
      chev.classList.toggle("open", open);
    };
    set(!!this.pref(prefName));
    head.addEventListener("click", () => {
      const open = body.style.display === "none";
      set(open);
      this.setPref(prefName, open);
    });
    root.append(head, body);
    return { root, body };
  },

  // 카드 안의 한 줄: 왼쪽 이름표, 오른쪽 조절 도구
  makeRow(h, label, ...controls) {
    const row = h("div");
    row.className = "tyb-row";
    const lab = h("span", null, label);
    lab.className = "tyb-row-label";
    const right = h("div");
    right.className = "tyb-row-right";
    right.append(...controls);
    row.append(lab, right);
    return row;
  },

  // 아이폰 같은 켜기/끄기 스위치
  makeSwitch(h, on, onChange) {
    const sw = h("button");
    sw.className = "tyb-switch";
    sw.setAttribute("role", "switch");
    sw.appendChild(h("span"));
    const set = (v) => {
      sw.classList.toggle("on", v);
      sw.setAttribute("aria-checked", String(v));
    };
    set(on);
    sw.addEventListener("click", () => {
      const v = !sw.classList.contains("on");
      set(v);
      onChange(v);
    });
    return sw;
  },

  PANE_STYLE_ID: "tyb-pane-style",
  ensurePaneStyle(doc) {
    doc.getElementById(this.PANE_STYLE_ID)?.remove();
    const st = doc.createElementNS(this.HTML, "style");
    st.id = this.PANE_STYLE_ID;
    st.textContent = `
      .tyb-root { color-scheme: light dark;
        --tyb-card: light-dark(#ffffff, #2c2c2e);
        --tyb-sep: light-dark(rgba(60,60,67,.14), rgba(84,84,88,.55));
        --tyb-label2: light-dark(rgba(60,60,67,.6), rgba(235,235,245,.6));
        --tyb-fill: light-dark(rgba(118,118,128,.12), rgba(118,118,128,.24));
        --tyb-seg: light-dark(#ffffff, #636366);
        --tyb-blue: light-dark(#007aff, #0a84ff);
        --tyb-green: light-dark(#34c759, #30d158);
        --tyb-text: var(--fill-primary, light-dark(rgba(0,0,0,.85), rgba(255,255,255,.9)));
        --tyb-label: var(--fill-secondary, light-dark(rgba(0,0,0,.55), rgba(255,255,255,.55)));
        display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 10px;
        font: inherit; color: var(--tyb-text); }
      .tyb-top { display: flex; gap: 6px; align-items: center; }
      .tyb-top > button { width: 120px; }
      .tyb-top > select { width: 96px; } /* "덴마크어"가 들어가는 폭 */
      .tyb-top > select { height: 22px; padding-block: 0; font: inherit; }
      .tyb-status { font-size: .92em; color: var(--tyb-label); min-height: 1em; }
      .tyb-group { display: flex; flex-direction: column; gap: 6px; }
      .tyb-disclosure { -moz-appearance: none; appearance: none; display: flex; justify-content: space-between;
        align-items: center; width: 100%; margin: 0; padding: 4px 2px; border: none; background: none;
        color: var(--tyb-text); font: inherit; font-weight: 600; cursor: pointer; }
      .tyb-chev { color: var(--tyb-label2); font-size: 17px; font-weight: 400; line-height: 1;
        transition: transform .18s ease; }
      .tyb-chev.open { transform: rotate(90deg); }
      .tyb-card { min-width: 240px; background: var(--tyb-card); border-radius: 10px;
        border: .5px solid var(--tyb-sep); box-shadow: 0 .5px 1.5px rgba(0,0,0,.05); overflow: hidden; }
      .tyb-row { display: flex; align-items: center; justify-content: space-between; gap: 10px;
        min-height: 34px; padding: 0 12px; }
      .tyb-row + .tyb-row, .tyb-row + .tyb-sub, .tyb-sub + .tyb-row { border-top: .5px solid var(--tyb-sep); }
      .tyb-row-label { flex: none; color: var(--tyb-label); }
      .tyb-row-right { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .tyb-sub { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
      .tyb-foot { padding: 6px 12px 8px; font-size: .85em; color: var(--tyb-label); text-align: right;
        border-top: .5px solid var(--tyb-sep); }
      .tyb-glyph { color: var(--tyb-label2); font-weight: 500; }
      .tyb-range { -moz-appearance: none; appearance: none; width: 120px; height: 18px; margin: 0;
        background: transparent; cursor: pointer; }
      .tyb-range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--tyb-fill); }
      .tyb-range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--tyb-label); }
      .tyb-range::-moz-range-thumb { width: 16px; height: 16px; border: none; border-radius: 50%; background: #fff;
        box-shadow: 0 .5px 2px rgba(0,0,0,.35), 0 0 0 .5px rgba(0,0,0,.08); }
      .tyb-well { -moz-appearance: none; appearance: none; width: 20px; height: 20px; padding: 0; margin: 0;
        border-radius: 50%; border: none; cursor: pointer;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.12), 0 0 0 2px var(--tyb-card), 0 0 0 3px var(--tyb-sep); }
      .tyb-hex { color: var(--tyb-label2); font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
      .tyb-sv { position: relative; height: 140px; border-radius: 8px; cursor: crosshair;
        box-shadow: inset 0 0 0 .5px rgba(0,0,0,.15); }
      .tyb-dot { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
        box-shadow: 0 0 0 2.5px #fff, 0 0 0 3px rgba(0,0,0,.25), 0 1px 3px 2px rgba(0,0,0,.2); pointer-events: none; }
      .tyb-hue { position: relative; height: 12px; border-radius: 6px; cursor: pointer;
        background: linear-gradient(to right,#f00,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00); }
      .tyb-hue-dot { position: absolute; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
        background: #fff; box-shadow: 0 .5px 3px rgba(0,0,0,.35); pointer-events: none; }
      .tyb-field { box-sizing: border-box; height: 24px; padding: 0 8px; border-radius: 6px; font: inherit; font-size: 12px;
        border: .5px solid var(--tyb-sep); background: light-dark(#fff, #1c1c1e); color: inherit; }
      .tyb-field:focus { outline: 2px solid var(--tyb-sep); outline-offset: 0; }
      .tyb-link { -moz-appearance: none; appearance: none; border: none; background: none; padding: 0; margin: 0;
        color: var(--tyb-text); font: inherit; font-weight: 500; cursor: pointer; }
      .tyb-link:hover { text-decoration: underline; text-underline-offset: 2px; }
      .tyb-seg { display: flex; width: 100%; padding: 2px; border-radius: 8px; background: var(--tyb-fill);
        box-sizing: border-box; }
      .tyb-seg > button { -moz-appearance: none; appearance: none; flex: 1 1 0; min-width: 0; height: 24px; margin: 0; padding: 0 4px;
        border: none; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: .88em;
        cursor: pointer; white-space: nowrap; }
      .tyb-seg > button.on { background: var(--tyb-seg); font-weight: 600;
        box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04); }
      .tyb-root { position: relative; }
      .tyb-list { display: flex; flex-direction: column; gap: 18px; padding: 2px 2px 8px;
        -moz-user-select: text; user-select: text; cursor: text;
        position: relative; }
      .tyb-listwrap { position: relative; }
      /* "다음 쪽" 단추: 번역 칸 바로 아래 오른쪽에 고정. 번역 칸을 스크롤해도 같은 자리이고 글자를 가리지 않아요 */
      .tyb-nextrow { position: fixed; z-index: 20; display: flex; gap: 6px; justify-content: flex-end; pointer-events: none; }
      .tyb-next { pointer-events: auto; -moz-appearance: none; appearance: none; height: 22px; padding: 0 10px;
        border-radius: 11px; border: .5px solid var(--tyb-sep); cursor: pointer; background: var(--tyb-card);
        color: var(--tyb-label); font: inherit; font-size: .82em; font-weight: 500;
        -moz-user-select: none; user-select: none; }
      .tyb-next:hover { color: var(--tyb-text); }
      .tyb-selbar { position: absolute; z-index: 10; display: flex; align-items: center; gap: 8px; padding: 4px 6px;
        border-radius: 9px;
        background: light-dark(rgba(255,255,255,.96), rgba(44,44,46,.96)); border: .5px solid var(--tyb-sep);
        box-shadow: 0 4px 14px rgba(0,0,0,.18); }
      .tyb-mini-seg { display: flex; padding: 2px; border-radius: 6px; background: var(--tyb-fill); }
      .tyb-mini-seg > button { -moz-appearance: none; appearance: none; border: none; background: transparent; color: inherit;
        font: inherit; font-size: .85em; padding: 1px 7px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
      .tyb-mini-seg > button.on { background: var(--tyb-seg); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
      .tyb-dots { display: flex; gap: 5px; }
      .tyb-dot-btn { -moz-appearance: none; appearance: none; width: 14px; height: 14px; padding: 0; margin: 0; border: none;
        border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.2); transition: transform .1s; }
      .tyb-dot-btn:hover { transform: scale(1.2); }
      .tyb-erase { -moz-appearance: none; appearance: none; border: none; background: none; color: var(--tyb-label);
        font: inherit; font-size: .85em; padding: 1px 4px; cursor: pointer; white-space: nowrap; }
      .tyb-erase:hover { color: var(--tyb-text); }
      .tyb-prog { height: 4px; border-radius: 2px; background: var(--tyb-fill); overflow: hidden; }
      .tyb-prog > div { height: 100%; width: 0; background: var(--tyb-label); transition: width .3s ease; }
      .tyb-para { line-height: 1.6; }
      .tyb-pageblock { display: flex; flex-direction: column; gap: 10px; }
      .tyb-pagehead { display: flex; align-items: center; gap: 8px; color: var(--tyb-label); font-size: .78em; margin-top: 4px; }
      .tyb-pagehead > span { flex: 1; height: 0; border-top: .5px solid var(--tyb-sep); }
      .tyb-pagehead > b { font-weight: 500; font-variant-numeric: tabular-nums; }
      .tyb-meta { display: flex; flex-direction: column; gap: 4px; padding: 12px 2px 14px; border-bottom: .5px solid var(--tyb-sep); }
      .tyb-meta-kind { font-size: .75em; letter-spacing: .08em; color: var(--tyb-label); }
      .tyb-meta-title { font-weight: 700; font-size: 1.18em; line-height: 1.45; margin-bottom: 4px; }
      .tyb-meta-orig { font-size: .85em; color: var(--tyb-label); line-height: 1.4; }
      .tyb-meta-authors { font-weight: 600; margin-top: 4px; }
      .tyb-meta-line { font-size: .85em; color: var(--tyb-label); }
      .tyb-note-label { font-size: .75em; letter-spacing: .08em; color: var(--tyb-label); margin-top: 6px;
        padding-top: 8px; border-top: .5px solid var(--tyb-sep); }
      .tyb-fnote { font-size: .88em; line-height: 1.55; color: var(--tyb-label); padding-left: 10px;
        border-left: 2px solid var(--tyb-sep); }
      .tyb-note-num { display: inline-block; min-width: 1.6em; margin-right: 4px; font-size: .82em; font-weight: 600;
        font-variant-numeric: tabular-nums; color: var(--tyb-text); }
      .tyb-heading, .tyb-byline { font-weight: 700; white-space: pre-line; }
      .tyb-byline { font-weight: 600; font-size: .95em; }
      .tyb-fn { font-size: .68em; line-height: 0; vertical-align: super; margin-left: 1px; color: var(--tyb-label); font-weight: 400;
        cursor: pointer; padding: 0 1px; border-radius: 3px; }
      .tyb-fn:hover { color: var(--tyb-text); background: var(--tyb-fill); }
      .tyb-note { position: absolute; left: 2px; right: 2px; z-index: 11; padding: 10px 12px 12px; border-radius: 10px;
        background: light-dark(rgba(255,255,255,.98), rgba(44,44,46,.98)); border: .5px solid var(--tyb-sep);
        box-shadow: 0 8px 24px rgba(0,0,0,.16); display: flex; flex-direction: column; gap: 6px; }
      .tyb-note-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
      .tyb-note-body { line-height: 1.6; max-height: 260px; overflow: auto; }
      .tyb-note-src { font-size: .85em; line-height: 1.5; color: var(--tyb-label); max-height: 120px; overflow: auto;
        border-top: .5px solid var(--tyb-sep); padding-top: 6px; }
      .tyb-note-src:empty { display: none; }
      .tyb-ref { padding-left: 1.4em; text-indent: -1.4em; opacity: .9; }
      .tyb-other { display: none; }
      .tyb-unit { border-radius: 3px; padding: 1px 0; transition: background .12s; }
      .tyb-unit:hover { background: light-dark(rgba(0,0,0,.05), rgba(255,255,255,.07)); }
      .tyb-unit.on { background: light-dark(rgba(0,0,0,.10), rgba(255,255,255,.14)); }
      .tyb-switch { -moz-appearance: none; appearance: none; position: relative; width: 38px; height: 22px; padding: 0;
        margin: 0; border: none; border-radius: 11px; background: var(--tyb-fill); cursor: pointer;
        transition: background .2s ease; }
      .tyb-switch > span { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s ease; }
      .tyb-switch.on { background: var(--tyb-green); }
      .tyb-switch.on > span { transform: translateX(16px); }
    `;
    doc.documentElement.appendChild(st);
  },

  renderPane(doc, body) {
    body._trans_yb?.destroy();
    body.textContent = "";
    const h = (tag, style, text) => {
      const el = doc.createElementNS(this.HTML, tag);
      if (style) el.setAttribute("style", style);
      if (text != null) el.textContent = text;
      return el;
    };

    this.ensurePaneStyle(doc);
    const wrap = h("div");
    wrap.className = "tyb-root";

    // 맨 위: 이 페이지 번역 → 한국어 (맥 기본 단추, 같은 너비)
    const bar = h("div");
    bar.className = "tyb-top";
    const btn = h("button", "font-weight:600;", "이 페이지 번역");
    const langSel = h("select");
    for (const [code, label] of this.LANGS) {
      const o = h("option", null, label);
      o.value = code;
      if (code === this.pref("targetLang")) o.selected = true;
      langSel.appendChild(o);
    }
    const arrowEl = h("span", null, "→");
    arrowEl.className = "tyb-glyph";
    bar.append(langSel, arrowEl, btn);

    // ---------- 글씨 설정 ----------
    const styleBox = this.makeToggle(h, "글씨 설정", "styleOpen");

    // 크기: 작은 가 ──●── 큰 가
    const sizeSlider = h("input");
    sizeSlider.className = "tyb-range";
    sizeSlider.type = "range";
    sizeSlider.min = "10";
    sizeSlider.max = "24";
    sizeSlider.step = "1";
    const baseSize = Math.round(parseFloat(doc.defaultView.getComputedStyle(body).fontSize)) || 13;
    sizeSlider.value = String(this.pref("fontPx") || baseSize);
    sizeSlider.title = sizeSlider.value + "pt";
    sizeSlider.addEventListener("input", () => {
      sizeSlider.title = sizeSlider.value + "pt";
      pane.applyTextStyle(Number(sizeSlider.value), null);
    });
    sizeSlider.addEventListener("change", () => {
      const v = Number(sizeSlider.value);
      this.setPref("fontPx", v === baseSize ? 0 : v); // 조테로 크기와 같으면 "기본"으로 둬요
    });
    const small = h("span", "font-size:11px;", "가");
    small.className = "tyb-glyph";
    const big = h("span", "font-size:16px;", "가");
    big.className = "tyb-glyph";
    const sizeRow = this.makeRow(h, "크기", small, sizeSlider, big);

    // 색상: 동그란 색 + 코드, 누르면 아래에 색 고르는 판이 열려요
    const well = h("button");
    well.className = "tyb-well";
    well.title = "색 고르기";
    const hexLabel = h("span");
    hexLabel.className = "tyb-hex";
    const colorRow = this.makeRow(h, "색상", hexLabel, well);

    const pickerBox = h("div");
    pickerBox.className = "tyb-sub";
    pickerBox.style.display = "none";
    const sv = h("div");
    sv.className = "tyb-sv";
    const svDot = h("div");
    svDot.className = "tyb-dot";
    sv.appendChild(svDot);
    const hueBar = h("div");
    hueBar.className = "tyb-hue";
    const hueDot = h("div");
    hueDot.className = "tyb-hue-dot";
    hueBar.appendChild(hueDot);
    const pickFoot = h("div", "display:flex;align-items:center;justify-content:space-between;gap:8px;");
    const hexInput = h("input", "width:96px;");
    hexInput.className = "tyb-field";
    hexInput.type = "text";
    hexInput.maxLength = 7;
    hexInput.placeholder = "#6b4423";
    hexInput.title = "색 코드를 입력하고 Enter";
    const resetLink = h("button", null, "기본 색으로");
    resetLink.className = "tyb-link";
    pickFoot.append(hexInput, resetLink);
    pickerBox.append(sv, hueBar, pickFoot);
    well.addEventListener("click", () => {
      pickerBox.style.display = pickerBox.style.display === "none" ? "" : "none";
    });

    let cur = { h: 0, s: 0, v: 0.2 };
    const renderPicker = () => {
      sv.style.background =
        "linear-gradient(to top,#000,rgba(0,0,0,0))," +
        `linear-gradient(to right,#fff,hsl(${cur.h},100%,50%))`;
      svDot.style.left = cur.s * 100 + "%";
      svDot.style.top = (1 - cur.v) * 100 + "%";
      svDot.style.background = TransYbCore.hsvToHex(cur.h, cur.s, cur.v);
      hueDot.style.left = (cur.h / 360) * 100 + "%";
    };
    const showColor = (color) => {
      well.style.background = color || "currentColor";
      hexLabel.textContent = color ? color.toUpperCase() : "기본";
      resetLink.style.visibility = color ? "visible" : "hidden";
    };
    // source: "picker"(판), "hex"(코드 칸), 그 외. 바꾼 곳 말고 나머지를 맞춰 줘요.
    const pickColor = (color, source) => {
      this.setPref("textColor", color);
      pane.applyTextStyle(null, color);
      if (source !== "picker" && color) {
        const c = TransYbCore.hexToHsv(color);
        if (c) cur = c;
        renderPicker();
      }
      if (source !== "hex") hexInput.value = color || "";
      showColor(color);
    };
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const fromPicker = () => {
      renderPicker();
      pickColor(TransYbCore.hsvToHex(cur.h, cur.s, cur.v), "picker");
    };
    const dragOn = (el, onPoint) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const win = doc.defaultView;
        const move = (ev) => {
          const r = el.getBoundingClientRect();
          onPoint(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
        };
        const up = () => {
          win.removeEventListener("mousemove", move, true);
          win.removeEventListener("mouseup", up, true);
        };
        win.addEventListener("mousemove", move, true);
        win.addEventListener("mouseup", up, true);
        move(e);
      });
    };
    dragOn(sv, (x, y) => {
      cur.s = x;
      cur.v = 1 - y;
      fromPicker();
    });
    dragOn(hueBar, (x) => {
      cur.h = Math.round(x * 360) % 360;
      fromPicker();
    });
    resetLink.addEventListener("click", () => pickColor("", "reset"));
    const applyHex = () => {
      const raw = hexInput.value.trim();
      if (!raw) return;
      const c = TransYbCore.hexToHsv(raw.startsWith("#") ? raw : "#" + raw);
      if (!c) return;
      hexInput.value = c.hex;
      cur = c;
      renderPicker();
      pickColor(c.hex, "hex");
    };
    hexInput.addEventListener("input", () => {
      if (/^#?[0-9a-f]{6}$/i.test(hexInput.value.trim())) applyHex();
    });
    hexInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyHex();
    });
    hexInput.addEventListener("blur", applyHex);

    const startColor = this.pref("textColor") || "";
    cur = TransYbCore.hexToHsv(startColor || "#333333") || cur;
    renderPicker();
    hexInput.value = startColor;
    showColor(startColor);
    styleBox.body.append(sizeRow, colorRow, pickerBox);

    // ---------- 번역 엔진 설정 ----------
    const settings = this.makeToggle(h, "번역 엔진 설정", "engineOpen");
    const segWrap = h("div", "padding:8px 10px;");
    const seg = h("div");
    seg.className = "tyb-seg";
    segWrap.appendChild(seg);
    const ENGINES = [["claude-code", "Claude Code"], ["codex", "Codex"], ["claude", "Claude API"], ["google", "Google"]];
    const segBtns = [];
    const keyBox = h("div");
    keyBox.className = "tyb-sub";
    keyBox.style.paddingTop = "0";
    const keyLine = h("div", "display:flex;gap:6px;align-items:center;");
    const keyInput = h("input", "flex:1 1 auto;min-width:0;");
    keyInput.className = "tyb-field";
    keyInput.type = "password";
    keyInput.placeholder = this.pref("anthropicKey") ? "키 저장됨" : "API 키 (sk-ant-…)";
    const keySave = h("button", null, "저장");
    keyLine.append(keyInput, keySave);
    keyBox.appendChild(keyLine);
    keySave.addEventListener("click", () => {
      const v = keyInput.value.trim();
      if (!v) return;
      this.setPref("anthropicKey", v);
      keyInput.value = "";
      keyInput.placeholder = "키 저장됨";
    });
    const selectEngine = (code) => {
      for (const b of segBtns) b.classList.toggle("on", b._code === code);
      keyBox.style.display = code === "claude" ? "" : "none";
    };
    for (const [code, label] of ENGINES) {
      const b = h("button", null, label);
      b._code = code;
      b.addEventListener("click", () => {
        this.setPref("engine", code);
        selectEngine(code);
      });
      segBtns.push(b);
      seg.appendChild(b);
    }
    selectEngine(this.pref("engine") || "claude-code");

    const autoRow = this.makeRow(
      h,
      "자동 번역",
      this.makeSwitch(h, !!this.pref("autoNextPage"), (v) => this.setPref("autoNextPage", v))
    );
    // 이름 아래 작은 설명
    const autoLabel = autoRow.querySelector(".tyb-row-label");
    autoLabel.textContent = "";
    autoLabel.append(h("div", "color:var(--tyb-text);", "자동 번역"), h("div", "font-size:.8em;margin-top:2px;", "지금 보는 쪽과 다음 두 쪽을 미리 번역해 둬요."));
    autoRow.style.paddingBlock = "7px";
    const ver = h("div", null, "trans_yb " + (this.version || ""));
    ver.className = "tyb-foot";
    settings.body.append(segWrap, keyBox, ver);

    // ---------- 미리 번역 ----------
    const pre = this.makeToggle(h, "미리 번역 설정", "prefetchOpen");
    const allBtn = h("button", null, "모두 번역");
    allBtn.className = "tyb-link";
    const allRow = this.makeRow(h, "전체 페이지", allBtn);
    const fromIn = h("input", "width:46px;text-align:center;");
    fromIn.className = "tyb-field";
    fromIn.type = "number";
    fromIn.min = "1";
    fromIn.placeholder = "1";
    const toIn = h("input", "width:46px;text-align:center;");
    toIn.className = "tyb-field";
    toIn.type = "number";
    toIn.min = "1";
    toIn.placeholder = "끝";
    const rangeBtn = h("button", null, "번역");
    rangeBtn.className = "tyb-link";
    const dash = h("span", null, "–");
    dash.className = "tyb-glyph";
    const rangeRow = this.makeRow(h, "쪽 범위", fromIn, dash, toIn, rangeBtn);
    const progBox = h("div");
    progBox.className = "tyb-sub";
    progBox.style.display = "none";
    const progTop = h("div", "display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;");
    const progText = h("span");
    const stopLink = h("button", null, "중지");
    stopLink.className = "tyb-link";
    progTop.append(progText, stopLink);
    const progBar = h("div");
    progBar.className = "tyb-prog";
    const progFill = h("div");
    progBar.appendChild(progFill);
    progBox.append(progTop, progBar);
    pre.body.append(autoRow, allRow, rangeRow, progBox);

    const status = h("div");
    status.className = "tyb-status";
    const metaEl = h("div");
    metaEl.className = "tyb-meta";
    metaEl.style.display = "none";
    const list = h("div");
    list.className = "tyb-list";
    // 번역 맨 끝 오른쪽에 붙는 작은 "다음 쪽" 단추(글자를 가리지 않게 번역 아래 줄에 놓아요)
    const nextBtn = h("button", null, "다음 쪽 ›");
    nextBtn.className = "tyb-next";
    const prevBtn = h("button", null, "‹ 이전 쪽");
    prevBtn.className = "tyb-next";
    const nextRow = h("div");
    nextRow.className = "tyb-nextrow";
    nextRow.style.display = "none";
    nextRow.append(prevBtn, nextBtn);
    const listWrap = h("div");
    listWrap.className = "tyb-listwrap";
    listWrap.append(list, nextRow);
    // 번역문을 드래그하면 뜨는 작은 단추 (밑줄 / 밑줄 지우기)
    const selBar = h("div");
    selBar.className = "tyb-selbar";
    selBar.style.display = "none";
    const modeSeg = h("div");
    modeSeg.className = "tyb-mini-seg";
    const hlMode = h("button", null, "형광펜");
    const ulMode = h("button", null, "밑줄");
    modeSeg.append(hlMode, ulMode);
    const setMode = (m) => {
      this.setPref("markType", m);
      hlMode.classList.toggle("on", m === "highlight");
      ulMode.classList.toggle("on", m === "underline");
    };
    setMode(this.pref("markType") || "highlight");
    hlMode.addEventListener("click", () => setMode("highlight"));
    ulMode.addEventListener("click", () => setMode("underline"));
    const dots = h("div");
    dots.className = "tyb-dots";
    for (const [color, name] of this.MARK_COLORS) {
      const d = h("button");
      d.className = "tyb-dot-btn";
      d.style.background = color;
      d.title = name;
      d.addEventListener("mousedown", (e) => e.preventDefault()); // 누를 때 선택이 풀리지 않게
      d.addEventListener("click", () => pane.applyMark(color));
      dots.appendChild(d);
    }
    const unulBtn = h("button", null, "지우기");
    unulBtn.className = "tyb-erase";
    for (const b of [hlMode, ulMode]) b.addEventListener("mousedown", (e) => e.preventDefault());
    selBar.append(modeSeg, dots, unulBtn);
    // 각주 창
    const notePop = h("div");
    notePop.className = "tyb-note";
    notePop.style.display = "none";
    const noteHead = h("div");
    noteHead.className = "tyb-note-head";
    const noteTitle = h("span");
    const noteClose = h("button", null, "닫기");
    noteClose.className = "tyb-link";
    noteHead.append(noteTitle, noteClose);
    const noteBody = h("div");
    noteBody.className = "tyb-note-body";
    const noteSrc = h("div");
    noteSrc.className = "tyb-note-src";
    notePop.append(noteHead, noteBody, noteSrc);
    noteClose.addEventListener("click", () => (notePop.style.display = "none"));
    wrap.append(bar, styleBox.root, settings.root, pre.root, status, metaEl, listWrap, selBar, notePop);
    body.appendChild(wrap);

    const self = this;
    const pane = {
      itemID: null,
      pageIndex: -1,
      rows: [],
      textEls: [],
      shown: null, // 지금 보는 쪽
      blocks: new Map(), // 쪽 번호 -> { el, page, rows, textEls }
      blocksItem: null,
      timer: null,
      destroyed: false,
      selPieces: null,

      reader() {
        return self.readerForDoc(doc);
      },

      setStatus(t) {
        status.textContent = t;
      },

      refresh() {
        const reader = this.reader();
        if (!reader) return;
        const v = self.viewer(reader);
        if (!v) {
          this.setStatus("PDF 화면에서만 쓸 수 있어요.");
          return;
        }
        const itemChanged = reader.itemID !== this.blocksItem;
        this.itemID = reader.itemID;
        this.pageIndex = v.pdfViewer.currentPageNumber - 1;
        self.hookViewer(reader, v);
        if (itemChanged) {
          this.ensureItem(reader.itemID);
          this.renderMeta(reader);
        }
        for (const [k, b] of [...this.blocks]) {
          if (k !== this.pageIndex) {
            b.el.remove();
            this.blocks.delete(k);
          }
        }
        const target = self.pref("targetLang") || "ko";
        const page = self.cache.get(this.itemID)?.get(this.pageIndex);
        if (page && page.target === target) {
          this.renderList(page);
          this.renderQueue();
          return;
        }
        this.setStatus(`${this.pageIndex + 1}쪽: 아직 번역하지 않았어요.`);
        const itemID = this.itemID;
        const pageIndex = this.pageIndex;
        self
          .loadSaved(reader, pageIndex)
          .then((saved) => {
            if (saved && this.itemID === itemID) {
              this.renderList(saved);
            } else if (!saved && self.pref("autoNextPage") && self.started.has(itemID)) this.translateCurrent();
          })
          .catch(() => {});
        this.renderQueue();
      },

      // 맨 앞 서지 정보 칸: 원래 정보를 먼저 보여 주고, 번역을 시작한 논문이면 번역한 정보로 바꿔요.
      async renderMeta(reader) {
        const info = self.paperInfo(reader.itemID);
        if (!info || !info.title) {
          metaEl.style.display = "none";
          return;
        }
        // Park·Abelmann(2004)의 「제목」  (셋 이상이면 Park 외, 책이면 『』)
        const draw = (tr) => {
          metaEl.textContent = "";
          metaEl.style.display = "";
          const ln = info.lastNames;
          const who = ln.length === 0 ? "" : ln.length <= 2 ? ln.join("·") : ln[0] + " 외";
          const isBook = info.type === "book";
          const [qa, qb] = isBook ? ["『", "』"] : ["「", "」"];
          const titleText = tr?.title || info.title;
          const line = h("div");
          line.className = "tyb-meta-title";
          line.textContent = (who ? `${who}(${info.year || "연도 없음"})의 ` : "") + qa + titleText + qb;
          metaEl.appendChild(line);
          const subs = [];
          if (tr?.title && tr.title !== info.title) subs.push(info.title);
          if (info.type === "bookSection" && info.book) subs.push("수록: " + (tr?.book ? `『${tr.book}』(${info.book})` : `『${info.book}』`));
          const vol = info.volume ? ` ${info.volume}${info.issue ? `(${info.issue})` : ""}` : "";
          const pub = info.publication ? info.publication + vol + (info.pages ? `: ${info.pages}` : "") : isBook ? info.publisher : "";
          if (pub) subs.push(pub);
          for (const t of subs) {
            const d = h("div", null, t);
            d.className = "tyb-meta-line";
            metaEl.appendChild(d);
          }
        };
        const target = self.pref("targetLang") || "ko";
        const rec = await self.diskFor(reader.itemID).catch(() => null);
        const saved = rec?.meta?.[target];
        draw(saved && saved.src === info.title ? saved : null);
        if ((saved && saved.src === info.title) || !self.started.has(reader.itemID)) return;
        const tr = await self.metaTranslation(reader, info).catch(() => null);
        if (tr && this.itemID === reader.itemID) draw(tr);
      },

      // 다른 논문으로 바뀌면 목록을 비워요.
      ensureItem(itemID) {
        if (this.blocksItem === itemID) return;
        list.textContent = "";
        this.blocks.clear();
        this.blocksItem = itemID;
      },

      rerender() {
        for (const b of [...this.blocks.values()]) this.renderList(b.page);
      },

      showStatus(page) {
        if (!page.sentences.length) {
          this.setStatus(`${page.pageIndex + 1}쪽에는 글자 정보가 없어요. 스캔한 PDF일 수 있어요.`);
          return;
        }
        this.setStatus(
          `${page.pageIndex + 1}쪽 · 문단 ${new Set(page.sentences.map((u) => u.para)).size}개 · ${page.sentences.length}문장` +
            (page.engine ? ` · ${page.engine}` : "")
        );
      },

      // 번역문 한 문장 안에 형광펜과 밑줄을 칠하고, 각주 번호는 위첨자로 보여 줘요.
      fillUnit(span, text, marks, fnSpans = []) {
        span.textContent = "";
        // 글자를 붙일 때 각주 번호 자리는 <sup> 으로 감싸요(글자 위치는 그대로라 밑줄 위치가 어긋나지 않아요).
        const put = (parent, from, to) => {
          let pos = from;
          for (const [a, b] of fnSpans) {
            if (b <= pos || a >= to) continue;
            if (a > pos) parent.appendChild(doc.createTextNode(text.slice(pos, a)));
            const sup = h("sup", null, text.slice(Math.max(a, pos), Math.min(b, to)));
            sup.className = "tyb-fn";
            sup.title = "각주 보기";
            const num = text.slice(a, b);
            sup.addEventListener("mousedown", (e) => e.stopPropagation());
            sup.addEventListener("click", (e) => {
              e.stopPropagation();
              this.showNote(num, sup);
            });
            parent.appendChild(sup);
            pos = Math.min(b, to);
          }
          if (pos < to) parent.appendChild(doc.createTextNode(text.slice(pos, to)));
        };
        const ms = marks
          .map((m) => ({ ...m, from: Math.max(0, m.from), to: Math.min(text.length, m.to) }))
          .filter((m) => m.to > m.from);
        const cuts = new Set([0, text.length]);
        for (const m of ms) {
          cuts.add(m.from);
          cuts.add(m.to);
        }
        const pts = [...cuts].sort((a, b) => a - b);
        for (let k = 0; k < pts.length - 1; k++) {
          const f = pts[k];
          const t = pts[k + 1];
          const on = ms.filter((m) => m.from <= f && m.to >= t);
          const piece = text.slice(f, t);
          if (!on.length) {
            put(span, f, t);
            continue;
          }
          const el = h("span");
          put(el, f, t);
          const hl = on.filter((m) => m.type === "highlight").pop();
          const ul = on.filter((m) => m.type !== "highlight").pop();
          if (hl) el.style.background = hl.color + "66"; // 투명도 40%
          if (ul) {
            el.style.textDecoration = "underline";
            el.style.textDecorationColor = ul.color;
            el.style.textDecorationThickness = "2px";
            el.style.textUnderlineOffset = "3px";
          }
          span.appendChild(el);
        }
      },

      // 지금 펼친 쪽의 번역만 그려요(다른 쪽 덩어리는 치워요).
      renderList(page) {
        selBar.style.display = "none";
        if (!page?.lines) return;
        this.ensureItem(page.itemID);
        if (page.pageIndex !== this.pageIndex) return;
        for (const [k, b] of [...this.blocks]) {
          if (k !== page.pageIndex) {
            b.el.remove();
            this.blocks.delete(k);
          }
        }
        const block = this.buildBlock(page);
        const old = this.blocks.get(page.pageIndex);
        if (old) old.el.replaceWith(block.el);
        else list.insertBefore(block.el, list.firstChild);
        this.blocks.set(page.pageIndex, block);
        // 다른 쪽으로 넘어갔으면 번역 맨 위부터 보여 줘요.
        if (this.scrollPage !== page.itemID + ":" + page.pageIndex) {
          // 쪽이 바뀌면 오른쪽 칸을 새 번역의 맨 위로 올려요(다시 스크롤하지 않아도 되게).
          doc.defaultView.requestAnimationFrame(() => {
            const sc = this.scroller();
            if (!sc) return;
            const d = list.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
            if (d < 0 || d > sc.clientHeight * 0.5) sc.scrollTop += d;
          });
        }
        this.scrollPage = page.itemID + ":" + page.pageIndex;
        this.shown = page;
        this.showStatus(page);
        Promise.resolve().then(() => {
          this.applyTextStyle(null, null);
          this.fitScroll();
        });
      },

      // 오른쪽 칸 전체를 스크롤하는 바깥 상자
      scroller() {
        let sc = list.parentNode;
        while (sc && sc.nodeType === 1) {
          const oy = doc.defaultView.getComputedStyle(sc).overflowY;
          if ((oy === "auto" || oy === "scroll") && sc.scrollHeight > sc.clientHeight + 1) return sc;
          sc = sc.parentNode;
        }
        return null;
      },

      // 번역 상자: 화면 아래 끝까지. 상자 안에서 직접 스크롤해 글을 올려 읽고, 끝까지 내리면 PDF가 함께 내려가요.
      fitScroll() {
        const win = doc.defaultView;
        if (!win || !list.isConnected) return;
        const top = list.getBoundingClientRect().top;
        // 번역은 칸 안 스크롤 없이 끝까지 쭉 보여요(오른쪽 칸 전체가 스크롤돼요).
        list.style.maxHeight = "";
        list.style.paddingBottom = "34px"; // 번역 끝 줄이 "다음 쪽" 단추에 가리지 않게
        const lr = list.getBoundingClientRect();
        nextRow.style.right = Math.max(4, Math.round(win.innerWidth - lr.right)) + "px";
        // 오른쪽 칸 아래 끝에 늘 떠 있어요(아래 정보 칸까지 스크롤해도 같은 자리).
        nextRow.style.top = Math.round(win.innerHeight - 30) + "px";
        const visible = list.offsetParent !== null;
        nextRow.style.display = visible && this.blocks.get(this.pageIndex) ? "" : "none";
      },

      buildBlock(page) {
        // 표시를 고쳤으면(위치를 다시 찾았으면) 한 번 더 그려요. 같은 쪽은 한 번만 고쳐서 되풀이되지 않아요.
        if (page.lines) {
          self
            .repairMarks(page)
            .then((changed) => changed && !this.destroyed && this.renderList(page))
            .catch((e) => self.fileLog("repair failed: " + self.errText(e)));
        }
        const el = h("div");
        el.className = "tyb-pageblock";

        const rows = [];
        const textEls = [];
        const marks = self.underlinesFor(page.itemID, page.pageIndex);
        const fnSets = TransYbCore.pageFootnotes(
          page.sentences.map((u) => (u.kind === "body" || u.kind === "heading" ? TransYbCore.unitSource(page.text, u, page.soft) : ""))
        );
        // Claude가 맥락을 보고 고른 제목 번호가 있으면 그것만 제목으로 보여 줘요.
        const isHead = (i) =>
          page.sentences[i].title || (Array.isArray(page.headings) ? page.headings.includes(i) : page.sentences[i].kind === "heading");
        let paraEl = null;
        let lastPara = null;
        page.sentences.forEach((u, i) => {
          const line = page.lines[i] || "";
          // 앞 쪽에서 이어진 뒷부분: 번역은 앞 쪽 마지막 문장에 합쳐져 있어요.
          // 그 완성된 문장 번역을 이 쪽 첫 문단의 첫 문장으로 보통 글씨로 넣어요.
          let cont = null;
          if (u.contPrev && !line) {
            const prev = self.cache.get(page.itemID)?.get(page.pageIndex - 1);
            const hi = prev ? prev.sentences.findIndex((x) => x.joinNext) : -1;
            const prevLine = hi >= 0 ? prev.lines[hi] : "";
            if (!prev && !this._contTried?.has(page.pageIndex)) {
              // 앞 쪽 번역이 아직 메모리에 없으면 저장된 것을 불러와서 다시 그려요
              (this._contTried = this._contTried || new Set()).add(page.pageIndex);
              const reader = this.reader();
              if (reader) self.loadSaved(reader, page.pageIndex - 1).then((pg) => pg && this.renderList(page)).catch(() => {});
            }
            if (!prevLine) {
              rows.push(null);
              return;
            }
            cont = { prev, hi, text: prevLine };
          }
          if (u.para !== lastPara) {
            lastPara = u.para;
            paraEl = h("div");
            const isByline = Array.isArray(page.bylines) && page.bylines.includes(i);
            const shown =
              u.kind === "note" ? "note" : isByline ? "byline" : isHead(i) ? "heading" : u.kind === "heading" ? "body" : u.kind || "body";
            // 쪽 안에서 처음 나오는 주석 앞에 "주석" 표시
            if (shown === "note" && !el.querySelector(".tyb-note-label")) {
              const lab = h("div", null, "주석");
              lab.className = "tyb-note-label";
              el.appendChild(lab);
            }
            // 주석 문단 이름은 각주 창(tyb-note)과 겹치지 않게 tyb-fnote 로 해요
            paraEl.className = "tyb-para tyb-" + (shown === "note" ? "fnote" : shown);
            el.appendChild(paraEl);
            textEls.push(paraEl);
          } else {
            paraEl.appendChild(doc.createTextNode(" "));
          }
          if (u.kind === "note") {
            const m = /^\s*(\d{1,3}|[*†‡])\s*/.exec(line);
            if (m && !paraEl.querySelector(".tyb-note-num")) {
              const num = h("span", null, m[1]);
              num.className = "tyb-note-num";
              paraEl.appendChild(num);
            }
          }
          const span = h("span");
          span.className = "tyb-unit";
          if (cont) {
            // 앞 쪽에서 이어진 문장(보통 글씨). 커서를 대면 앞 쪽과 이 쪽의 원문이 함께 표시돼요.
            span.textContent = cont.text;
            span.title = "앞 쪽에서 이어진 문장";
            span.addEventListener("mouseenter", () => {
              const reader = this.reader();
              const v = reader && self.viewer(reader);
              if (v) self.highlightPdfSentence(v, page.pageIndex - 1, cont.prev, cont.hi);
            });
            paraEl.appendChild(span);
            rows.push(null);
            return;
          }
          const fn = TransYbCore.footnoteSpans(line, fnSets[i]);
          // 주석 번호는 앞의 작은 표시로 보여 줬으니 글 안에서는 빼요(글자 위치가 바뀌지 않게 표시 길이만 줄여요)
          const noteNum = u.kind === "note" ? /^\s*(\d{1,3}|[*†‡])\s*/.exec(line) : null;
          this.fillUnit(span, line, marks.filter((m) => m.u === i), fn);
          if (noteNum && span.firstChild?.nodeType === 3 && span.firstChild.data.startsWith(noteNum[0])) {
            span.firstChild.data = span.firstChild.data.slice(noteNum[0].length);
          }
          span.addEventListener("mouseenter", () => {
            const reader = this.reader();
            const v = reader && self.viewer(reader);
            if (!v) return;
            self.highlightPdfSentence(v, page.pageIndex, page, i);
            this.markRow(page.itemID, page.pageIndex, i, false);
          });
          span.addEventListener("dblclick", () => {
            const reader = this.reader();
            const v = reader && self.viewer(reader);
            if (!v) return;
            v.pdfViewer.currentPageNumber = page.pageIndex + 1;
            v.iframeWin.setTimeout(() => self.highlightPdfSentence(v, page.pageIndex, page, i)?.scrollIntoView({ block: "center" }), 300);
          });
          paraEl.appendChild(span);
          rows.push(span);
        });
        return { el, page, rows, textEls };
      },

      onPageReady(itemID, pageIndex, page) {
        if (this.destroyed || itemID !== this.itemID || pageIndex !== this.pageIndex) return;
        if (this.blocks.get(pageIndex)?.page !== page) this.renderList(page);
      },

      // size, color 가 null 이면 저장된 설정값을 써요. color "" 는 기본 색이에요.
      applyTextStyle(size, color) {
        const s = size ?? (self.pref("fontPx") || 0);
        const c = color ?? (self.pref("textColor") || "");
        for (const b of this.blocks.values()) {
          for (const el of b.textEls) {
            el.style.fontSize = s ? s + "px" : "";
            el.style.color = c;
          }
        }
      },

      markRow(itemID, pageIndex, sIdx, scroll) {
        if (itemID !== this.itemID) return;
        for (const b of this.blocks.values()) for (const r of b.rows) r?.classList.remove("on");
        const row = this.blocks.get(pageIndex)?.rows[sIdx];
        if (!row) return;
        row.classList.add("on");
        if (scroll) row.scrollIntoView({ block: "nearest" });
      },

      async translateCurrent() {
        const reader = this.reader();
        const v = reader && self.viewer(reader);
        if (!v) {
          this.setStatus("PDF 화면에서만 쓸 수 있어요.");
          return;
        }
        const itemID = reader.itemID;
        const pageIndex = v.pdfViewer.currentPageNumber - 1;
        this.itemID = itemID;
        this.pageIndex = pageIndex;
        self.hookViewer(reader, v);
        if (!self.cache.get(itemID)?.get(pageIndex)) this.setStatus(`${pageIndex + 1}쪽 번역 중…`);
        try {
          const page = await self.getTranslation(reader, pageIndex, { front: true });
          if (!this.metaDone) {
            this.metaDone = true;
            this.renderMeta(reader);
          }
          if (!this.destroyed && this.itemID === itemID && this.pageIndex === pageIndex) {
            if (this.blocks.get(pageIndex)?.page !== page) this.renderList(page);
          }
          self.prefetchAhead(reader, pageIndex);
        } catch (e) {
          self.fileLog("translate failed: " + self.errText(e));
          if (this.itemID === itemID && this.pageIndex === pageIndex) {
            this.setStatus(
              e.userFacing ? e.message : "번역하지 못했어요. 다시 눌러 주세요. (" + (e.status || e.message || e) + ")"
            );
          }
        }
      },

      renderQueue() {
        const q = self.queue;
        if (!q || q.itemID !== this.itemID) {
          progBox.style.display = "none";
          return;
        }
        progBox.style.display = "";
        const doneAll = q.done + q.failed;
        progText.textContent = q.finished
          ? q.stopped
            ? `멈췄어요 · ${q.done}/${q.total}쪽 번역함` + (q.lastError ? ` (${q.lastError})` : "")
            : `끝났어요 · ${q.done}/${q.total}쪽 번역함` + (q.failed ? ` · ${q.failed}쪽 실패` : "")
          : `${q.done}/${q.total}쪽 번역함…`;
        stopLink.style.display = q.finished ? "none" : "";
        progFill.style.width = (q.total ? (doneAll / q.total) * 100 : 0) + "%";
      },

      startQueue(fromPage, toPage) {
        const reader = this.reader();
        const n = reader ? self.numPages(reader) : 0;
        if (!n) {
          this.setStatus("PDF 화면에서만 쓸 수 있어요.");
          return;
        }
        const a = Math.max(1, Math.min(n, fromPage || 1));
        const b = Math.max(a, Math.min(n, toPage || n));
        // 지금 보는 페이지부터 먼저
        const cur = this.pageIndex >= 0 ? this.pageIndex : a - 1;
        const pages = [];
        for (let i = a - 1; i <= b - 1; i++) pages.push(i);
        pages.sort((x, y) => (x >= cur ? 0 : 1) - (y >= cur ? 0 : 1) || x - y);
        self.runQueue(reader, pages);
      },

      // 번역문에서 드래그로 고른 부분을 [{u, from, to}] 로 바꿔요(한 쪽 안에서).
      readSelection() {
        const sel = doc.getSelection?.() || doc.defaultView.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
        const r = sel.getRangeAt(0);
        if (!list.contains(r.commonAncestorContainer)) return null;
        const block = [...this.blocks.values()].find((b) => b.el.contains(r.startContainer));
        if (!block) return null;
        const offsetIn = (span, node, off) => {
          const rr = doc.createRange();
          rr.selectNodeContents(span);
          rr.setEnd(node, off);
          return rr.toString().length;
        };
        const pieces = [];
        block.rows.forEach((span, i) => {
          if (!span || !r.intersectsNode(span)) return;
          const len = span.textContent.length;
          const from = span.contains(r.startContainer) ? offsetIn(span, r.startContainer, r.startOffset) : 0;
          const to = span.contains(r.endContainer) ? offsetIn(span, r.endContainer, r.endOffset) : len;
          if (to > from) pieces.push({ u: i, from, to });
        });
        return pieces.length ? { page: block.page, pieces, rect: r.getBoundingClientRect() } : null;
      },

      onSelect() {
        const got = this.readSelection();
        if (!got) {
          selBar.style.display = "none";
          this.selPieces = null;
          return;
        }
        this.selPieces = got.pieces;
        this.selPage = got.page;
        const marks = self.underlinesFor(got.page.itemID, got.page.pageIndex);
        const overlaps = got.pieces.some((pc) => marks.some((m) => m.u === pc.u && m.to > pc.from && m.from < pc.to));
        unulBtn.style.display = overlaps ? "" : "none";
        // 막대가 사이드바 밖으로 나가지 않게
        selBar.style.left = "0px";
        const wr = wrap.getBoundingClientRect();
        selBar.style.display = "";
        selBar.style.left = Math.max(0, Math.min(got.rect.left - wr.left, wr.width - selBar.offsetWidth)) + "px";
        selBar.style.top = Math.max(0, got.rect.top - wr.top - 40) + "px";
      },

      // color 가 null 이면 고른 부분의 표시를 지워요.
      async applyMark(color) {
        const page = this.selPage;
        const pieces = this.selPieces;
        selBar.style.display = "none";
        if (!page || !pieces) return;
        (doc.getSelection?.() || doc.defaultView.getSelection())?.removeAllRanges();
        try {
          if (!color) await self.removeMarks(page, pieces);
          else {
            const ko = pieces.some((pc) => pc.from > 0 || pc.to < (page.lines[pc.u] || "").trim().length - 1);
            if (ko && (self.pref("engine") || "claude-code") !== "google") this.setStatus("원문에서 같은 부분을 찾는 중…");
            await self.addMarks(page, pieces, { type: self.pref("markType") || "highlight", color }, () => this.renderList(page));
            if (this.shown) this.showStatus(this.shown);
          }
        } catch (e) {
          self.fileLog("mark failed: " + self.errText(e));
        }
        this.renderList(page);
      },

      // 각주 창 열기: 위첨자 바로 아래에 띄워요.
      async showNote(num, anchor) {
        const reader = this.reader();
        if (!reader) return;
        const wr = wrap.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        notePop.style.display = "";
        notePop.style.top = ar.bottom - wr.top + 6 + "px";
        noteTitle.textContent = "각주 " + num;
        noteBody.textContent = "각주를 찾는 중…";
        noteSrc.textContent = "";
        const token = (this._noteToken = {});
        try {
          const notes = await self.noteIndex(reader);
          if (this._noteToken !== token) return;
          const text = notes.get(num);
          if (!text) {
            noteBody.textContent = "이 각주 내용을 PDF에서 찾지 못했어요. 글자 인식이 깨진 각주일 수 있어요.";
            return;
          }
          noteSrc.textContent = text;
          noteBody.textContent = "번역 중…";
          const ko = await self.noteTranslation(reader, num, text);
          if (this._noteToken !== token) return;
          noteBody.textContent = ko || text;
        } catch (e) {
          self.fileLog("note failed: " + self.errText(e));
          if (this._noteToken === token) noteBody.textContent = e.userFacing ? e.message : "각주를 불러오지 못했어요.";
        }
      },

      // 페이지가 바뀌었는지 1초마다 확인해요.
      tick() {
        this.fitScroll(); // 설정 칸을 열고 닫으면 높이가 바뀌어요
        const reader = this.reader();
        const v = reader && self.viewer(reader);
        if (!v) return;
        const p = v.pdfViewer.currentPageNumber - 1;
        if (reader.itemID !== this.itemID || p !== this.pageIndex) this.refresh();
      },

      destroy() {
        this.destroyed = true;
        if (this.timer) doc.defaultView.clearInterval(this.timer);
        this.timer = null;
      },
    };

    btn.addEventListener("click", () => pane.translateCurrent());
    langSel.addEventListener("change", () => {
      self.setPref("targetLang", langSel.value);
      // 언어를 바꾸면 그 언어로 저장해 둔 번역을 먼저 찾고, 없을 때만 새로 번역해요.
      if (pane.itemID != null) self.cache.delete(pane.itemID);
      pane.refresh();
      pane.translateCurrent();
    });
    allBtn.addEventListener("click", () => pane.startQueue(1, 0));
    rangeBtn.addEventListener("click", () => pane.startQueue(Number(fromIn.value) || 1, Number(toIn.value) || 0));
    stopLink.addEventListener("click", () => {
      if (self.queue) self.queue.stopped = true;
      pane.renderQueue();
    });
    list.addEventListener("mouseup", () => doc.defaultView.setTimeout(() => pane.onSelect(), 0));
    // 번역 끝이 화면에 보인 뒤에도 조금 더 내리면(문라이트처럼) 다음 쪽으로 넘어가요.
    // 넘어가면 오른쪽 칸이 새 번역의 맨 위로 올라가요. 트랙패드 관성으로 여러 쪽이 한꺼번에 넘어가지 않게,
    // 한 번 넘긴 뒤에는 손을 잠깐 멈출 때까지 기다려요.
    let over = 0;
    let lastWheel = 0;
    let locked = false;
    const onWheel = (e) => {
      const now = Date.now();
      const quiet = now - lastWheel > 250;
      lastWheel = now;
      if (locked) {
        if (!quiet) {
          e.preventDefault();
          return;
        }
        locked = false;
      }
      if (e.deltaY <= 0) {
        over = 0;
        return;
      }
      const sc = pane.scroller();
      const end = list.getBoundingClientRect().bottom;
      const viewBottom = sc ? sc.getBoundingClientRect().bottom : doc.defaultView.innerHeight;
      if (end > viewBottom + 2) {
        over = 0; // 아직 번역이 더 남았어요
        return;
      }
      const reader = pane.reader();
      const v = reader && self.viewer(reader);
      if (!v || !pane.blocks.get(pane.pageIndex)) return;
      e.preventDefault();
      over += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (over < 140) return; // 살짝 더 내렸을 때만
      over = 0;
      locked = true;
      const n = Number(v.pdfViewer.pagesCount) || Infinity;
      if (pane.pageIndex + 1 < n) {
        v.pdfViewer.currentPageNumber = pane.pageIndex + 2;
        doc.defaultView.setTimeout(() => !pane.destroyed && pane.tick(), 30);
      }
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    nextRow.addEventListener("wheel", onWheel, { passive: false });
    prevBtn.addEventListener("click", () => {
      const reader = pane.reader();
      const v = reader && self.viewer(reader);
      if (v && pane.pageIndex > 0) v.pdfViewer.currentPageNumber = pane.pageIndex;
    });
    nextBtn.addEventListener("click", () => {
      const reader = pane.reader();
      const v = reader && self.viewer(reader);
      if (!v) return;
      const n = Number(v.pdfViewer.pagesCount) || Infinity;
      if (pane.pageIndex + 1 < n) v.pdfViewer.currentPageNumber = pane.pageIndex + 2;
    });
    doc.defaultView.addEventListener("resize", () => !pane.destroyed && pane.fitScroll());
    // 오른쪽 칸 전체를 스크롤하면 "다음 쪽" 단추 자리도 바로 따라가요.
    let pframe = 0;
    doc.addEventListener(
      "scroll",
      () => {
        if (pframe || pane.destroyed) return;
        pframe = doc.defaultView.requestAnimationFrame(() => {
          pframe = 0;
          pane.fitScroll();
        });
      },
      { capture: true, passive: true }
    );
    wrap.addEventListener("mousedown", (e) => {
      if (notePop.style.display !== "none" && !notePop.contains(e.target)) notePop.style.display = "none";
    });
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape") notePop.style.display = "none";
    });
    unulBtn.addEventListener("mousedown", (e) => e.preventDefault());
    unulBtn.addEventListener("click", () => pane.applyMark(null));

    body._trans_yb = pane;
    this.panes.add(pane);
    pane.refresh();
    pane.timer = doc.defaultView.setInterval(() => pane.tick(), 1000);
  },
};
