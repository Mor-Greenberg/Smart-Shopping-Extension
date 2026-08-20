// Reveal the popup shell as early as possible.
// Chrome sizes action popups from the first layout; <body hidden> +
// [hidden]{display:none!important} yields a 0-height window that never appears.
(function revealPopupShell() {
    function show() {
        if (document.body) document.body.hidden = false;
    }
    show();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', show, { once: true });
    }
})();
