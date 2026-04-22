(() => {
  const AUTH_KEY = 'kiasAdminAuth';
  const ADMIN_PASSWORD = 'KIAS-0426';
  const ADMIN_PAGES = new Set(['/adim.html', '/admin.html']);

  const normalizePath = (path) => {
    if (!path || path === '/') {
      return '/index.html';
    }

    return path.toLowerCase();
  };

  const currentPath = normalizePath(window.location.pathname);

  const isAuthed = () => sessionStorage.getItem(AUTH_KEY) === 'true';

  const showMessage = (node, message, ok = false) => {
    node.textContent = message;
    node.style.color = ok ? '#33d777' : '#ff6b6b';
  };

  const unlockAdmin = () => {
    sessionStorage.setItem(AUTH_KEY, 'true');
  };

  const enforcePageProtection = () => {
    if (!ADMIN_PAGES.has(currentPath) || isAuthed()) {
      return;
    }

    const supplied = window.prompt('Enter admin password to continue:');

    if (supplied === ADMIN_PASSWORD) {
      unlockAdmin();
      return;
    }

    window.alert('Wrong password. Returning to homepage.');
    window.location.replace('/index.html');
  };

  const wirePortalButton = () => {
    const button = document.querySelector('[data-admin-portal]');
    const input = document.querySelector('[data-admin-password]');
    const message = document.querySelector('[data-admin-message]');

    if (!button || !input || !message) {
      return;
    }

    const attemptAccess = () => {
      const password = input.value.trim();

      if (password !== ADMIN_PASSWORD) {
        showMessage(message, 'Incorrect password.');
        return;
      }

      unlockAdmin();
      showMessage(message, 'Access granted. Redirecting...', true);
      window.location.assign('/adim.html');
    };

    button.addEventListener('click', attemptAccess);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        attemptAccess();
      }
    });
  };

  enforcePageProtection();
  wirePortalButton();
})();
