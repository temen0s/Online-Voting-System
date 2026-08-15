// Shared idle-timeout helper used by index.html, admin.html,
// admin-election.html, and admin-results.html.
//
// Starts a background check that fires `onTimeout` once the page has
// seen no mouse/keyboard/scroll/touch activity for `timeoutMs`
// milliseconds. Meant to be called only once a user is actually
// signed in (after login, or once the auth-token guard at the top of
// an admin page has already passed).
function startInactivityGuard(options) {
    const timeoutMs = (options && options.timeoutMs) || 7 * 60 * 1000; // 7 minutes
    const onTimeout = options && options.onTimeout;
    const checkEveryMs = 5000;

    let lastActivity = Date.now();
    const markActivity = () => { lastActivity = Date.now(); };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(evt => window.addEventListener(evt, markActivity, { passive: true }));

    const intervalId = setInterval(() => {
        if (Date.now() - lastActivity >= timeoutMs) {
            clearInterval(intervalId);
            activityEvents.forEach(evt => window.removeEventListener(evt, markActivity));
            if (typeof onTimeout === 'function') onTimeout();
        }
    }, checkEveryMs);

    // Returns a stop function in case a page ever needs to cancel the
    // guard early (e.g. right before its own logout() runs).
    return function stopInactivityGuard() {
        clearInterval(intervalId);
        activityEvents.forEach(evt => window.removeEventListener(evt, markActivity));
    };
}
