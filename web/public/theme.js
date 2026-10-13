// Set the theme before first paint (external file, so the CSP needs no inline script).
try {
  var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
} catch (e) {}
