# Geolocation Fix — Django + Frontend

## 1. Where exactly the issue was

- **No secure-context check:** `navigator.geolocation` only works on **HTTPS** or **localhost**. On HTTP (e.g. `http://192.168.x.x:8000`) the API may exist but the browser can block or fail silently.
- **Coordinates not sent to Django:** The frontend used lat/lon only for the map and other client-side APIs; there was **no endpoint** to receive and store the user’s location on the backend.
- **Generic error handling:** All failures showed the same “Location unavailable” message; there was no distinction between **permission denied (1)**, **position unavailable (2)**, and **timeout (3)**.
- **No debugging:** Hard to see whether the failure was permission, timeout, or environment (e.g. non-HTTPS).
- **Possible CSRF on new API:** Any new POST endpoint must receive the CSRF token in the request (e.g. header `X-CSRFToken`); the fix uses the existing `getCookie('csrftoken')` and sends it with the location POST.
- **Map:** You use **Leaflet + OpenStreetMap** (no Mapbox/Google Maps API keys). No API key change was required for the map; only geolocation and backend integration were fixed.

---

## 2. Fixed frontend JS code

The following is implemented in `static/js/main.js`:

- **`isGeolocationSecure()`** — Returns true only for `https:` or `localhost` / `127.0.0.1`.
- **`geoLog(...)`** — Console logging only when `GEOLOCATION_DEBUG` is true (auto true on localhost).
- **`sendLocationToBackend(lat, lon, accuracy, source)`** — POSTs `{ latitude, longitude, accuracy, source }` to `/api/user-location/` with `X-CSRFToken` and `Content-Type: application/json`.
- **`getGeolocationErrorMessage(code, defaultMsg)`** — Maps error code 1 → permission denied, 2 → unavailable, 3 → timeout.
- **Find My Location button handler:**
  1. Clears previous error, disables button, shows “Locating...”.
  2. Checks secure context; if not secure, shows “Location requires HTTPS or localhost” and tries IP fallback.
  3. If `navigator.geolocation` is missing, tries IP fallback only.
  4. Calls `navigator.geolocation.getCurrentPosition(success, error, options)` with:
     - `enableHighAccuracy: true`
     - `timeout: 20000`
     - `maximumAge: 60000`
  5. On **success:** validates lat/lon, updates map/marker, calls `sendLocationToBackend()`, then `findPopularPlaces` and `updateCrowdIntensityDropdown`, then resets button.
  6. On **error:** logs code/message, shows specific message (permission/unavailable/timeout), tries IP fallback; if IP succeeds, runs same flow and sends `source: 'ip'` to backend.
- **No hardcoded static location:** Initial map view remains `[51.505, -0.09]` until the user clicks “Find My Location” or searches; user location is never overwritten by a fixed default after success.

---

## 3. Fixed Django views.py code

New view in `heatmap_app/views.py`:

```python
@csrf_exempt
@require_http_methods(['POST'])
def report_user_location(request):
    """
    Receive user's current location (from browser geolocation or IP fallback).
    POST body: { "latitude": float, "longitude": float, "accuracy": int (optional), "source": "gps"|"ip" (optional) }
    """
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)
    lat = data.get('latitude')
    lon = data.get('longitude')
    if lat is None or lon is None:
        return JsonResponse({'success': False, 'message': 'latitude and longitude are required'}, status=400)
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'message': 'latitude and longitude must be numbers'}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return JsonResponse({'success': False, 'message': 'latitude/longitude out of range'}, status=400)
    source = data.get('source') or 'gps'
    request.session['user_lat'] = lat
    request.session['user_lon'] = lon
    request.session['user_location_source'] = source
    return JsonResponse({
        'success': True,
        'message': 'Location received',
        'latitude': lat,
        'longitude': lon,
        'source': source,
    })
```

**URL** (in `heatmap_app/urls.py`):

```python
path('api/user-location/', views.report_user_location, name='report_user_location'),
```

Django receives and validates coordinates and can use them for map/heatmap (e.g. from `request.session['user_lat']` / `user_lon`). No API keys are used for this endpoint.

---

## 4. Example HTML button / location loader

Your existing markup is already correct. Minimal example for reference:

```html
<div class="card">
    <div class="section-title">Accuracy</div>
    <div id="location-error-msg" class="location-error-msg" style="display: none;"></div>
    <div class="accuracy-meter-container">
        <label>GPS accuracy</label>
        <div class="meter-wrapper">
            <div class="meter-bar">
                <div id="accuracy-meter" class="meter-fill">0%</div>
            </div>
            <span id="accuracy-value">0%</span>
        </div>
    </div>
</div>
<!-- In Search card: -->
<button id="find-location-btn" class="panel-btn" type="button">Find My Location</button>
```

- **`#location-error-msg`** — Where “Location unavailable” / “Permission denied” / etc. are shown.
- **`#find-location-btn`** — Triggers `navigator.geolocation.getCurrentPosition` and then backend send + map update.
- **`#accuracy-meter`** / **`#accuracy-value`** — Updated from `position.coords.accuracy` (or fallback % for IP).

Optional loading state (already implied by button text “Locating...”):

```html
<button id="find-location-btn" class="panel-btn" type="button" aria-busy="false">Find My Location</button>
```

In JS you can set `btn.setAttribute('aria-busy', 'true')` while locating and `'false'` when done.

---

## 5. Debugging steps if still not working

1. **Run on HTTPS or localhost**
   - Open the app as `https://yoursite.com` or `http://127.0.0.1:8000` / `http://localhost:8000`.
   - Avoid `http://192.168.x.x:8000` for testing geolocation (many browsers restrict it).

2. **Open DevTools (F12) → Console**
   - On localhost, `[Geolocation]` logs appear: “Requesting position…”, “getCurrentPosition success/error”, “Sending location to backend”, etc.
   - If you see “Geolocation requires HTTPS or localhost”, the origin is not secure.

3. **Check permission**
   - In the address bar, click the lock/site icon and see if “Location” is set to Allow/Block.
   - If it’s Block, set to “Allow” and reload, then click “Find My Location” again.
   - For code `1` (PERMISSION_DENIED), the UI now shows: “Location permission denied. Allow location in browser settings or use search.”

4. **Verify backend**
   - In DevTools → Network, click “Find My Location” and find the `POST /api/user-location/` request.
   - Check: Status 200, response body `{ "success": true, "latitude": ..., "longitude": ... }`.
   - If 403, check CSRF: request headers should include `X-CSRFToken` and the cookie `csrftoken` must be present (Django sends it with the first HTML response).

5. **Simulate location (Chrome)**
   - DevTools → ⋮ → More tools → Sensors → Location → choose “Custom location” and enter lat/lon. Then click “Find My Location” to test without real GPS.

6. **If “Location unavailable” still appears**
   - Note the exact message (permission denied / unavailable / timeout).
   - Confirm you’re on HTTPS or localhost and that the permission popup was shown and allowed.
   - Check console for `[Geolocation] getCurrentPosition error: <code> <message>` and for any failed `sendLocationToBackend` or network errors.

---

## 6. Best-practice version (production ready)

Already applied in your codebase; summary:

- **Secure context:** Use geolocation only when `isGeolocationSecure()` is true; otherwise show a clear message and optionally use IP fallback.
- **Single flow:** One “Find My Location” handler: secure check → `getCurrentPosition` → on success send to backend then update map; on error show specific message and try IP fallback, then send IP coords to backend if available.
- **Backend:** Dedicated POST endpoint that validates lat/lon, returns JSON, and optionally stores in session for server-side map/heatmap logic.
- **CSRF:** All POSTs from the frontend include `X-CSRFToken: getCookie('csrftoken')`; no hardcoded tokens.
- **Errors:** User sees distinct messages for permission denied (1), position unavailable (2), and timeout (3); no generic “Location unavailable” for permission.
- **Debugging:** `GEOLOCATION_DEBUG` is true only on localhost so production doesn’t log position data; you can force `true` temporarily if needed.
- **No static user location:** User position is never replaced by a hardcoded default; only the initial map center is fixed until the user triggers location or search.
- **Map:** Leaflet + OSM; no extra API keys. Coordinates from geolocation (or IP) are sent to Django and used to center the map and load popular places / crowd intensity.

To enable automatic location on page load (optional), call the same “Find My Location” logic once after page load, e.g.:

```js
document.addEventListener('DOMContentLoaded', function() {
    // Optional: auto-detect on load (will show permission popup)
    // document.getElementById('find-location-btn').click();
});
```

Leaving this commented avoids the permission popup on first load; users can click “Find My Location” when they want to share location.
