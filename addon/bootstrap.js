/* trans_yb - 조테로가 플러그인을 켜고 끌 때 부르는 입구 파일 */
var chromeHandle;

function install() {}

async function startup({ id, version, rootURI }) {
  // chrome://trans_yb/content/ 주소로 아이콘 같은 파일을 쓸 수 있게 등록
  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "trans_yb", rootURI + "content/"],
  ]);

  // 실제 기능 코드는 content/trans_yb.js 에 있어요
  // 지원 범위를 열어 두었어요(manifest.json). 새 조테로에서 켜다가 실패하면 조테로는 그대로 두고 안내만 해요.
  try {
    Services.scriptloader.loadSubScript(rootURI + "content/trans_yb.js");
    TransYb.init({ id, version, rootURI });
    TransYb.addToAllWindows();
  } catch (e) {
    Zotero.logError(e);
    warnIncompatible(version, e);
    return;
  }
  try {
    TransYb.registerPane();
    TransYb.fileLog("startup ok, version " + version + ", Zotero " + Zotero.version + ", paneID " + TransYb.paneID);
  } catch (e) {
    TransYb.fileLog("registerPane failed: " + TransYb.errText(e));
    warnIncompatible(version, e);
  }
}

// 같은 조테로 버전에서는 안내 창을 한 번만 띄워요
function warnIncompatible(version, e) {
  try {
    const key = "extensions.trans_yb.warnedZotero";
    if (Zotero.Prefs.get(key, true) === Zotero.version) return;
    Zotero.Prefs.set(key, Zotero.version, true);
    Services.prompt.alert(null, "trans_yb",
      "trans_yb " + version + "이(가) 이 조테로 버전(" + Zotero.version + ")에서 제대로 켜지지 않았어요.\n" +
      "조테로는 그대로 쓰셔도 돼요. 플러그인이 업데이트되면 자동으로 받아요.\n" +
      "https://github.com/2yubin/trans_yb/issues 에 알려 주면 도움이 돼요.\n\n" + String(e && e.message || e));
  } catch (_) {}
}

function onMainWindowLoad({ window }) {
  TransYb.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  TransYb.removeFromWindow(window);
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;
  try {
    TransYb.shutdown();
  } catch (e) {
    Zotero.logError(e);
  }
  TransYb = undefined;
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall() {}
