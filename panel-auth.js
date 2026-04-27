(() => {
  const accessKey = "kiasPanelAccess";
  const sessionDurationMs = 12 * 60 * 60 * 1000;
  const maxAttempts = 3;

  const readConfigPassword = () => {
    const meta = document.querySelector('meta[name="kias-panel-password"]');
    const value = meta?.getAttribute("content") || "";
    return value.trim() || "<KIAS.exe>";
  };

  const readConfigLabel = () => {
    const meta = document.querySelector('meta[name="kias-panel-label"]');
    return (meta?.getAttribute("content") || "KIAS Restricted Panel").trim();
  };

  const hasValidSession = (pathname) => {
    const raw = localStorage.getItem(accessKey);
    if (!raw) return false;

    try {
      const parsed = JSON.parse(raw);
      const routes = Array.isArray(parsed.routes) ? parsed.routes : [];
      const expiresAt = Number(parsed.expiresAt) || 0;
      if (Date.now() > expiresAt) return false;
      return routes.includes(pathname) || routes.includes("*");
    } catch {
      return false;
    }
  };

  const persistSession = (pathname) => {
    const expiresAt = Date.now() + sessionDurationMs;
    const payload = {
      expiresAt,
      routes: [pathname],
      grantedAt: new Date().toISOString()
    };
    localStorage.setItem(accessKey, JSON.stringify(payload));
  };

  const challengeForPassword = (label, expectedPassword) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const provided = window.prompt(`${label}\nPassword required (${attempt}/${maxAttempts})`);
      if (provided === null) return false;
      if (provided === expectedPassword) return true;
      window.alert("Incorrect password.");
    }

    return false;
  };

  const pathname = window.location.pathname;
  if (hasValidSession(pathname)) return;

  const expectedPassword = readConfigPassword();
  const label = readConfigLabel();
  const granted = challengeForPassword(label, expectedPassword);

  if (!granted) {
    window.location.replace("/");
    return;
  }

  persistSession(pathname);
})();
