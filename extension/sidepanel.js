// HIVE Bridge - side panel. The same HIVE web app, beside the tab you are working in.
// panel=1 gives the compact start; the id connects this extension automatically.
document.getElementById("app").src = "https://hive-ny.pages.dev/?panel=1#hive_ext_id=" + chrome.runtime.id;
