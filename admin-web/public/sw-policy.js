/*
 * Caching policy for the GIVOVA Coleta service worker (shared with the unit tests).
 *
 * Only immutable build assets, icons/manifest and the /coleta page shell are ever cached.
 * Never cached: any non-GET request (scans, login, dispatch...), anything under /api/, any other origin
 * (the API lives on its own domain), RSC/data requests. Stock, loads and tokens always come from the network.
 */
(function (root) {
  var SHELL_PATHS = ["/coleta"];
  var STATIC_PREFIXES = ["/_next/static/", "/icons/"];
  var STATIC_FILES = ["/manifest.webmanifest", "/icon.svg"];

  /**
   * @param {string} url absolute request URL
   * @param {string} method HTTP method
   * @param {string} mode request.mode ("navigate" for page loads)
   * @param {string} origin the service worker origin
   * @returns {"bypass" | "cache-first" | "network-first-shell"}
   */
  function cachePolicy(url, method, mode, origin) {
    if (method !== "GET") return "bypass";
    var u;
    try {
      u = new URL(url);
    } catch (e) {
      return "bypass";
    }
    if (u.origin !== origin) return "bypass";
    if (u.pathname.indexOf("/api/") === 0) return "bypass";
    if (u.search.indexOf("_rsc=") !== -1) return "bypass";
    for (var i = 0; i < STATIC_PREFIXES.length; i++) {
      if (u.pathname.indexOf(STATIC_PREFIXES[i]) === 0) return "cache-first";
    }
    if (STATIC_FILES.indexOf(u.pathname) !== -1) return "cache-first";
    if (mode === "navigate" && SHELL_PATHS.indexOf(u.pathname.replace(/\/$/, "")) !== -1) return "network-first-shell";
    return "bypass";
  }

  root.GivovaSwPolicy = { cachePolicy: cachePolicy, SHELL_PATHS: SHELL_PATHS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.GivovaSwPolicy;
})(typeof self !== "undefined" ? self : globalThis);
