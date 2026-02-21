# Map Rendering Debug Checklist

Use this checklist when the Leaflet map is not visible on the homepage.

---

## 1. HTML Structure

- [ ] `#heatmap-container` exists
- [ ] `#map` exists inside heatmap-container (Leaflet attaches here)
- [ ] No placeholder div covering the map
- [ ] Leaflet CSS is loaded in `<head>` (`extra_css` block)
- [ ] Leaflet JS is loaded before `main.js` (`extra_js` block in `base.html`)

---

## 2. Script Load Order

Correct order (in `base.html`):

1. Bootstrap JS
2. `{% block extra_js %}` → Leaflet on home page
3. `main.js` (after `extra_js` so Leaflet is available)

If Leaflet loads after `main.js`, `L` will be undefined and the map will not initialize.

---

## 3. Map Container Height

Leaflet needs a container with **explicit dimensions**. Check:

- [ ] `.heatmap-container` has `height: 450px` (or `min-height`)
- [ ] `#map` or `.map-inner` has `position: absolute` and `top/left/right/bottom: 0` to fill parent
- [ ] `.leaflet-container` has `height: 100%` or `min-height`
- [ ] No parent with `height: 0` or `overflow: hidden` clipping the map

**Quick test:** In DevTools, inspect `#map` and check computed height. It must be > 0.

---

## 4. DOMContentLoaded

- [ ] Map init runs in `DOMContentLoaded` (or after)
- [ ] `runMapInit()` is called when DOM is ready
- [ ] `isHeatmapPage()` returns true (container + Leaflet exist)

---

## 5. Z-Index & Overflow

- [ ] Map has `z-index: 0` (or low value)
- [ ] Overlay panels have higher `z-index` (e.g. 500)
- [ ] `.heatmap-wrapper` uses `overflow: hidden` only for border-radius; not clipping map
- [ ] No full-page overlay covering the map

---

## 6. Bootstrap / Flexbox Issues

- [ ] `.heatmap-container` does not use `d-flex` in a way that collapses the map
- [ ] Map div uses `position: absolute` to fill parent (avoids flex sizing issues)
- [ ] No `flex: 0` or `min-height: 0` on the map’s parent chain

---

## 7. Leaflet-Specific

- [ ] Leaflet CSS is loaded (required for tiles and controls)
- [ ] `map.invalidateSize()` is called after init (fixes blank map when container resizes)
- [ ] No JavaScript errors in console (check for `L is not defined`)

---

## Quick Verification

1. Run: `python manage.py runserver`
2. Open: http://127.0.0.1:8000/
3. Scroll to the heatmap section
4. Open DevTools (F12) → Console: no errors
5. Network tab: `leaflet.css`, `leaflet.js`, `main.js` return 200
6. Elements tab: `#map` has computed height > 0

---

## Common Fixes

| Problem | Fix |
|--------|-----|
| Map container has 0 height | Add `min-height: 450px` to `.heatmap-container` and `#map` |
| `L is not defined` | Load Leaflet before `main.js` (use `extra_js` before `main.js` in `base.html`) |
| Map is blank/gray | Call `map.invalidateSize()` after init; ensure container has dimensions before init |
| Map hidden behind overlay | Lower overlay `z-index` or raise map `z-index` (keep overlays above map) |
| Flexbox collapses map | Use `position: absolute; inset: 0` on `#map` so it fills the container |
