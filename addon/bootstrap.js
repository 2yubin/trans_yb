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
  Services.scriptloader.loadSubScript(rootURI + "content/trans_yb.js");
  TransYb.init({ id, version, rootURI });
  TransYb.addToAllWindows();
  try {
    TransYb.registerPane();
    TransYb.fileLog("startup ok, version " + version + ", paneID " + TransYb.paneID);
  } catch (e) {
    TransYb.fileLog("registerPane failed: " + TransYb.errText(e));
  }
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
