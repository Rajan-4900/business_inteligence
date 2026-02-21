# Django Static File Testing & Debug Guide

A beginner-friendly guide to verify your static files load correctly.

---

## 1. How to Test Static Files Are Loading

### Quick visual test
1. Start the dev server:
   ```bash
   python manage.py runserver
   ```
2. Open the homepage: **http://127.0.0.1:8000/**
3. Look for a **green badge** in the bottom-right corner: `✓ style.css loaded`
   - If you see it → CSS is loading correctly
   - If you don’t → CSS is not loading (see Troubleshooting below)

### Browser DevTools
1. Open the page and press **F12** (or right‑click → Inspect).
2. Go to the **Network** tab.
3. Refresh the page (**Ctrl+R** or **Cmd+R**).
4. Filter by **CSS** or **JS**.
5. Check:
   - `style.css` → Status should be **200**
   - `main.js` → Status should be **200**
   - If status is **404** → file path or `STATICFILES_DIRS` is wrong

---

## 2. Temporary Test Styling Added

In `static/css/style.css` there is a **temporary block** at the top:

```css
/* ===== TEMPORARY: Static file test - REMOVE after verification ===== */
.main-content::before {
    content: '✓ style.css loaded';
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: #22c55e;
    ...
}
/* ===== END temporary test ===== */
```

This makes a green badge appear when `style.css` loads.  
**Remove this block after you’ve verified static files work.**

---

## 3. How to Verify CSS Is Applied to the Homepage

| Step | Action |
|------|--------|
| 1 | Run `python manage.py runserver` |
| 2 | Visit **http://127.0.0.1:8000/** |
| 3 | Confirm the green badge appears in the bottom-right corner |
| 4 | Confirm the page looks styled (navbar, footer, cards, etc.) |
| 5 | In DevTools → **Elements** tab → inspect an element → check if `style.css` appears in the **Styles** panel |

If the page is mostly unstyled or looks like plain HTML, CSS is not loading.

---

## 4. Common Django Static File Troubleshooting

### Problem: 404 on `style.css` or `main.js`

**Possible causes and fixes:**

| Fix | What to check |
|-----|----------------|
| **Run collectstatic** | In production, run `python manage.py collectstatic`. In development with `DEBUG=True`, Django serves static files automatically from `STATICFILES_DIRS`. |
| **STATICFILES_DIRS** | In `settings.py`, ensure `STATICFILES_DIRS = [BASE_DIR / 'static']` and that the `static/` folder is inside your project root. |
| **Path** | File should be at `static/css/style.css` (and `static/js/main.js`), not `static/static/css/style.css`. |
| **`{% load static %}`** | Every template that uses `{% static %}` must have `{% load static %}` at the top. |

### Problem: CSS loads but styles don’t apply

| Fix | What to check |
|-----|----------------|
| **Browser cache** | Hard refresh: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac). |
| **Correct selector** | Make sure your CSS selectors match the HTML (check class names and structure). |
| **Specificity** | Other styles (e.g. Bootstrap) may override yours. Use more specific selectors or `!important` only as a last resort. |

### Problem: Static files work locally but not in production

| Fix | What to do |
|-----|------------|
| **collectstatic** | Run `python manage.py collectstatic` before deploying. |
| **STATIC_ROOT** | Set `STATIC_ROOT = BASE_DIR / 'staticfiles'` (or similar) and serve from this folder. |
| **Web server** | Configure nginx/Apache to serve from `STATIC_ROOT`. Don’t rely on Django to serve static files in production. |
| **DEBUG** | With `DEBUG=False`, Django does **not** serve static files; your web server must. |

### Problem: `{% static %}` outputs wrong URL

| Fix | What to check |
|-----|----------------|
| **STATIC_URL** | In `settings.py`, `STATIC_URL = 'static/'` or `'/static/'`. |
| **Restart server** | Restart `runserver` after changing settings. |

---

## Checklist Summary

- [ ] Run `python manage.py runserver`
- [ ] Visit homepage and see green `✓ style.css loaded` badge
- [ ] Check Network tab: `style.css` and `main.js` return 200
- [ ] Page looks styled (navbar, footer, cards)
- [ ] Remove temporary test block from `style.css` after verification
