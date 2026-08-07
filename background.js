chrome.action.onClicked.addListener(execScript);

async function execScript() {
  const tabId = await getTabId();
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['execute.js'],
      world: 'MAIN'
    });
  } catch (e) {
    // Injection is rejected on chrome://, the new-tab page, the web store, PDFs,
    // etc. Nothing actionable there — log instead of failing silently.
    console.warn('BMW MyGarage Trick: could not inject execute.js', e);
  }
}

async function getTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.length > 0 ? tabs[0].id : null;
}
