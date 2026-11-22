// 플러그인 기본 설정값. 조테로가 처음 켤 때 읽어요.
pref("extensions.trans_yb.targetLang", "ko");   // 번역할 언어
pref("extensions.trans_yb.autoNextPage", true);  // 페이지를 넘기면 자동 번역
pref("extensions.trans_yb.engine", "claude-code"); // claude-code, codex, claude, google
pref("extensions.trans_yb.claudeModel", "claude-opus-5-5");
pref("extensions.trans_yb.anthropicKey", "");    // 사이드바 설정에서 넣어요
pref("extensions.trans_yb.fontPx", 0);         // 번역 글씨 크기(px), 0 = 조테로 기본 크기
pref("extensions.trans_yb.textColor", "");      // 빈 값 = 기본 글씨 색
pref("extensions.trans_yb.styleOpen", false);    // 글씨 설정 펼침 상태
pref("extensions.trans_yb.engineOpen", false);   // 번역 엔진 설정 펼침 상태
pref("extensions.trans_yb.askOpen", true);         // "AI에게 묻기" 칸을 처음에 펼쳐 둬요
pref("extensions.trans_yb.claudeCodePath", "");  // 비우면 자동으로 찾아요
pref("extensions.trans_yb.prefetchOpen", false);  // 미리 번역 펼침 상태
pref("extensions.trans_yb.markType", "highlight"); // 번역문 표시 종류: highlight(형광펜) 또는 underline(밑줄)
pref("extensions.trans_yb.codexPath", "");       // 비우면 자동으로 찾아요
