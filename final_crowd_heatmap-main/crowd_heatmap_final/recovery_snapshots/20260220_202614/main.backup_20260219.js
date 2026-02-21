/**
 * Crowd Heatmap - Main Application Script
 * Handles map, dashboard, and universal UI enhancements.
 */

let map;
let baseTileLayer = null;
let userMarker = null;
let searchMarkers = [];
let popularPlacesMarkers = [];
let currentAccuracy = 0;
let crowdIntensityAreas = [];
let heatmapLayers = [];
let radiusCircle = null;
let buildingOutlineLayers = [];
let lastCrowdIntensityData = { high: [], medium: [], low: [] };
let businessByIntensity = {};
let businessRecommendationMarkers = [];
let lastPopularPlacesResult = { places: [], lat: null, lon: null };
let routingControl = null;
let orangeMarkers = [];          // orange markers for business-type matches
let chatbotMinimized = false;
let aiBusinessFlowAwaitingIntensity = false;
let aiBusinessFlowLocationDesc = null;
let mapMinimized = false;
let chatSocket = null;
const feasibilityResultCache = new Map();
let feasibilityWarmupTimer = null;

async function getFeasibilityWithCache(lat, lon, businessType, ttlMs = 120000) {
    const cacheKey = `${lat.toFixed(4)}|${lon.toFixed(4)}|${String(businessType || '').toLowerCase().trim()}`;
    const cacheHit = feasibilityResultCache.get(cacheKey);
    if (cacheHit && (Date.now() - cacheHit.ts) < ttlMs) {
        return cacheHit.data;
    }

    const feasRes = await fetch('/check-feasibility/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({
            latitude: lat,
            longitude: lon,
            business_type: businessType || ''
        })
    });
    const feasData = await feasRes.json();
    feasibilityResultCache.set(cacheKey, { data: feasData, ts: Date.now() });
    return feasData;
}

// Forward declarations for business type elements (initialized in initBusinessTypeElements)
let businessTypeInput, businessTypeSelect, recommendedBusinessHidden;
// All available business categories (populated after location analysis)
let _allBusinessCategories = [];

// Page context: computed when DOM is ready
function isHeatmapPage() {
    const container = document.getElementById('heatmap-container') || document.getElementById('map');
    return !!(container && typeof L !== 'undefined');
}

// Heatmap container initialization - runs after DOM and Leaflet ready
function initHeatmapContainer() {
    const mapEl = document.getElementById('map');
    if (!mapEl || typeof L === 'undefined') return null;
    map = L.map('map').setView([51.505, -0.09], 13);
    baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Â© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    // Recalc size after layout (fixes invisible map)
    requestAnimationFrame(function () {
        if (map && map.invalidateSize) map.invalidateSize();
    });
    window.addEventListener('load', function onMapLoad() {
        if (map && map.invalidateSize) map.invalidateSize();
        window.removeEventListener('load', onMapLoad);
    });

    // Attach map click listener here (safe once map is initialized)
    map.on('click', async function (e) {
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;

        // Update form coordinates
        const latInput = document.getElementById('id_latitude');
        const lonInput = document.getElementById('id_longitude');
        if (latInput) latInput.value = lat;
        if (lonInput) lonInput.value = lon;

        // Add temporary marker
        if (userMarker) {
            map.removeLayer(userMarker);
        }
        userMarker = L.marker([lat, lon]).addTo(map)
            .bindPopup('Selected Location').openPopup();

        // Update accuracy (clicking on map has high accuracy)
        updateAccuracyMeter(95);
        showLocationError('');

        // Automatically find popular places around the clicked location
        await findPopularPlaces(lat, lon, false);
        await updateCrowdIntensityDropdown(lat, lon);

        notifyChatFromMap(`Location set by map click (${lat.toFixed(4)}, ${lon.toFixed(4)}). Popular places and crowd intensity updated.`);
    });

    return map;
}

// Run map init when DOM ready (Only on Home page, Dashboard uses dynamic init)
function runMapInit() {
    if (!isHeatmapPage() || window.location.pathname.includes('/dashboard/')) return;
    initHeatmapContainer();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runMapInit);
} else {
    runMapInit();
}

// Popular places panel DOM references
let popularPlacesPanel = document.getElementById('popular-places-panel');
let popularPlacesList = document.getElementById('popular-places-list');
let popularPlacesCloseBtn = document.getElementById('popular-places-close');

// Wire up close button for popular places panel
if (popularPlacesCloseBtn && popularPlacesPanel) {
    popularPlacesCloseBtn.addEventListener('click', () => {
        popularPlacesPanel.style.display = 'none';
    });
}

// Show/hide location error message (no popup)
function showLocationError(msg) {
    const el = document.getElementById('location-error-msg');
    if (!el) return;
    if (msg) {
        el.textContent = msg;
        el.style.display = 'block';
    } else {
        el.textContent = '';
        el.style.display = 'none';
    }
}

// Update accuracy meter (safe if elements missing)
function updateAccuracyMeter(accuracy) {
    const num = Math.max(0, Math.min(100, Number(accuracy)));
    currentAccuracy = num;
    const meterFill = document.getElementById('accuracy-meter');
    const accuracyValue = document.getElementById('accuracy-value');
    if (meterFill) {
        meterFill.style.width = num + '%';
        meterFill.textContent = num + '%';
    }
    if (accuracyValue) {
        accuracyValue.textContent = num + '%';
    }
}

// Calculate accuracy based on location precision (always returns 5â€“100)
function calculateAccuracy(position) {
    const accuracyMeters = position.coords.accuracy;
    if (!accuracyMeters || accuracyMeters <= 0) return 95;
    // Better precision (smaller radius) => higher %. Cap so we never show 0 when we have a fix.
    const rawPercent = Math.max(0, 100 - (accuracyMeters / 2));
    return Math.round(Math.max(5, Math.min(100, rawPercent)));
}

// --- Utility: debounce ---
function debounce(fn, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Safe event listener - no-op when element missing (e.g. on dashboard page)
function safeOn(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
}

// Styled in-page toast (replaces alert for heatmap errors/success)
function showHeatmapToast(message, type) {
    const toast = document.getElementById('heatmap-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'heatmap-toast visible ' + (type || 'error');
    clearTimeout(toast._toastTimer);
    toast._toastTimer = setTimeout(function () {
        toast.classList.remove('visible');
    }, 5000);
}

// Search Location (logic)
async function searchLocation(query) {
    if (!query) {
        alert('Please enter a location to search');
        return;
    }
    // Clear previous AI recommendation
    const mlBox = document.getElementById('mlPrediction');
    if (mlBox) mlBox.style.display = 'none';

    // Switch to first tab when searching (if on home page)
    const firstTabBtn = document.getElementById('top-recs-tab') || document.getElementById('dash-recs-tab');
    if (firstTabBtn) {
        const tab = new bootstrap.Tab(firstTabBtn);
        tab.show();
    }

    updateBusinessTypeOptionsFromPrediction(null, null);

    try {
        const response = await fetch('/search-location/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ query: query })
        });

        const data = await response.json();

        if (data.success) {
            // Clear previous search markers
            searchMarkers.forEach(marker => map.removeLayer(marker));
            searchMarkers = [];

            // Add markers for search results
            data.results.forEach((result, index) => {
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                const marker = L.marker([lat, lon], {
                    icon: L.icon({
                        iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-red.png',
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        popupAnchor: [1, -34],
                        shadowSize: [41, 41]
                    })
                }).addTo(map)
                    .bindPopup(`<b>${result.display_name}</b><br><button onclick="selectSearchResult(${lat}, ${lon})" style="margin-top: 5px; padding: 5px 10px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">Select This Location</button>`);

                searchMarkers.push(marker);
            });

            // Center map on first result
            if (data.results.length > 0) {
                const firstResult = data.results[0];
                const lat = parseFloat(firstResult.lat);
                const lon = parseFloat(firstResult.lon);
                map.setView([lat, lon], 15);
                updateAccuracyMeter(85);
                showLocationError('');

                // Update form coordinates
                const latField = document.getElementById('id_latitude');
                const lonField = document.getElementById('id_longitude');
                if (latField) latField.value = lat;
                if (lonField) lonField.value = lon;

                return { success: true, lat, lon };
            }
        } else {
            alert('Error searching location: ' + (data.error || data.message));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error searching location');
    }
    return { success: false };
}

safeOn('search-btn', 'click', async function () {
    const query = document.getElementById('location-search').value.trim();
    await searchLocation(query);
});

// Enter key for search
safeOn('location-search', 'keypress', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('search-btn').click();
    }
});

// --- Autocomplete for top search field ---
const locationSearchInput = document.getElementById('location-search');
const locationSuggestions = document.getElementById('location-suggestions');

async function fetchAutocompleteSuggestions(query, targetListElement) {
    if (!query || query.length < 3) {
        targetListElement.innerHTML = '';
        targetListElement.style.display = 'none';
        return;
    }

    try {
        const response = await fetch('/autocomplete-location/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ query })
        });

        const data = await response.json();
        if (!data.success) {
            targetListElement.innerHTML = '';
            targetListElement.style.display = 'none';
            return;
        }

        const results = data.results || [];
        if (!results.length) {
            targetListElement.innerHTML = '';
            targetListElement.style.display = 'none';
            return;
        }

        // This block is added based on the instruction to activate the AI Strategy tab
        // and ensure the business suggestion card is visible.
        // Assuming 'business-suggestion-card' is where the AI suggestion would be displayed.
        const suggestionCard = document.getElementById('business-suggestion-card');
        if (suggestionCard) {
            suggestionCard.classList.remove('d-none'); // Ensure it's visible

            // Switch to AI tab to show the result
            const aiTabBtn = document.getElementById('ai-strategy-tab');
            if (aiTabBtn) {
                const tab = new bootstrap.Tab(aiTabBtn);
                tab.show();
            }
        }

        targetListElement.innerHTML = '';
        results.forEach(result => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.textContent = result.display_name;
            item.addEventListener('click', async () => {
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                locationSearchInput.value = result.display_name;
                targetListElement.innerHTML = '';
                targetListElement.style.display = 'none';

                // Center map and drop marker
                map.setView([lat, lon], 15);
                if (userMarker) {
                    map.removeLayer(userMarker);
                }
                userMarker = L.marker([lat, lon]).addTo(map)
                    .bindPopup('Selected Location').openPopup();

                // Update hidden coords, accuracy meter, and crowd intensity
                document.getElementById('id_latitude').value = lat;
                document.getElementById('id_longitude').value = lon;
                updateAccuracyMeter(85);
                // Automatically find popular places around the searched location
                await findPopularPlaces(lat, lon, false);
                await updateCrowdIntensityDropdown(lat, lon);
                notifyChatFromMap(`Selected: ${result.display_name}. Map and crowd data updated.`);
            });
            targetListElement.appendChild(item);
        });
        targetListElement.style.display = 'block';
    } catch (err) {
        console.error('Autocomplete error:', err);
        targetListElement.innerHTML = '';
        targetListElement.style.display = 'none';
    }
}

if (locationSearchInput && locationSuggestions) {
    locationSearchInput.addEventListener('input', debounce(function () {
        fetchAutocompleteSuggestions(this.value.trim(), locationSuggestions);
    }, 300));
}

// Hide suggestions when clicking outside
document.addEventListener('click', function (e) {
    if (locationSuggestions && !locationSuggestions.contains(e.target) && e.target !== locationSearchInput) {
        locationSuggestions.innerHTML = '';
        locationSuggestions.style.display = 'none';
    }
});

const IPSTACK_API_KEY = '10cf4a0c87fa9f2bc5c54c596c7788ef';
// Debug: set to true to see geolocation logs in console (production: false)
const GEOLOCATION_DEBUG = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
function geoLog(...args) {
    if (GEOLOCATION_DEBUG && typeof console !== 'undefined' && console.log) {
        console.log('[Geolocation]', ...args);
    }
}

// Check if geolocation is allowed by context (HTTPS or localhost only)
function isGeolocationSecure() {
    const secure = window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!secure) geoLog('Geolocation requires HTTPS or localhost. Current origin:', window.location.origin);
    return secure;
}

// Send coordinates to Django backend (for map/heatmap and optional server-side use)
async function sendLocationToBackend(lat, lon, accuracy, source) {
    const url = '/api/user-location/';
    const body = JSON.stringify({
        latitude: lat,
        longitude: lon,
        accuracy: accuracy != null ? Math.round(accuracy) : null,
        source: source || 'gps'
    });
    geoLog('Sending location to backend:', body);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken'),
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: body
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
            geoLog('Backend accepted location:', data);
            return true;
        }
        geoLog('Backend rejected or error:', response.status, data);
        return false;
    } catch (err) {
        geoLog('Failed to send location to backend:', err);
        return false;
    }
}

// Fallback: get approximate location via IP when browser geolocation fails
async function getLocationViaIP() {
    geoLog('Trying IP-based location fallback...');
    const apis = [
        `https://api.ipstack.com/check?access_key=${IPSTACK_API_KEY}`,
        'https://ipapi.co/json/',
        'https://ip-api.com/json/?fields=status,lat,lon,city,country'
    ];
    for (const url of apis) {
        try {
            const ctrl = new AbortController();
            const id = setTimeout(() => ctrl.abort(), 6000);
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(id);
            const data = await res.json();

            // Handle IPStack response
            if (url.includes('ipstack.com')) {
                if (data && data.latitude != null && data.longitude != null) {
                    geoLog('IP location from ipstack.com:', data.latitude, data.longitude);
                    return {
                        lat: data.latitude,
                        lon: data.longitude,
                        city: data.city || '',
                        country: data.country_name || '',
                        approximate: true
                    };
                }
                geoLog('ipstack.com returned no coords or error:', data.error || data);
                continue;
            }

            const lat = data.latitude ?? data.lat;
            const lon = data.longitude ?? data.lon;
            if (url.includes('ipapi.co') && lat != null && lon != null) {
                geoLog('IP location from ipapi.co:', lat, lon);
                return { lat, lon, city: data.city || '', country: data.country_name || '', approximate: true };
            }
            if (url.includes('ip-api') && data.status === 'success' && lat != null && lon != null) {
                geoLog('IP location from ip-api:', lat, lon);
                return { lat, lon, city: data.city || '', country: data.country || '', approximate: true };
            }
        } catch (e) {
            geoLog('IP API failed:', url, e);
            continue;
        }
    }
    geoLog('All IP fallbacks failed');
    return null;
}

// Map GeolocationPositionError code to user message
function getGeolocationErrorMessage(code, defaultMsg) {
    switch (code) {
        case 1: return 'Location permission denied. Allow location in browser settings or use search.';
        case 2: return 'Location unavailable. Try again or use search.';
        case 3: return 'Location request timed out. Check your connection or use search.';
        default: return defaultMsg || 'Location unavailable. Use search instead.';
    }
}

// Geolocation Logic
async function findMyLocation(btnId = 'find-location-btn') {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    showLocationError('');

    function resetBtn() {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }

    async function onLocationSuccess(lat, lon, accuracy, approximate) {
        if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
            geoLog('Invalid coordinates:', lat, lon);
            showLocationError('Invalid location. Use search instead.');
            resetBtn();
            return;
        }
        geoLog('Location obtained:', { lat, lon, accuracy, approximate });
        showLocationError('');
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker([lat, lon]).addTo(map)
            .bindPopup(approximate ? 'Your approximate location (from IP)' : 'Your Location').openPopup();
        map.setView([lat, lon], 15);
        updateAccuracyMeter(accuracy != null ? accuracy : (approximate ? 30 : 95));

        const latField = document.getElementById('id_latitude');
        const lonField = document.getElementById('id_longitude');
        if (latField) latField.value = lat;
        if (lonField) lonField.value = lon;

        await sendLocationToBackend(lat, lon, accuracy, approximate ? 'ip' : 'gps');
        resetBtn();
        return { success: true, lat, lon };
    }

    if (!isGeolocationSecure()) {
        showLocationError('Location requires HTTPS or localhost.');
        geoLog('Insecure context â€” geolocation disabled');
        const ipLoc = await getLocationViaIP();
        if (ipLoc) return await onLocationSuccess(ipLoc.lat, ipLoc.lon, 30, true);
        else resetBtn();
        return { success: false };
    }

    if (!navigator.geolocation) {
        geoLog('navigator.geolocation not available');
        const ipLoc = await getLocationViaIP();
        if (ipLoc) return await onLocationSuccess(ipLoc.lat, ipLoc.lon, 30, true);
        else showLocationError('Location not supported. Use search instead.');
        resetBtn();
        return { success: false };
    }

    geoLog('Requesting position (getCurrentPosition)...');
    const options = {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 60000
    };

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            async function (position) {
                geoLog('getCurrentPosition success:', position.coords);
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const accuracy = calculateAccuracy(position);
                const res = await onLocationSuccess(lat, lon, accuracy, false);
                resolve(res);
            },
            async function (error) {
                geoLog('getCurrentPosition error:', error.code, error.message);
                const userMsg = getGeolocationErrorMessage(error.code, 'Location unavailable. Use search instead.');
                showLocationError(userMsg);
                updateAccuracyMeter(0);
                const ipLoc = await getLocationViaIP();
                if (ipLoc) {
                    const res = await onLocationSuccess(ipLoc.lat, ipLoc.lon, 30, true);
                    resolve(res);
                } else {
                    resetBtn();
                    resolve({ success: false });
                }
            },
            options
        );
    });
}

// Global button click
safeOn('find-location-btn', 'click', async function () {
    await findMyLocation();
});

// Function to find popular places (reusable)
async function findPopularPlaces(lat, lon, showAlert = true) {
    try {
        const response = await fetch('/find-popular-places/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ latitude: lat, longitude: lon })
        });

        let data;
        try {
            data = await response.json();
        } catch (e) {
            throw new Error(response.status === 0 ? 'Network error. Check your connection.' : 'Server returned invalid response.');
        }
        if (!response.ok) {
            const err = data?.error || data?.message || 'Server error. Please try again.';
            if (showAlert) showHeatmapToast('Error finding popular places: ' + err, 'error');
            return { success: false, error: err };
        }

        if (data.success) {
            // Clear previous popular places markers
            popularPlacesMarkers.forEach(marker => map.removeLayer(marker));
            popularPlacesMarkers = [];

            // Clear previous radius circle if exists
            if (radiusCircle) {
                map.removeLayer(radiusCircle);
                radiusCircle = null;
            }

            // Add markers for popular places (limit to 10 to keep map readable)
            const POPULAR_PLACES_MARKER_LIMIT = 10;
            const placesToShow = (data.results || []).slice(0, POPULAR_PLACES_MARKER_LIMIT);
            placesToShow.forEach(place => {
                let placeLat, placeLon;

                if (place.lat && place.lon) {
                    placeLat = place.lat;
                    placeLon = place.lon;
                } else if (place.center) {
                    placeLat = place.center.lat;
                    placeLon = place.center.lon;
                } else {
                    return;
                }

                const name = place.tags?.name || place.tags?.amenity || 'Popular Place';
                const amenity = place.tags?.amenity || place.tags?.shop || place.tags?.tourism || 'Unknown';

                // Revenue Popup Content
                let popupContent = `<b>${name}</b><br>Type: ${amenity}`;
                if (place.revenue_data) {
                    const rev = new Intl.NumberFormat('en-IN', {
                        style: 'currency',
                        currency: 'INR',
                        maximumFractionDigits: 0
                    }).format(place.revenue_data.estimated_revenue);
                    popupContent += `<br><span style="color:green; font-weight:bold;">Est. Revenue: ${rev}</span>`;
                    popupContent += `<br><span style="color:blue;">Potential: ${place.revenue_data.potential_score}/100</span>`;
                }

                const marker = L.marker([placeLat, placeLon], {
                    icon: L.icon({
                        iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-blue.png',
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        popupAnchor: [1, -34],
                        shadowSize: [41, 41]
                    })
                }).addTo(map)
                    .bindPopup(popupContent);

                popularPlacesMarkers.push(marker);
            });

            // Update Total Area Revenue in Footer
            if (data.total_area_revenue) {
                const revenueDisplay = document.getElementById('revenue-prediction-display');
                const revenueVal = document.getElementById('revenue-value');
                const scoreVal = document.getElementById('crowd-score-value'); // Reuse crowd score label or hide it

                if (revenueDisplay && revenueVal) {
                    revenueDisplay.classList.remove('d-none');
                    revenueVal.textContent = new Intl.NumberFormat('en-IN', {
                        style: 'currency',
                        currency: 'INR',
                        maximumFractionDigits: 0
                    }).format(data.total_area_revenue);

                    // Update label to reflect it's area total
                    const revLabel = revenueDisplay.querySelector('.revenue-label');
                    if (revLabel) revLabel.textContent = 'Total Area Potential';

                    if (scoreVal) scoreVal.textContent = data.results.length + ' Places';
                    const scoreLabel = scoreVal.parentElement.querySelector('.revenue-label');
                    if (scoreLabel) scoreLabel.textContent = 'Nearby Places';
                }
            }

            // Cache for re-render when crowd analysis completes (so "AI business" column is filled)
            lastPopularPlacesResult = { places: data.results || [], lat, lon };
            // Render autocomplete-style popular places table
            renderPopularPlacesTable(data.results || [], lat, lon);
            // Render the main "Top Business Recommendations" cards
            renderBusinessRecommendationCards(data.results || [], lat, lon);

            // Draw circle for 5km radius (remove previous if exists)
            if (radiusCircle) {
                map.removeLayer(radiusCircle);
            }
            radiusCircle = L.circle([lat, lon], {
                radius: 5000,
                color: '#4CAF50',
                fillColor: '#4CAF50',
                fillOpacity: 0.1,
                weight: 2
            }).addTo(map);

            // Analyze and show crowd intensity (this will also show the heatmap)
            await updateCrowdIntensityDropdown(lat, lon);

            if (showAlert) {
                showHeatmapToast(`Found ${data.results.length} popular places within 5km. Showing top ${placesToShow.length} on map.`, 'success');
            }
            notifyChatFromMap(`Popular places: found ${data.results.length} places within 5km. Showing top ${placesToShow.length} on map. Heatmap updated.`);
            return { success: true, count: data.results.length };
        } else {
            const errMsg = data.error || data.message || 'Unable to fetch popular places.';
            if (showAlert) {
                showHeatmapToast('Error finding popular places: ' + errMsg, 'error');
            }
            notifyChatFromMap('Popular places: ' + errMsg);
            return { success: false, error: errMsg };
        }
    } catch (error) {
        console.error('Error:', error);
        const errMsg = (error.message || 'Network or server error. Please try again.').replace(/^Error:\s*/i, '');
        if (showAlert) {
            showHeatmapToast('Error finding popular places: ' + errMsg, 'error');
        }
        notifyChatFromMap('Popular places: ' + errMsg);
        return { success: false, error: errMsg };
    }
}

// --- Popular places table rendering & synthetic crowd profiles ---

// Thresholds for people count
const CROWD_THRESHOLDS = {
    lowMax: 80,     // below medium threshold
    mediumMax: 160  // between lowMax and mediumMax = medium, above = high
};

function pickBusinessForIntensity(level) {
    const key = (level || '').toLowerCase();
    const options = (businessByIntensity && businessByIntensity[key]) || [];
    if (!options || !options.length) return '';
    // Choose the first for determinism; could randomize if desired.
    return options[0];
}

function estimateBaseFootfall(place) {
    const tags = place.tags || {};
    const amenity = tags.amenity || '';
    const shop = tags.shop || '';
    const tourism = tags.tourism || '';
    const leisure = tags.leisure || '';

    if (amenity === 'restaurant' || amenity === 'cafe' || amenity === 'fast_food') return 110;
    if (shop === 'mall' || tourism === 'attraction') return 140;
    if (amenity === 'school' || amenity === 'college' || amenity === 'university') return 120;
    if (amenity === 'park' || leisure === 'park') return 70;

    // Default baseline
    return 90;
}

function classifyCrowd(peopleCount) {
    if (peopleCount < CROWD_THRESHOLDS.lowMax) return 'low';
    if (peopleCount < CROWD_THRESHOLDS.mediumMax) return 'medium';
    return 'high';
}

function buildCrowdProfileForPlace(place) {
    const base = estimateBaseFootfall(place);

    // Simple time-of-day multipliers (morning/afternoon/evening/night)
    const slots = [
        { id: 'morning', label: 'Morning', timeRange: '6am - 10am', multiplier: 0.55 },
        { id: 'midday', label: 'Midâ€‘day', timeRange: '10am - 4pm', multiplier: 0.85 },
        { id: 'evening', label: 'Evening', timeRange: '4pm - 8pm', multiplier: 1.1 },
        { id: 'night', label: 'Night', timeRange: '8pm - 11pm', multiplier: 0.65 }
    ];

    const enrichedSlots = slots.map(slot => {
        const people = Math.round(base * slot.multiplier);
        const crowd = classifyCrowd(people);
        return {
            id: slot.id,
            label: slot.label,
            timeRange: slot.timeRange,
            people,
            crowd,
            business: pickBusinessForIntensity(crowd),
        };
    });

    // Best time: first slot where crowd is below medium threshold (i.e. "low")
    let best = enrichedSlots.find(s => s.crowd === 'low') || enrichedSlots[0];
    const bestTimeLabel = `${best.label} (${best.timeRange}) â€“ best time (crowd below medium)`;

    return {
        bestTimeLabel,
        slots: enrichedSlots
    };
}

function formatAddressFromTags(tags = {}) {
    const parts = [];
    if (tags['addr:housenumber']) parts.push(tags['addr:housenumber']);
    if (tags['addr:street']) parts.push(tags['addr:street']);
    if (tags['addr:neighbourhood']) parts.push(tags['addr:neighbourhood']);
    if (tags['addr:suburb']) parts.push(tags['addr:suburb']);
    if (tags['addr:city']) parts.push(tags['addr:city']);
    if (!parts.length && tags['addr:full']) parts.push(tags['addr:full']);
    return parts.join(', ');
}

/**
 * Create a unified business flashcard HTML for popular places and recommendations.
 */
/**
 * Create a unified business flashcard HTML for popular places and recommendations.
 */
function createBusinessCard(place, type, index, fallbackLat, fallbackLon) {
    const tags = place.tags || {};
    const name = tags.name || tags.amenity || tags.shop || tags.tourism || 'Business';

    // Format address - simpler for card logic
    let address = '';
    if (tags['addr:street']) address += tags['addr:street'];
    if (tags['addr:city']) address += (address ? ', ' : '') + tags['addr:city'];
    if (!address) {
        address = (place.display_name || '').split(',').slice(0, 2).join(', ');
    }
    // Truncate if too long
    if (address.length > 35) address = address.substring(0, 32) + '...';

    const profile = buildCrowdProfileForPlace(place);

    // Determine specific variations based on type
    let headerBadge = '';
    let isPopular = type === 'popular';
    let score = 0;

    if (isPopular) {
        headerBadge = '<span class="badge-popular">Popular</span>';
    } else {
        // Synthetic score logic
        score = 98 - (index * 2) - Math.floor(Math.random() * 3);
        const scoreClass = score >= 90 ? 'score-high' : (score >= 75 ? 'score-medium' : 'score-low');
        headerBadge = `<span class="recommendation-score ${scoreClass} ms-2">${score}%</span>`;
    }

    // Generate dynamic description text based on profile
    let crowdDesc = '';
    const busySlot = profile.slots.find(s => s.crowd === 'high');
    const moderateSlot = profile.slots.find(s => s.crowd === 'medium');

    const businessLabel = place.revenue_data?.business_label || 'General Business';

    if (busySlot) {
        crowdDesc = `High foot traffic area (${businessLabel}). Ideal for high-volume business during ${busySlot.label.toLowerCase()}.`;
    } else if (moderateSlot) {
        crowdDesc = `Steady medium crowd (${businessLabel}). Good for service-oriented businesses.`;
    } else {
        crowdDesc = `Quieter location (${businessLabel}) with low competition. Suitable for niche ventures.`;
    }

    // Add peak time info
    const bestTime = profile.bestTimeLabel.split('(')[0].trim();
    crowdDesc += ` Peak hours: ${bestTime}.`;

    // Coordinates
    let pLat = place.lat;
    let pLon = place.lon;
    if (!pLat && place.center) {
        pLat = place.center.lat;
        pLon = place.center.lon;
    }
    const finalLat = pLat || fallbackLat;
    const finalLon = pLon || fallbackLon;
    const escapedName = name.replace(/'/g, "\\'");

    // Button Logic
    let buttonHtml = '';
    if (isPopular) {
        buttonHtml = `
            <button type="button" class="btn-track-full" onclick="selectSearchResult(${finalLat}, ${finalLon}, '${escapedName}')">
                Track Location
            </button>`;
    } else {
        buttonHtml = `
            <button type="button" class="btn-track-full" onclick="analyzeAndTrack(${finalLat}, ${finalLon}, '${escapedName}', ${score})">
                Analyze & Track
            </button>`;
    }

    // Revenue Display (if available)
    let revenueHtml = '';
    if (place.revenue_data && place.revenue_data.estimated_revenue) {
        const rev = new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(place.revenue_data.estimated_revenue);

        const realTimeBadge = place.revenue_data.is_real_time ?
            `<span class="badge bg-success border-0 small ms-1" style="font-size: 0.65rem; opacity: 0.8;"><i class="fas fa-bolt me-1"></i>Real-time</span>` : '';

        revenueHtml = `
            <div class="business-card-revenue mt-2 mb-2 p-2 border rounded bg-dark" style="border-color: rgba(255,255,255,0.1) !important;">
                <div class="d-flex justify-content-between align-items-center">
                    <span class="text-muted small">Est. Monthly Revenue:</span>
                    <span class="text-success fw-bold">${rev}${realTimeBadge}</span>
                </div>
                 <div class="d-flex justify-content-between">
                    <span class="text-muted small">Location Intelligence:</span>
                    <span class="text-info fw-bold">${place.revenue_data.potential_score}/100</span>
                </div>
            </div>
        `;
    }

    // Generate card HTML (New Visual Style)
    return `
        <div class="business-card">
            <div class="business-card-header d-flex justify-content-between align-items-center">
                <span class="business-name">${name}</span>
                ${headerBadge}
            </div>
            
            <div class="business-location-row">
                <i class="fas fa-map-marker-alt"></i>
                <span>${address}</span>
            </div>

            ${revenueHtml}

            <div class="business-card-description">
                ${crowdDesc}
            </div>

            ${buttonHtml}
        </div>
    `;
}

/**
 * Track location AND open the Business Intelligence dashboard tab.
 */
function analyzeAndTrack(lat, lon, name, score) {
    // 1. Standard Tracking
    selectSearchResult(lat, lon, name);

    // 2. Open Dashboard Panel if closed
    const intelPanel = document.getElementById('business-intelligence-panel');
    if (intelPanel && intelPanel.closest('.dashboard-analytics-section')) {
        const section = intelPanel.closest('.dashboard-analytics-section');
        section.classList.remove('d-none');
    }

    // 3. Switch to AI Strategy Tab
    const aiTabBtn = document.getElementById('dash-ai-tab');
    if (aiTabBtn) {
        const tab = new bootstrap.Tab(aiTabBtn);
        tab.show();
    }

    // 4. Populate AI Strategy Content (Simulated)
    const contentDiv = document.getElementById('business-suggestion-content');
    if (contentDiv) {
        contentDiv.innerHTML = `
            <div class="p-3">
                <h5 class="text-white mb-3">AI Analysis for ${name}</h5>
                <div class="alert alert-info mb-3">
                    <i class="fas fa-brain me-2"></i>
                    <strong>Feasibility Score: ${score}%</strong>
                </div>
                <p class="text-light small mb-2">Based on mobility patterns, this location is optimal for:</p>
                <ul class="text-muted small mb-3">
                    <li>â€¢ Retail / Convenience Store</li>
                    <li>â€¢ Quick Service Restaurant</li>
                    <li>â€¢ Coworking Space</li>
                </ul>
                <p class="text-muted tiny">
                    Crowd density peaks at <strong>${new Date().getHours() + 2}:00</strong>. 
                    Competition density is <strong>low</strong> in a 500m radius.
                </p>
                <button class="btn btn-sm btn-outline-light mt-2" onclick="alert('Full report generated!')">Download PDF Report</button>
            </div>
        `;
    }
}

function renderPopularPlacesTable(places, lat, lon) {
    if (!popularPlacesPanel || !popularPlacesList) return;

    popularPlacesList.innerHTML = '';

    if (!places.length) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'popular-place-item';
        emptyDiv.textContent = 'No popular places found within 5km.';
        popularPlacesList.appendChild(emptyDiv);
        if (popularPlacesPanel.classList.contains('d-none')) {
            popularPlacesPanel.classList.remove('d-none');
        } else {
            popularPlacesPanel.style.display = 'block';
        }
        return;
    }

    // Limit to top 8-10 items to keep UI compact
    const topPlaces = places.slice(0, 10);

    topPlaces.forEach((place, index) => {
        const col = document.createElement('div');
        col.className = 'col-12 mb-3';
        col.innerHTML = createBusinessCard(place, 'popular', index, lat, lon);
        popularPlacesList.appendChild(col);
    });

    if (popularPlacesPanel.classList.contains('d-none')) {
        popularPlacesPanel.classList.remove('d-none');
    } else {
        popularPlacesPanel.style.display = 'block';
    }
}

/**
 * Render dynamic "Top Business Recommendations" cards based on popular places.
 */
function renderBusinessRecommendationCards(places, lat, lon) {
    const section = document.getElementById('business-recommendations-section') || document.getElementById('business-intelligence-panel');
    if (!section) return;

    if (!places || !places.length) {
        if (section.tagName === 'SECTION') section.style.display = 'none';
        else section.classList.add('d-none');
        return;
    }

    if (section.tagName === 'SECTION') section.style.display = 'block';
    else {
        section.classList.remove('d-none');
        const analyticsSection = document.getElementById('dashboard-analytics-section');
        if (analyticsSection) analyticsSection.classList.remove('d-none');
    }

    // Ensure parent panels are also visible if nested
    const parentPanel = section.closest('.dashboard-analytics-panel');
    if (parentPanel) parentPanel.classList.remove('d-none');

    const row = document.getElementById('business-recommendations-row');
    if (!row) return;

    row.innerHTML = '';

    // Show top 10 places as primary recommendations
    const top10 = places.slice(0, 10);

    top10.forEach((place, index) => {
        const col = document.createElement('div');
        // Use col-12 for dashboard panel cards to ensure they stack nicely
        col.className = section.tagName === 'SECTION' ? 'col-md-6 col-lg-4 mb-4' : 'col-12 mb-3';
        col.innerHTML = createBusinessCard(place, 'recommended', index, lat, lon);
        row.appendChild(col);
    });
}

// Default center when no location selected (Bangalore)
const DEFAULT_MAP_CENTER = { lat: 12.9716, lon: 77.5946 };

// Find Popular Places Button
safeOn('popular-places-btn', 'click', async function () {
    let lat, lon;
    const latInput = document.getElementById('id_latitude');
    const lonInput = document.getElementById('id_longitude');

    if (latInput && lonInput && latInput.value && lonInput.value) {
        lat = parseFloat(latInput.value);
        lon = parseFloat(lonInput.value);
    }
    if ((!lat || !lon) && userMarker) {
        const ll = userMarker.getLatLng();
        lat = ll.lat;
        lon = ll.lng;
    }
    if (!lat || !lon) {
        lat = DEFAULT_MAP_CENTER.lat;
        lon = DEFAULT_MAP_CENTER.lon;
        if (latInput && lonInput) {
            latInput.value = lat;
            lonInput.value = lon;
        }
        if (map) map.setView([lat, lon], 12);
        notifyChatFromMap('Using Bangalore as center. Search for a place or use "My Location" to change the area.');
    }
    await findPopularPlaces(lat, lon, true);
});

// Toggles and WebSocket handled globally

function connectChatbot() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat/`;

    chatSocket = new WebSocket(wsUrl);
    console.log('Chatbot: Connecting to WebSocket...', wsUrl);

    chatSocket.onopen = function (e) {
        console.log('Chatbot: WebSocket connection established');
    };

    chatSocket.onmessage = function (e) {
        hideTypingIndicator();
        console.log('Chatbot: Message received', e.data);
        const data = JSON.parse(e.data);
        const message = data.message;

        addChatMessage(message, 'bot');

        // Allow the bot to control the map by parsing its response for commands
        // This makes the assistant "interactive" as requested.
        const result = handleChatCommand(message);
        if (result.handled && result.feedback) {
            // Optional: notify user that a map action was triggered by the bot
            console.log('Bot-triggered map action:', result.feedback);
        }
    };

    chatSocket.onclose = function (e) {
        console.warn('Chatbot: WebSocket closed unexpectedly', e.code, e.reason);
        setTimeout(connectChatbot, 2000);
    };

    chatSocket.onerror = function (error) {
        console.error('Chatbot: WebSocket error:', error);
    };
}

// Add message to chatbot
function addChatMessage(message, sender) {
    const messagesContainer = document.getElementById('chatbot-messages');
    if (!messagesContainer) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chatbot-message ' + sender;
    messageDiv.textContent = message;
    messagesContainer.appendChild(messageDiv);

    // Auto-scroll to bottom
    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 50);
}

function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatbot-messages');
    if (!messagesContainer || document.querySelector('.typing-indicator')) return;

    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    messagesContainer.appendChild(indicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) indicator.remove();
}

// Notify chat when a map action happens (links map buttons to chatbot)
function notifyChatFromMap(message) {
    addChatMessage(message, 'bot');

    // Smart Suggestions based on map actions
    if (message.includes('Location set') || message.includes('Searching the map')) {
        renderChatbotSuggestions([
            { text: '🏢 Check Feasibility', command: 'open cafe in this area' },
            { text: '📍 Popular Places', command: 'popular places' },
            { text: '📋 Open Form', command: 'open form' }
        ]);
    } else if (message.includes('feasibility')) {
        renderChatbotSuggestions([
            { text: '📈 View Heatmap', command: 'maximize map' },
            { text: '📋 Submit Info', command: 'open form' },
            { text: '🔍 Search Nearby', command: 'popular places' }
        ]);
    } else if (message.includes('Finding your location')) {
        renderChatbotSuggestions([
            { text: '📍 Nearby Popular Places', command: 'popular places' },
            { text: '🏢 Check Cafe Feasibility', command: 'open cafe in this area' },
            { text: '📋 Open Business Form', command: 'open form' }
        ]);
    } else if (message.includes('Business feasibility commands')) {
        renderChatbotSuggestions([
            { text: '🏢 Cafe in Koramangala', command: 'open cafe in Koramangala' },
            { text: '🏬 Pharmacy in Indiranagar', command: 'check pharmacy feasibility in Indiranagar' },
            { text: '🍽 Restaurant in HSR Layout', command: 'is restaurant feasible in HSR Layout' }
        ]);
    }
}

// Chatbot send message
// Chatbot send button listener handled in initGlobalFloatingUI

safeOn('chatbot-input', 'keypress', function (e) {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// Place a single brown business marker at (lat, lon) for feasible location
function placeFeasibilityMarker(lat, lon, label) {
    businessRecommendationMarkers.forEach(m => map.removeLayer(m));
    businessRecommendationMarkers = [];
    const color = '#8B4513';
    const marker = L.circleMarker([lat, lon], {
        radius: 14,
        color,
        fillColor: color,
        fillOpacity: 0.9,
        weight: 3
    }).addTo(map)
        .bindPopup(`<b>Business location (feasible)</b><br>${label || 'Recommended spot'}`);
    businessRecommendationMarkers.push(marker);
}

// Framework: user command like "open cafe in Koramangala" -> 4.1 point location, 4.2 popular places 5km, 4.3 feasibility, 4.4 brown marker or not feasible
async function runFeasibilityFlow(placeText, businessType) {
    try {
        const normalizedPlace = (placeText || '').toLowerCase().trim();
        const useCurrentArea = /^(this area|this location|current location|my location|here|near me|around me)$/.test(normalizedPlace);

        let lat = Number.NaN;
        let lon = Number.NaN;
        let locationLabel = placeText;

        if (useCurrentArea) {
            const latInput = parseFloat(document.getElementById('id_latitude')?.value || '');
            const lonInput = parseFloat(document.getElementById('id_longitude')?.value || '');
            if (!Number.isNaN(latInput) && !Number.isNaN(lonInput)) {
                lat = latInput;
                lon = lonInput;
            } else if (userMarker && typeof userMarker.getLatLng === 'function') {
                const markerLatLng = userMarker.getLatLng();
                lat = parseFloat(markerLatLng.lat);
                lon = parseFloat(markerLatLng.lng);
            }

            if (Number.isNaN(lat) || Number.isNaN(lon)) {
                notifyChatFromMap('Please set your location first using "find my location", map click, or place search.');
                return;
            }
            locationLabel = 'your selected area';
        } else {
            const response = await fetch('/search-location/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ query: placeText.includes(',') ? placeText : `${placeText}, India` })
            });
            const data = await response.json();
            const results = (data && data.results) || [];
            if (!data.success || !results.length) {
                notifyChatFromMap(`Could not find location "${placeText}". Try a different place name.`);
                return;
            }
            const first = results[0];
            lat = parseFloat(first.lat);
            lon = parseFloat(first.lon);
            if (Number.isNaN(lat) || Number.isNaN(lon)) {
                notifyChatFromMap(`Invalid coordinates for "${placeText}".`);
                return;
            }
            locationLabel = first.display_name || placeText;
        }

        notifyChatFromMap(`Pointing to ${locationLabel} and checking feasibility for "${businessType || 'business'}".`);
        // 4.1 Point to the location
        map.setView([lat, lon], 15);
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.marker([lat, lon]).addTo(map)
            .bindPopup(locationLabel).openPopup();
        document.getElementById('id_latitude').value = lat;
        document.getElementById('id_longitude').value = lon;
        updateAccuracyMeter(85);
        showLocationError('');
        // 4.2 Take popular places radius in 5km
        await findPopularPlaces(lat, lon, false);
        await updateCrowdIntensityDropdown(lat, lon);
        // 4.3 & 4.4 Check feasibility and place brown marker or show not feasible
        const feasData = await getFeasibilityWithCache(lat, lon, businessType || '');
        if (feasData.success) {
            if (feasData.feasible) {
                placeFeasibilityMarker(lat, lon, businessType ? `${businessType} (feasible)` : 'Feasible location');
                notifyChatFromMap(feasData.message);
            } else {
                notifyChatFromMap(feasData.message);
            }
        } else {
            notifyChatFromMap(`Could not check feasibility: ${feasData.error || feasData.message || 'Unknown error'}.`);
        }
    } catch (err) {
        console.error('Feasibility flow error:', err);
        notifyChatFromMap('Something went wrong. Please try again or search for the location manually.');
    }
}

// Try to run a map/form action from a chat command; returns { handled: true, feedback?: string } or { handled: false }
function handleChatCommand(message) {
    const lower = message.toLowerCase().trim();
    const trimmed = message.trim();

    if (/\b(help|commands|what can you do|how to use|assist me)\b/i.test(lower)) {
        return {
            handled: true,
            feedback: '🤖 I can help with map actions. Try: "find my location", "search for Indiranagar", "open cafe in Koramangala", or "popular places".',
            suppressLLM: true,
        };
    }

    // Business feasibility commands
    const openBizInMatch = trimmed.match(/\b(?:i\s+want\s+to\s+)?(?:open|start)\s+(?:a\s+)?(.+?)\s+in\s+(.+)/i);
    const businessInMatch = trimmed.match(/\b(cafe|restaurant|shop|store|pharmacy|supermarket|dairy\s*shop|book\s*store|fast\s*food|warehouse|clothing\s*store|food\s*court)\s+in\s+(.+)/i);
    const checkFeasibleMatch = trimmed.match(/\b(?:check\s+)?(.+?)\s+feasibility\s+in\s+(.+)/i);
    const isFeasibleMatch = trimmed.match(/\bis\s+(.+?)\s+feasible\s+in\s+(.+)/i);
    const feasibilityForMatch = trimmed.match(/\bfeasibility\s+for\s+(.+?)\s+in\s+(.+)/i);

    let placeText = null;
    let businessType = null;

    if (openBizInMatch && openBizInMatch[1].trim() && openBizInMatch[2].trim()) {
        businessType = openBizInMatch[1].trim();
        placeText = openBizInMatch[2].trim();
    } else if (businessInMatch && businessInMatch[2].trim()) {
        businessType = (businessInMatch[1] || '').replace(/\s+/g, ' ').trim();
        placeText = businessInMatch[2].trim();
    } else if (checkFeasibleMatch && checkFeasibleMatch[1].trim() && checkFeasibleMatch[2].trim()) {
        businessType = checkFeasibleMatch[1].trim();
        placeText = checkFeasibleMatch[2].trim();
    } else if (isFeasibleMatch && isFeasibleMatch[1].trim() && isFeasibleMatch[2].trim()) {
        businessType = isFeasibleMatch[1].trim();
        placeText = isFeasibleMatch[2].trim();
    } else if (feasibilityForMatch && feasibilityForMatch[1].trim() && feasibilityForMatch[2].trim()) {
        businessType = feasibilityForMatch[1].trim();
        placeText = feasibilityForMatch[2].trim();
    }

    if (placeText) {
        runFeasibilityFlow(placeText, businessType);
        return {
            handled: true,
            feedback: `🏢 Checking feasibility for "${businessType || 'business'}" at ${placeText}...`,
            suppressLLM: true,
        };
    }

    // Business-planning flow (no specific business type)
    const openBizMatch = trimmed.match(/\b(?:open|start)\s+(?:a\s+)?business\s+in\s+(.+)/i);
    if (openBizMatch && openBizMatch[1].trim()) {
        const area = openBizMatch[1].trim();
        runBusinessPlanningFlow(area);
        return {
            handled: true,
            feedback: `Great, I'll analyze ${area} and then ask what crowd intensity you want.`,
            suppressLLM: true,
        };
    }

    // Locate user
    if (/\b(find\s+my\s+location|my\s+location|where\s+am\s+i|locate\s+me|get\s+my\s+location|show\s+my\s+location)\b/i.test(lower)) {
        const btn = document.getElementById('find-location-btn');
        if (btn) btn.click();
        return {
            handled: true,
            feedback: '📡 Finding your location on the map...',
            suppressLLM: true,
        };
    }

    // Search location
    let query = null;
    const searchForMatch = trimmed.match(/\bsearch\s+(?:for\s+)?(.+)/i);
    const findMatch = trimmed.match(/\bfind\s+(.+)/i);
    const locateMatch = trimmed.match(/\blocate\s+(.+)/i);
    const showMatch = trimmed.match(/\bshow\s+(?:me\s+)?(.+)/i);
    const goToMatch = trimmed.match(/\bgo\s+to\s+(.+)/i);
    if (searchForMatch && searchForMatch[1].trim()) query = searchForMatch[1].trim();
    else if (findMatch && findMatch[1].trim()) query = findMatch[1].trim();
    else if (locateMatch && locateMatch[1].trim()) query = locateMatch[1].trim();
    else if (showMatch && showMatch[1].trim()) query = showMatch[1].trim();
    else if (goToMatch && goToMatch[1].trim()) query = goToMatch[1].trim();

    if (query && !/\bpopular\s+places\b/i.test(query)) {
        const searchInput = document.getElementById('location-search');
        const searchBtn = document.getElementById('search-btn');
        if (searchInput && searchBtn) {
            searchInput.value = query;
            searchBtn.click();
        }

        setTimeout(() => {
            renderChatbotSuggestions([
                { text: `🏢 Start business in ${query}`, command: `analyze ${query}` },
                { text: `📉 Popular places in ${query}`, command: `popular places in ${query}` },
                { text: '❓ What can I do here?', command: `tell me about ${query}` }
            ]);
        }, 1500);

        return {
            handled: true,
            feedback: `🔎 Searching the map for "${query}"...`,
            suppressLLM: true,
        };
    }

    if (/\b(check\s+feasibility|business\s+feasibility|is\s+it\s+feasible)\b/i.test(lower)) {
        return {
            handled: true,
            feedback: '🏢 Business feasibility commands:\n1) "open cafe in Koramangala"\n2) "check pharmacy feasibility in Indiranagar"\n3) "is restaurant feasible in HSR Layout"',
            suppressLLM: true,
        };
    }

    if (/\b(popular\s+places|find\s+popular|show\s+popular\s+places)\b/i.test(lower)) {
        const popularBtn = document.getElementById('popular-places-btn');
        if (popularBtn) {
            popularBtn.click();
        } else {
            notifyChatFromMap('Popular places is only available on the map page. Go to Home and try again.');
        }
        return {
            handled: true,
            feedback: '📍 Finding popular places on the map...',
            suppressLLM: true,
        };
    }

    if (/\b(minimize\s+map|maximize\s+map|toggle\s+map|hide\s+map|show\s+map)\b/i.test(lower)) {
        const btn = document.getElementById('map-toggle-btn');
        if (btn) btn.click();
        return {
            handled: true,
            feedback: '🗺️ Toggling map view...',
            suppressLLM: true,
        };
    }

    if (/\b(open\s+(?:the\s+)?form|submit\s+business|business\s+form|business\s+info|open\s+business\s+form|fill\s+(?:the\s+)?form|submit\s+(?:my\s+)?business)\b/i.test(lower)) {
        const btn = document.getElementById('form-trigger-btn');
        if (btn) btn.click();
        return {
            handled: true,
            feedback: '📋 Opening business form...',
            suppressLLM: true,
        };
    }

    if (/\b(close\s+(?:the\s+)?form|close\s+business\s+form|hide\s+form)\b/i.test(lower)) {
        const modal = document.getElementById('form-modal');
        if (modal && modal.style.display === 'block') {
            modal.style.display = 'none';
            notifyChatFromMap('✅ Form closed.');
        }
        return {
            handled: true,
            suppressLLM: true,
        };
    }

    return { handled: false };
}

function sendChatMessage() {
    const input = document.getElementById('chatbot-input');
    const message = input.value.trim();
    if (!message) return;

    addChatMessage(message, 'user');
    input.value = '';

    // If the whole message is wrapped in double quotes, treat the
    // quoted text as an explicit "command string" for the map.
    // Example: "find my location", "popular places", "open form".
    let commandText = message;
    const quotedMatch = message.match(/^\s*"([^"]+)"\s*$/);
    if (quotedMatch && quotedMatch[1].trim()) {
        commandText = quotedMatch[1].trim();
    }

    // If we are in the middle of the AI business planning flow and
    // waiting specifically for the desired crowd intensity, handle that first.
    if (aiBusinessFlowAwaitingIntensity) {
        const handled = handleCrowdIntensityReply(commandText);
        // If a valid intensity was given, we stop here so this message
        // is not also interpreted as a generic chat question.
        if (handled) {
            return;
        }
    }

    // If chat command triggered a map/form action, show feedback so user sees the map/form is being initiated.
    // We always feed the (possibly deâ€‘quoted) commandText into the parser,
    // so that text inside "..." is interpreted as a precise map command.
    const result = handleChatCommand(commandText);
    if (result.handled && result.feedback) {
        notifyChatFromMap(result.feedback);
    }

    // For some flows (like the AI business planner) we intentionally
    // skip sending the same text to the LLM backend to avoid a long,
    // generic essay answer instead of the guided map interaction.
    if (result.handled && result.suppressLLM) {
        return;
    }

    showTypingIndicator();

    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ message: message }));
        return;
    }

    // HTTP fallback when WebSocket is not available
    fetch('/chat/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({ message: message })
    })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            hideTypingIndicator();
            if (data.success && data.message) {
                addChatMessage(data.message, 'bot');
            } else {
                addChatMessage('Sorry, I could not respond right now. Please try again.', 'bot');
            }
        })
        .catch(function () {
            hideTypingIndicator();
            addChatMessage('Connection error. Please check the server and try again.', 'bot');
        });
}

// Chatbot toggle and close listeners handled in initGlobalFloatingUI

// Global Floating UI Initialization (Chatbot and Form Modal)
function initGlobalFloatingUI() {
    // Form Modal logic
    const formModal = document.getElementById('form-modal');
    const formTriggerBtn = document.getElementById('form-trigger-btn');
    const closeBtn = document.querySelector('.close');

    if (formModal && formTriggerBtn && closeBtn) {
        formTriggerBtn.addEventListener('click', function () {
            const lat = document.getElementById('id_latitude').value;
            const lon = document.getElementById('id_longitude').value;

            if (!lat || !lon) {
                alert('Please select a location on the map first. You can:\n1. Click on the map\n2. Use "Find My Location"\n3. Search for a location');
                notifyChatFromMap('Business form: select a location on the map first (click map, Find My Location, or search), then try "open form" again.');
                return;
            }

            formModal.style.display = 'block';
            const formMessage = document.getElementById('form-message');
            if (formMessage) {
                formMessage.textContent = '';
                formMessage.className = 'form-message';
            }
            notifyChatFromMap('Business form opened. Fill in your details and submit when ready.');
        });

        closeBtn.addEventListener('click', function () {
            formModal.style.display = 'none';
            notifyChatFromMap('✅ Form closed.');
        });

        window.addEventListener('click', function (event) {
            if (event.target === formModal) {
                formModal.style.display = 'none';
                notifyChatFromMap('✅ Form closed.');
            }
        });
    }

    // Chatbot Initialization
    if (document.getElementById('chatbot-messages')) {
        connectChatbot();

                // Add welcome message and initial suggestions if container exists
        setTimeout(() => {
            addChatMessage("👋 Hello! I'm Antigravity, your map assistant. I can help you find locations, locate you, and check business feasibility. What should we do first?", 'bot');
            renderChatbotSuggestions([
                { text: '📍 Find My Location', command: 'find my location' },
                { text: '🔎 Search Bangalore', command: 'search for Bangalore' },
                { text: '🏢 Check Feasibility', command: 'open cafe in Koramangala' },
                { text: '📋 Open Business Form', command: 'open form' },
                { text: '🤖 Show Commands', command: 'help' }
            ]);
        }, 1000);
    }

    // Global Action Button Listeners
    safeOn('chat-toggle-btn', 'click', function () {
        const sidebar = document.getElementById('chatbot-sidebar');
        if (sidebar) {
            sidebar.classList.toggle('chatbot-sidebar-closed');
            sidebar.classList.toggle('chatbot-sidebar-open');
        }
        document.body.classList.toggle('chat-open');
        if (map && typeof map.invalidateSize === 'function') {
            setTimeout(() => map.invalidateSize(), 300);
        }
    });

    safeOn('map-toggle-btn', 'click', function () {
        const toggleBtn = document.getElementById('map-toggle-btn');
        const body = document.body;

        if (mapMinimized) {
            body.classList.remove('map-focus');
            toggleBtn.textContent = 'Focus Map';
            mapMinimized = false;
        } else {
            body.classList.add('map-focus');
            toggleBtn.textContent = 'Show Panels';
            mapMinimized = true;
        }

        // Trigger map resize
        setTimeout(() => {
            map.invalidateSize();
        }, 300);
    });

    safeOn('chatbot-toggle', 'click', function () {
        const chatbotContainer = document.getElementById('chatbot-container');
        const toggleBtn = document.getElementById('chatbot-toggle');

        if (chatbotMinimized) {
            chatbotContainer.classList.remove('minimized');
            toggleBtn.textContent = '-';
            chatbotMinimized = false;
        } else {
            chatbotContainer.classList.add('minimized');
            toggleBtn.textContent = '+';
            chatbotMinimized = true;
        }
    });

    safeOn('chatbot-close-btn', 'click', function () {
        const sidebar = document.getElementById('chatbot-sidebar');
        if (sidebar) {
            sidebar.classList.add('chatbot-sidebar-closed');
            sidebar.classList.remove('chatbot-sidebar-open');
            document.body.classList.remove('chat-open');
        }
    });

    safeOn('chatbot-send', 'click', function () {
        sendChatMessage();
    });
}

function renderChatbotSuggestions(suggestions) {
    const container = document.getElementById('chatbot-suggestions-container');
    if (!container) return;

    container.innerHTML = '';
    suggestions.forEach(s => {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.innerHTML = s.text;
        chip.addEventListener('click', () => {
            const input = document.getElementById('chatbot-input');
            if (input) {
                input.value = s.command;
                sendChatMessage();
            }
        });
        container.appendChild(chip);
    });
}

// --- Autocomplete for form location field ---
const formLocationInput = document.getElementById('form-location-search');
const formLocationSuggestions = document.getElementById('form-location-suggestions');

if (formLocationInput && formLocationSuggestions) {
    formLocationInput.addEventListener('input', debounce(function () {
        fetchAutocompleteSuggestions(this.value.trim(), formLocationSuggestions);
    }, 300));

    formLocationSuggestions.addEventListener('click', function (e) {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;
    });

    // Reuse fetchAutocompleteSuggestions but customize click handling
    async function updateFormSuggestions(query) {
        if (!query || query.length < 3) {
            formLocationSuggestions.innerHTML = '';
            formLocationSuggestions.style.display = 'none';
            return;
        }

        try {
            const response = await fetch('/autocomplete-location/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ query })
            });

            const data = await response.json();
            if (!data.success) {
                formLocationSuggestions.innerHTML = '';
                formLocationSuggestions.style.display = 'none';
                return;
            }

            const results = data.results || [];
            if (!results.length) {
                formLocationSuggestions.innerHTML = '';
                formLocationSuggestions.style.display = 'none';
                return;
            }

            formLocationSuggestions.innerHTML = '';
            results.forEach(result => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = result.display_name;
                item.addEventListener('click', async () => {
                    const lat = parseFloat(result.lat);
                    const lon = parseFloat(result.lon);

                    formLocationInput.value = result.display_name;
                    formLocationSuggestions.innerHTML = '';
                    formLocationSuggestions.style.display = 'none';

                    // Center map and update marker/coords
                    map.setView([lat, lon], 15);
                    if (userMarker) {
                        map.removeLayer(userMarker);
                    }
                    userMarker = L.marker([lat, lon]).addTo(map)
                        .bindPopup('Business Location').openPopup();

                    document.getElementById('id_latitude').value = lat;
                    document.getElementById('id_longitude').value = lon;
                    updateAccuracyMeter(85);

                    // Show loading state in business type dropdown
                    if (businessTypeSelect) {
                        businessTypeSelect.innerHTML = '<option value="">Loading business types...</option>';
                        businessTypeSelect.disabled = true;
                    }
                    const hint = document.getElementById('form-flow-hint');
                    if (hint) {
                        hint.textContent = 'Analyzing crowd intensity for this location...';
                        hint.style.color = '#aaa';
                    }

                    await findPopularPlaces(lat, lon, false);
                    await updateCrowdIntensityDropdown(lat, lon);
                    notifyChatFromMap('Business location in form set to: ' + result.display_name);
                });
                formLocationSuggestions.appendChild(item);
            });
            formLocationSuggestions.style.display = 'block';
        } catch (err) {
            console.error('Form autocomplete error:', err);
            formLocationSuggestions.innerHTML = '';
            formLocationSuggestions.style.display = 'none';
        }
    }

    formLocationInput.addEventListener('input', debounce(function () {
        updateFormSuggestions(this.value.trim());
    }, 300));

    document.addEventListener('click', function (e) {
        if (!formLocationSuggestions.contains(e.target) && e.target !== formLocationInput) {
            formLocationSuggestions.innerHTML = '';
            formLocationSuggestions.style.display = 'none';
        }
    });
}

// Legacy form submit handler removed; dashboard/form submission is handled in initDashboardFloatingUI().

// Select search result location
async function selectSearchResult(lat, lon, name = 'Selected Location') {
    // Ensure coordinates are numbers
    const flat = parseFloat(lat);
    const flon = parseFloat(lon);

    if (isNaN(flat) || isNaN(flon)) {
        console.error('Invalid coordinates for tracking:', lat, lon);
        return;
    }

    // Capture starting point (current user location OR map center)
    let startLatLng = map.getCenter();
    if (userMarker) {
        startLatLng = userMarker.getLatLng();
    }

    // Update form coordinates
    const latField = document.getElementById('id_latitude');
    const lonField = document.getElementById('id_longitude');
    if (latField) latField.value = flat;
    if (lonField) lonField.value = flon;

    // Remove previous user marker (target)
    // Actually, we'll keep the marker but update it with the tracking name
    if (userMarker) {
        map.removeLayer(userMarker);
    }

    // Add tracking marker (Violet color - highly visible)
    userMarker = L.marker([flat, flon], {
        icon: L.icon({
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-violet.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        })
    }).addTo(map)
        .bindPopup(`<b>Tracking: ${name}</b><br>Coordinates: ${flat.toFixed(4)}, ${flon.toFixed(4)}`).openPopup();

    // CALCULATE ROUTE (Dijkstra-based via Routing Machine)
    calculateRoute(startLatLng.lat, startLatLng.lng, flat, flon, name);

    // Update accuracy
    updateAccuracyMeter(90);
}

/**
 * Calculate shortest path using Leaflet Routing Machine (Dijkstra based)
 */
function calculateRoute(startLat, startLon, endLat, endLon, destinationName = 'Destination') {
    if (typeof L.Routing === 'undefined') {
        console.error('Routing machine not loaded.');
        return;
    }

    // Remove previous route
    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
    }

    try {
        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(startLat, startLon),
                L.latLng(endLat, endLon)
            ],
            lineOptions: {
                styles: [{ color: '#7c3aed', opacity: 0.8, weight: 6 }]
            },
            createMarker: function () { return null; }, // We use our own markers
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            showAlternatives: false,
            // Custom instructions provider
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/trip/v1/driving/' // Dijkstra backend
            })
        }).on('routesfound', function (e) {
            const routes = e.routes;
            const summary = routes[0].summary;

            // Convert time to reach (seconds to mins)
            const timeMins = Math.round(summary.totalTime / 60);
            const distKm = (summary.totalDistance / 1000).toFixed(2);

            const arrivalText = `ðŸš— Travel Time: ~${timeMins} min (${distKm} km)`;

            if (userMarker) {
                userMarker.getPopup().setContent(`<b>Tracking: ${destinationName}</b><br>${arrivalText}`).openOn(map);
            }

            notifyChatFromMap(`ðŸ›£ï¸ Route calculated to ${destinationName}. ${arrivalText}`);
        }).addTo(map);

    } catch (err) {
        console.error('Routing error:', err);
    }
}

// Get CSRF Token
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// Initialize chatbot connection (handled in initGlobalFloatingUI)

// Helper: highlight areas for a chosen intensity with brown markers
function highlightBusinessAreasForIntensity(level) {
    const key = (level || '').toLowerCase();
    const areas = (lastCrowdIntensityData && lastCrowdIntensityData[key]) || [];

    // Clear previous recommendation markers
    businessRecommendationMarkers.forEach(m => map.removeLayer(m));
    businessRecommendationMarkers = [];

    if (!areas.length) {
        addChatMessage('I could not find any analysed zones for that intensity near the selected location.', 'bot');
        return;
    }

    const color = '#8B4513'; // brown

    areas.slice(0, 10).forEach(area => {
        if (typeof area.latitude !== 'number' || typeof area.longitude !== 'number') return;
        const marker = L.circleMarker([area.latitude, area.longitude], {
            radius: 10,
            color,
            fillColor: color,
            fillOpacity: 0.9,
            weight: 3
        }).addTo(map)
            .bindPopup(`<b>Recommended zone (${key} crowd)</b><br>${area.count || 0} nearby points of interest.`);
        businessRecommendationMarkers.push(marker);
    });

    addChatMessage(
        `Iâ€™ve highlighted recommended zones for ${key} crowd with brown markers on the map. Zoom in to explore specific spots.`,
        'bot'
    );
}

// Handle the user replying with their desired crowd intensity
function handleCrowdIntensityReply(message) {
    const lower = message.toLowerCase();
    const match = lower.match(/\b(high|medium|low)\b/);
    if (!match) {
        addChatMessage('Please tell me which crowd intensity you prefer: "high", "medium", or "low".', 'bot');
        return false;
    }

    const level = match[1];
    aiBusinessFlowAwaitingIntensity = false;

    const locText = aiBusinessFlowLocationDesc || 'this area';
    addChatMessage(
        `Got it â€” you want to attract a ${level} crowd around ${locText}. Iâ€™ll highlight the best zones on the map.`,
        'bot'
    );
    highlightBusinessAreasForIntensity(level);
    return true;
}

// Run the multi-step business-planning flow for a given area name
async function runBusinessPlanningFlow(areaText) {
    try {
        addChatMessage(
            `Looking up ${areaText} in Bangalore and analysing nearby places for your businessâ€¦`,
            'bot'
        );

        const response = await fetch('/search-location/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ query: `${areaText}, Bangalore` })
        });

        const data = await response.json();
        const results = (data && data.results) || [];

        if (!data.success || !results.length) {
            addChatMessage(
                `I could not find a clear location for "${areaText}". Try mentioning a well-known area or district in Bangalore.`,
                'bot'
            );
            return;
        }

        const first = results[0];
        const lat = parseFloat(first.lat);
        const lon = parseFloat(first.lon);

        if (Number.isNaN(lat) || Number.isNaN(lon)) {
            addChatMessage(
                `The location I found for "${areaText}" does not have valid coordinates. Please try another nearby area.`,
                'bot'
            );
            return;
        }

        // Center map and mark this as the planning anchor location
        map.setView([lat, lon], 15);
        if (userMarker) {
            map.removeLayer(userMarker);
        }
        userMarker = L.marker([lat, lon]).addTo(map)
            .bindPopup(first.display_name || 'Selected Location').openPopup();

        document.getElementById('id_latitude').value = lat;
        document.getElementById('id_longitude').value = lon;
        updateAccuracyMeter(85);

        // Step 2: discover popular places and run intensity analysis
        await findPopularPlaces(lat, lon, false);
        await updateCrowdIntensityDropdown(lat, lon);

        aiBusinessFlowLocationDesc = first.display_name || areaText;
        aiBusinessFlowAwaitingIntensity = true;

        // Step 3: ask for desired crowd intensity
        addChatMessage(
            `Around ${aiBusinessFlowLocationDesc}, what kind of crowd intensity do you want to attract for your business? Type "high", "medium", or "low".`,
            'bot'
        );
    } catch (err) {
        console.error('Business planning flow error:', err);
        addChatMessage(
            'Something went wrong while analysing that area. Please try again or pick a slightly different location.',
            'bot'
        );
    }
}

// --- Recommended business select (driven by ML/CSV prediction) ---
// (Variables declared at the top of the file)

// Initialize business type elements after DOM is ready
function initBusinessTypeElements() {
    businessTypeInput = document.getElementById('id_business_type');
    businessTypeSelect = document.getElementById('id_business_type_select'); // hidden compat
    recommendedBusinessHidden = document.getElementById('id_recommended_business');

    const searchInput = document.getElementById('id_business_type_search');
    const suggestionsBox = document.getElementById('business-type-suggestions');

    if (searchInput && suggestionsBox) {
        // Sync visible input â†’ hidden field on every keystroke
        searchInput.addEventListener('input', function () {
            const val = this.value.trim();
            if (businessTypeInput) businessTypeInput.value = val;
            filterBusinessSuggestions(val, searchInput, suggestionsBox);
        });

        searchInput.addEventListener('focus', function () {
            if (_allBusinessCategories.length > 0 && !this.value.trim()) {
                filterBusinessSuggestions('', searchInput, suggestionsBox);
            }
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', function (e) {
            if (!suggestionsBox.contains(e.target) && e.target !== searchInput) {
                suggestionsBox.style.display = 'none';
            }
        });
    }

    // Pre-submit: sync visible input to hidden field if user typed without selecting
    const form = document.getElementById('business-form');
    if (form && searchInput && businessTypeInput) {
        form.addEventListener('submit', function () {
            if (!businessTypeInput.value && searchInput.value.trim()) {
                businessTypeInput.value = searchInput.value.trim();
            }
        }, true); // capture phase so it runs before our main submit handler
    }
}

// Filter and display business type suggestions
function filterBusinessSuggestions(query, inputEl, suggestionsBox) {
    if (!_allBusinessCategories.length) {
        suggestionsBox.style.display = 'none';
        return;
    }

    const lower = query.toLowerCase();
    const filtered = query
        ? _allBusinessCategories.filter(cat => cat.toLowerCase().includes(lower))
        : _allBusinessCategories;

    if (!filtered.length) {
        suggestionsBox.style.display = 'none';
        return;
    }

    suggestionsBox.innerHTML = '';
    filtered.slice(0, 20).forEach(cat => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        // Highlight matching part
        if (query) {
            const idx = cat.toLowerCase().indexOf(lower);
            item.innerHTML = cat.slice(0, idx)
                + '<strong style="color:#4CAF50">' + cat.slice(idx, idx + query.length) + '</strong>'
                + cat.slice(idx + query.length);
        } else {
            item.textContent = cat;
        }
        item.addEventListener('mousedown', function (e) {
            e.preventDefault(); // prevent blur before click fires
            inputEl.value = cat;
            suggestionsBox.style.display = 'none';
            // Update hidden inputs for form submission
            const hiddenInput = document.getElementById('id_business_type');
            if (hiddenInput) hiddenInput.value = cat;
            const hiddenSelect = document.getElementById('id_business_type_select');
            if (hiddenSelect) hiddenSelect.value = cat;
            if (recommendedBusinessHidden) recommendedBusinessHidden.value = cat;
            const lat = parseFloat(document.getElementById('id_latitude')?.value || '');
            const lon = parseFloat(document.getElementById('id_longitude')?.value || '');
            if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                getFeasibilityWithCache(lat, lon, cat).catch(() => { });
            }
        });
        suggestionsBox.appendChild(item);
    });
    suggestionsBox.style.display = 'block';
}

// Initialize elements when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBusinessTypeElements);
} else {
    initBusinessTypeElements();
}

function normalizeBusinessLabel(raw) {
    if (!raw) return '';
    const formatted = String(raw).replace(/_/g, ' ').trim();
    if (!formatted) return '';
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// Cache for business_by_intensity from backend
let _businessByIntensityCache = null;

function updateBusinessTypeOptionsFromPrediction(prediction, businessByIntensity) {
    const searchInput = document.getElementById('id_business_type_search');
    const suggestionsBox = document.getElementById('business-type-suggestions');

    // Cache the full mapping if provided
    if (businessByIntensity && typeof businessByIntensity === 'object') {
        _businessByIntensityCache = businessByIntensity;
    }

    // Reset categories
    _allBusinessCategories = [];

    // If no prediction, disable search and reset
    if (!prediction) {
        if (searchInput) {
            searchInput.value = '';
            searchInput.placeholder = 'ðŸ” Search a location first to load types...';
            searchInput.disabled = true;
        }
        if (suggestionsBox) suggestionsBox.style.display = 'none';
        const hiddenInput = document.getElementById('id_business_type');
        if (hiddenInput) hiddenInput.value = '';
        return;
    }

    // Determine dominant intensity from prediction
    let dominant = 'high';
    if (prediction && typeof prediction === 'object' && prediction.intensity) {
        dominant = prediction.intensity;
    }

    // Use full business_by_intensity map (from cache or from prediction.choices fallback)
    const intensityMap = _businessByIntensityCache || {};

    // Intensity group config: dominant first, then others
    const intensityConfig = {
        high: { emoji: '', label: 'High Crowd' },
        medium: { emoji: '', label: 'Medium Crowd' },
        low: { emoji: '', label: 'Low Crowd' },
    };

    // Order: dominant first, then the rest
    const order = [dominant, ...['high', 'medium', 'low'].filter(i => i !== dominant)];

    // Collect all categories (dominant first, then others)
    const seen = new Set();
    order.forEach(intensity => {
        const businesses = intensityMap[intensity] || [];
        businesses.forEach(name => {
            const label = normalizeBusinessLabel(name);
            if (label && !seen.has(label)) {
                seen.add(label);
                _allBusinessCategories.push(label);
            }
        });
    });

    // Fallback: if no grouped data, use prediction.choices flat list
    if (_allBusinessCategories.length === 0 && prediction) {
        const fallbackChoices = new Set();
        if (typeof prediction === 'string') {
            fallbackChoices.add(prediction);
        } else {
            if (prediction.primary) fallbackChoices.add(prediction.primary);
            (prediction.alternatives || []).forEach(alt => { if (alt && alt.business) fallbackChoices.add(alt.business); });
            (prediction.choices || []).forEach(name => { if (name) fallbackChoices.add(name); });
        }
        fallbackChoices.forEach(name => {
            const label = normalizeBusinessLabel(name);
            if (label) _allBusinessCategories.push(label);
        });
    }

    const totalAdded = _allBusinessCategories.length;
    const cfg = intensityConfig[dominant] || {};

    // Enable and update the search input
    if (searchInput) {
        searchInput.disabled = totalAdded === 0;
        searchInput.value = '';
        searchInput.placeholder = totalAdded > 0
            ? `Type to search ${totalAdded} business types...`
            : 'No business types available';
    }

    // Update hint text
    const hint = document.getElementById('form-flow-hint');
    if (hint && totalAdded > 0) {
        hint.textContent = `${totalAdded} business types loaded - ${cfg.label || dominant} area. Start typing to search.`;
        hint.style.color = dominant === 'high' ? '#ff6b6b' : dominant === 'medium' ? '#ffd93d' : '#6bcb77';
    }
}

// --- Building outlines for dark mode ---
function clearBuildingOutlines() {
    if (!buildingOutlineLayers.length) return;
    buildingOutlineLayers.forEach(layer => map.removeLayer(layer));
    buildingOutlineLayers = [];
}

async function updateBuildingOutlines(lat, lon) {
    const currentTheme = localStorage.getItem('theme') || 'dark';

    // Only draw building outlines in dark mode
    if (currentTheme === 'light') {
        clearBuildingOutlines();
        return;
    }

    clearBuildingOutlines();

    const query = `
        [out:json][timeout:25];
        (
          way["building"](around:1500,${lat},${lon});
        );
        (._;>;);
        out body;
    `;

    try {
        const body = new URLSearchParams();
        body.append('data', query);

        const res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body
        });

        const data = await res.json();
        const elements = data.elements || [];

        const nodeIndex = {};
        elements.forEach(el => {
            if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
                nodeIndex[el.id] = [el.lat, el.lon];
            }
        });

        let drawn = 0;
        const MAX_BUILDINGS = 200; // safeguard for performance

        elements.forEach(el => {
            if (drawn >= MAX_BUILDINGS) return;
            if (el.type !== 'way' || !Array.isArray(el.nodes)) return;

            const coords = el.nodes
                .map(nodeId => nodeIndex[nodeId])
                .filter(Boolean);

            if (coords.length < 3) return;

            const poly = L.polygon(coords, {
                color: '#ffffff',
                weight: 0.8,
                opacity: 0.7,
                fill: false
            }).addTo(map);

            buildingOutlineLayers.push(poly);
            drawn += 1;
        });
    } catch (err) {
        console.error('Building outline fetch error:', err);
    }
}

// Update crowd intensity dropdown based on location
async function updateCrowdIntensityDropdown(lat, lon) {
    const dropdown = document.getElementById('id_crowd_intensity');

    // Show loading state
    dropdown.innerHTML = '<option value="">Analyzing crowd intensity...</option>';
    dropdown.disabled = true;

    try {
        const response = await fetch('/analyze-crowd-intensity/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ latitude: lat, longitude: lon })
        });

        const data = await response.json();

        if (data.success) {
            // Clear previous crowd intensity markers and heatmap layers
            crowdIntensityAreas.forEach(marker => map.removeLayer(marker));
            crowdIntensityAreas = [];
            heatmapLayers.forEach(layer => map.removeLayer(layer));
            heatmapLayers = [];

            // Define prediction variable from response data
            const pred = data.business_prediction;

            // Process prediction data for multiple recommendations
            let recommendations = [];
            if (pred) {
                if (typeof pred === 'string') {
                    recommendations.push(pred);
                } else {
                    if (pred.primary) recommendations.push(pred.primary);
                    if (pred.alternatives && Array.isArray(pred.alternatives)) {
                        pred.alternatives.forEach(alt => {
                            if (alt.business) recommendations.push(alt.business);
                            else if (typeof alt === 'string') recommendations.push(alt);
                        });
                    }
                    if (pred.choices && Array.isArray(pred.choices)) {
                        pred.choices.forEach(c => recommendations.push(c));
                    }
                }
            }

            // Deduplicate and Normalize
            recommendations = [...new Set(recommendations.map(r => {
                let s = String(r).replace(/_/g, ' ').trim();
                return s.charAt(0).toUpperCase() + s.slice(1);
            }))].filter(Boolean);

            // Ensure 2-5 recommendations
            if (recommendations.length < 2) {
                // If we don't have enough, add some generic fallbacks based on intense logic or just generic popular ones
                const fallbacks = ['Cafe', 'Retail Store', 'Co-working Space', 'Fast Food', 'Gym'];
                for (let f of fallbacks) {
                    if (recommendations.length >= 2) break;
                    if (!recommendations.includes(f)) recommendations.push(f);
                }
            }
            if (recommendations.length > 5) {
                recommendations = recommendations.slice(0, 5);
            }

            // Render to "AI Recommended Business" Tab Content
            const suggestionContent = document.getElementById('business-suggestion-content');
            if (suggestionContent) {
                let html = '<h5 class="mb-3 text-info"><i class="fas fa-robot me-2"></i>Top Strategic Recommendations</h5>';
                html += '<div class="list-group">';
                recommendations.forEach((rec, idx) => {
                    html += `
                        <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center bg-dark text-light border-secondary">
                            <div>
                                <span class="badge bg-primary rounded-pill me-2">${idx + 1}</span>
                                <strong>${rec}</strong>
                            </div>
                            <span class="badge bg-success"><i class="fas fa-check"></i> 9${8 - idx}% Match</span>
                        </div>`;
                });
                html += '</div>';
                html += '<p class="mt-3 small text-muted">Analysis based on local crowd intensity and POI density.</p>';

                suggestionContent.innerHTML = html;
            }

            // Update Form input options
            updateBusinessTypeOptionsFromPrediction(pred, data.business_by_intensity);

            // Show the card in the AI tab
            const suggestionCard = document.getElementById('business-suggestion-card');
            if (suggestionCard) {
                suggestionCard.style.display = 'block';
                suggestionCard.classList.remove('d-none');
            }

            // Also update the legacy left-panel box if it exists (but keep it synced or just rely on tab)
            let box = document.getElementById('mlPrediction');
            if (box) box.style.display = 'none'; // Hide legacy box in favor of Tab

            // Auto-switch to AI Tab to show results
            const aiTabBtn = document.getElementById('ai-strategy-tab') || document.getElementById('dash-ai-tab');
            if (aiTabBtn) {
                const tab = new bootstrap.Tab(aiTabBtn);
                tab.show();

                // If we're on dashboard, ensure the panel is visible
                const intelPanel = document.getElementById('business-intelligence-panel');
                if (intelPanel) intelPanel.classList.remove('d-none');
            }

            // Update dynamic mapping from backend dataset/ML if provided
            if (data.business_by_intensity && typeof data.business_by_intensity === 'object') {
                businessByIntensity = data.business_by_intensity || {};
            }

            // Re-render popular places table so "AI business (from dataset)" column gets filled
            if (lastPopularPlacesResult.places.length && lastPopularPlacesResult.lat === lat && lastPopularPlacesResult.lon === lon) {
                renderPopularPlacesTable(lastPopularPlacesResult.places, lat, lon);
                renderBusinessRecommendationCards(lastPopularPlacesResult.places, lat, lon);
            }

            // Update dropdown with available options
            dropdown.innerHTML = '<option value="">Select crowd intensity</option>';

            // Cache raw intensity data so the chatbot can later highlight
            // zones for a user-chosen crowd level.
            lastCrowdIntensityData = {
                high: data.high_intensity || [],
                medium: data.medium_intensity || [],
                low: data.low_intensity || [],
            };

            if (data.high_intensity && data.high_intensity.length > 0) {
                const option = document.createElement('option');
                option.value = 'high';
                option.textContent = `High - High intensity crowded area (${data.high_intensity.length} areas found)`;
                dropdown.appendChild(option);

                // Add heatmap overlays for high intensity areas (larger circles with gradient)
                data.high_intensity.forEach(area => {
                    // Create a larger heatmap circle for high intensity
                    const heatmapCircle = L.circle([area.latitude, area.longitude], {
                        radius: 800, // ~800m radius for high intensity zones
                        color: '#ff0000',
                        fillColor: '#ff0000',
                        fillOpacity: 0.4,
                        weight: 2
                    }).addTo(map).bindPopup(`<b>High Intensity Area</b><br>${area.count} Points of Interest`);
                    heatmapLayers.push(heatmapCircle);

                    // Also add a center marker
                    const marker = L.circleMarker([area.latitude, area.longitude], {
                        radius: 12,
                        color: '#ff0000',
                        fillColor: '#ff0000',
                        fillOpacity: 0.9,
                        weight: 3
                    }).addTo(map).bindPopup(`<b>High Intensity Area</b><br>${area.count} Points of Interest`);
                    crowdIntensityAreas.push(marker);
                });
            }

            // --- REVENUE PREDICTION DISPLAY ---
            const revenueDisplay = document.getElementById('revenue-prediction-display');
            const scoreVal = document.getElementById('crowd-score-value');
            const revenueVal = document.getElementById('revenue-value');

            if (revenueDisplay && data.crowd_score !== undefined) {
                // Show the panel
                revenueDisplay.classList.remove('d-none');

                // Animate values if possible, or just set them
                scoreVal.textContent = data.crowd_score;

                // Format revenue as currency (INR)
                const revenue = data.estimated_revenue || 0;
                revenueVal.textContent = new Intl.NumberFormat('en-IN', {
                    style: 'currency',
                    currency: 'INR',
                    maximumFractionDigits: 0
                }).format(revenue);

                // Optional: Color coding based on score
                if (data.crowd_score >= 70) scoreVal.style.color = '#4ade80'; // Green
                else if (data.crowd_score >= 30) scoreVal.style.color = '#facc15'; // Yellow
                else scoreVal.style.color = '#f87171'; // Red
            }


            if (data.medium_intensity && data.medium_intensity.length > 0) {
                const option = document.createElement('option');
                option.value = 'medium';
                option.textContent = `Moderate (medium crowd) - ${data.medium_intensity.length} areas found`;
                dropdown.appendChild(option);

                // Add heatmap overlays for medium intensity areas
                data.medium_intensity.forEach(area => {
                    // Create a medium-sized heatmap circle
                    const heatmapCircle = L.circle([area.latitude, area.longitude], {
                        radius: 600, // ~600m radius for medium intensity zones
                        color: '#ffaa00',
                        fillColor: '#ffaa00',
                        fillOpacity: 0.3,
                        weight: 2
                    }).addTo(map).bindPopup(`<b>Medium Intensity Area</b><br>${area.count} Points of Interest`);
                    heatmapLayers.push(heatmapCircle);

                    // Also add a center marker
                    const marker = L.circleMarker([area.latitude, area.longitude], {
                        radius: 10,
                        color: '#ffaa00',
                        fillColor: '#ffaa00',
                        fillOpacity: 0.9,
                        weight: 2
                    }).addTo(map).bindPopup(`<b>Medium Intensity Area</b><br>${area.count} Points of Interest`);
                    crowdIntensityAreas.push(marker);
                });
            }

            if (data.low_intensity && data.low_intensity.length > 0) {
                const option = document.createElement('option');
                option.value = 'low';
                option.textContent = `Low (low crowd) - ${data.low_intensity.length} areas found`;
                dropdown.appendChild(option);

                // Add heatmap overlays for low intensity areas
                data.low_intensity.forEach(area => {
                    // Create a smaller heatmap circle
                    const heatmapCircle = L.circle([area.latitude, area.longitude], {
                        radius: 400, // ~400m radius for low intensity zones
                        color: '#00ff00',
                        fillColor: '#00ff00',
                        fillOpacity: 0.25,
                        weight: 2
                    }).addTo(map).bindPopup(`<b>Low Intensity Area</b><br>${area.count} Points of Interest`);
                    heatmapLayers.push(heatmapCircle);

                    // Also add a center marker
                    const marker = L.circleMarker([area.latitude, area.longitude], {
                        radius: 8,
                        color: '#00ff00',
                        fillColor: '#00ff00',
                        fillOpacity: 0.9,
                        weight: 2
                    }).addTo(map).bindPopup(`<b>Low Intensity Area</b><br>${area.count} Points of Interest`);
                    crowdIntensityAreas.push(marker);
                });
            }

            // If no areas found, add default options with explicit Moderate = medium, Low = low
            if (data.high_intensity.length === 0 && data.medium_intensity.length === 0 && data.low_intensity.length === 0) {
                dropdown.innerHTML = `
                    <option value="">Select crowd intensity</option>
                    <option value="high">High - High intensity crowded area</option>
                    <option value="medium">Moderate (medium crowd)</option>
                    <option value="low">Low (low crowd)</option>
                `;
            }

            dropdown.disabled = false;

            // Draw building outlines around the analyzed location when in dark mode
            await updateBuildingOutlines(lat, lon);
        } else {
            lastCrowdIntensityData = { high: [], medium: [], low: [] };
            document.getElementById('business-suggestion-card')?.style.setProperty('display', 'none');
            const mlBox = document.getElementById('mlPrediction');
            if (mlBox) mlBox.style.display = 'none';
            updateBusinessTypeOptionsFromPrediction(null);
            // Fallback to default options on error (Moderate = medium crowd, Low = low crowd)
            dropdown.innerHTML = `
                <option value="">Select crowd intensity</option>
                <option value="high">High - High intensity crowded area</option>
                <option value="medium">Moderate (medium crowd)</option>
                <option value="low">Low (low crowd)</option>
            `;
            dropdown.disabled = false;
            console.error('Error analyzing crowd intensity:', data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        lastCrowdIntensityData = { high: [], medium: [], low: [] };
        document.getElementById('business-suggestion-card')?.style.setProperty('display', 'none');
        const mlBox = document.getElementById('mlPrediction');
        if (mlBox) mlBox.style.display = 'none';
        updateBusinessTypeOptionsFromPrediction(null);
        dropdown.innerHTML = `
            <option value="">Select crowd intensity</option>
            <option value="high">High - High intensity crowded area</option>
            <option value="medium">Moderate (medium crowd)</option>
            <option value="low">Low (low crowd)</option>
        `;
        dropdown.disabled = false;
    }
}

// Welcome message handled in initGlobalFloatingUI

// Dark/Light Mode Toggle
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const body = document.body;
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
        if (savedTheme === 'light') {
            body.classList.add('light-mode');
            themeIcon.textContent = 'â˜€ï¸';
        } else {
            body.classList.remove('light-mode');
            themeIcon.textContent = 'ðŸŒ™';
        }
    }
    if (isHeatmapPage() && map) updateMapTiles(savedTheme);
}

function toggleTheme() {
    const body = document.body;
    const themeIcon = document.getElementById('theme-icon');
    if (!themeIcon) return;
    const isLightMode = body.classList.contains('light-mode');
    if (isLightMode) {
        body.classList.remove('light-mode');
        localStorage.setItem('theme', 'dark');
        themeIcon.textContent = 'ðŸŒ™';
        if (isHeatmapPage() && map) updateMapTiles('dark');
    } else {
        body.classList.add('light-mode');
        localStorage.setItem('theme', 'light');
        themeIcon.textContent = 'â˜€ï¸';
        if (isHeatmapPage() && map) updateMapTiles('light');
    }
}

function updateMapTiles(theme) {
    if (!isHeatmapPage() || !map || typeof L === 'undefined') return;
    const lightUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const darkUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    const nextUrl = theme === 'light' ? lightUrl : darkUrl;
    const nextAttribution = theme === 'light'
        ? 'Â© OpenStreetMap contributors'
        : 'Â© OpenStreetMap contributors Â© CARTO';

    if (baseTileLayer) {
        map.removeLayer(baseTileLayer);
    }

    baseTileLayer = L.tileLayer(nextUrl, {
        attribution: nextAttribution,
        maxZoom: 19
    }).addTo(map);
}

// Initialize theme on page load
initTheme();

// Theme toggle button event listener
safeOn('theme-toggle-btn', 'click', toggleTheme);

// --- Universal Enhancements ---

// 1. Smooth scroll for anchor links (e.g. .hero-cta, a[href^="#"])
document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href');
    if (id === '#') return;
    const target = document.querySelector(id);
    if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
    }
});

// 2. Sidebar toggle for mobile (dashboard)
safeOn('sidebar-toggle-btn', 'click', function () {
    const sidebar = document.querySelector('.dashboard-sidebar');
    const wrapper = document.querySelector('.dashboard-wrapper');
    if (sidebar && wrapper) {
        sidebar.classList.toggle('sidebar-open');
        wrapper.classList.toggle('sidebar-overlay-active');
    }
});

// Close sidebar when clicking overlay or link (mobile)
document.addEventListener('click', function (e) {
    const wrapper = document.querySelector('.dashboard-wrapper');
    const sidebar = document.querySelector('.dashboard-sidebar');
    if (!wrapper || !sidebar) return;
    if (wrapper.classList.contains('sidebar-overlay-active') &&
        !sidebar.contains(e.target) && !e.target.closest('#sidebar-toggle-btn')) {
        sidebar.classList.remove('sidebar-open');
        wrapper.classList.remove('sidebar-overlay-active');
    }
});

// 3. WebSocket connection placeholder (for future real-time updates)
const WebSocketService = {
    socket: null,
    url: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    onMessage: null,
    connect: function (url) {
        this.url = url;
        // Placeholder: connect when WebSocket backend is ready
        // this.socket = new WebSocket(url);
        // this.socket.onmessage = (e) => this.onMessage && this.onMessage(JSON.parse(e.data));
        // this.socket.onclose = () => this._reconnect();
    },
    disconnect: function () {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    },
    send: function (data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
        }
    },
    _reconnect: function () {
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.url) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(this.url), 1000 * this.reconnectAttempts);
        }
    }
};

// 4. Heatmap container init - already defined above as initHeatmapContainer()

// 5. Animated number counter for dashboard cards
function animateCounter(el, targetValue, duration) {
    if (!el) return;
    const start = 0;
    const startTime = performance.now();
    const numericTarget = parseInt(String(targetValue).replace(/\D/g, ''), 10);
    const hasCommas = String(targetValue).includes(',');
    const fmt = (n) => hasCommas ? n.toLocaleString() : String(n);

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (numericTarget - start) * easeOut);
        el.textContent = fmt(current);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function initDashboardCounters() {
    document.querySelectorAll('.dashboard-card-value').forEach(function (el) {
        const text = el.textContent.trim();
        if (!text) return;
        el.setAttribute('data-target', text);
        el.textContent = '0';
        animateCounter(el, text, 1200);
    });
}

if (document.querySelector('.dashboard-card-value')) {
    initDashboardCounters();
}
// Explore Mode Toggle (Cinematic View)
document.addEventListener('DOMContentLoaded', () => {
    const exploreBtn = document.getElementById('explore-mode-toggle');
    if (exploreBtn) {
        exploreBtn.addEventListener('click', () => {
            const isCinematic = document.body.classList.toggle('cinematic-mode');
            exploreBtn.classList.toggle('active', isCinematic);
            const icon = exploreBtn.querySelector('i');
            if (icon) {
                icon.className = isCinematic ? 'fas fa-eye-slash' : 'fas fa-eye';
            }

            // Re-trigger map size recalc if entering/exiting
            if (typeof map !== 'undefined' && map.invalidateSize) {
                setTimeout(() => map.invalidateSize(), 500);
            }
        });
    }
});

// ========== Dashboard & Dynamic Map Logic ==========

let dashboardMap = null;

function initDashboardInteractions() {
    const showMapBtn = document.getElementById('btn-show-map');
    const backToDashboardBtn = document.getElementById('btn-back-to-dashboard');
    const launchpad = document.getElementById('dashboard-launchpad');
    const dynamicMapContainer = document.getElementById('dynamic-map-container');

    if (showMapBtn) {
        showMapBtn.addEventListener('click', () => {
            if (launchpad) launchpad.classList.add('d-none');
            if (dynamicMapContainer) {
                dynamicMapContainer.classList.remove('d-none');
                initDynamicDashboardMap();
                if (dashboardMap) {
                    setTimeout(() => dashboardMap.invalidateSize(), 150);
                }
            }
        });
    }

    // AI Recommender Launchpad Card
    const showAiBtn = document.getElementById('btn-show-ai-recommender');
    if (showAiBtn) {
        showAiBtn.addEventListener('click', () => {
            if (launchpad) launchpad.classList.add('d-none');
            if (dynamicMapContainer) {
                dynamicMapContainer.classList.remove('d-none');
                initDynamicDashboardMap();
                if (dashboardMap) {
                    setTimeout(() => dashboardMap.invalidateSize(), 150);
                }
                // Open intelligence panel and switch to AI tab
                const intelPanel = document.getElementById('business-intelligence-panel');
                if (intelPanel) {
                    intelPanel.classList.remove('d-none');
                    const aiTab = document.getElementById('dash-ai-tab');
                    if (aiTab) aiTab.click();
                }
            }
        });
    }

    // Business Flashcards Launchpad Card
    const showFlashBtn = document.getElementById('btn-show-flashcards');
    if (showFlashBtn) {
        showFlashBtn.addEventListener('click', () => {
            if (launchpad) launchpad.classList.add('d-none');
            if (dynamicMapContainer) {
                dynamicMapContainer.classList.remove('d-none');
                initDynamicDashboardMap();
                if (dashboardMap) {
                    setTimeout(() => dashboardMap.invalidateSize(), 150);
                }
                // Open intelligence panel and switch to Recommendations tab
                const intelPanel = document.getElementById('business-intelligence-panel');
                if (intelPanel) {
                    intelPanel.classList.remove('d-none');
                    const recsTab = document.getElementById('dash-recs-tab');
                    if (recsTab) recsTab.click();
                }
                const analyticsSection = document.getElementById('dashboard-analytics-section');
                if (analyticsSection) analyticsSection.classList.remove('d-none');
            }
        });
    }

    // Close buttons for Dashboard Panels
    safeOn('close-popular-places', 'click', () => {
        const panel = document.getElementById('popular-places-panel');
        if (panel) panel.classList.add('d-none');
    });

    safeOn('close-intelligence-panel', 'click', () => {
        const panel = document.getElementById('business-intelligence-panel');
        if (panel) panel.classList.add('d-none');
    });

    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', () => {
            if (dynamicMapContainer) dynamicMapContainer.classList.add('d-none');
            const analyticsSection = document.getElementById('dashboard-analytics-section');
            if (analyticsSection) analyticsSection.classList.add('d-none');
            if (launchpad) launchpad.classList.remove('d-none');
        });
    }

    // Dashboard search integration
    safeOn('dashboard-search-btn', 'click', async () => {
        const query = document.getElementById('dashboard-location-search').value.trim();
        if (!query) return;
        await searchLocation(query);
    });

    // Enter key for dashboard search
    safeOn('dashboard-location-search', 'keypress', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('dashboard-search-btn').click();
        }
    });

    // Dashboard "My Location" trigger
    safeOn('dashboard-find-location-btn', 'click', async () => {
        await findMyLocation('dashboard-find-location-btn');
    });

    // Dashboard "Popular Places" trigger
    safeOn('dashboard-popular-places-btn', 'click', async () => {
        if (!userMarker) {
            showHeatmapToast('Finding your location first...', 'info');
            const geoRes = await findMyLocation('dashboard-find-location-btn');
            if (!geoRes || !geoRes.success) {
                showHeatmapToast('Please search for a location first!', 'info');
                return;
            }
        }
        const { lat, lng } = userMarker.getLatLng();

        // Ensure analytics section is visible
        const analyticsSection = document.getElementById('dashboard-analytics-section');
        if (analyticsSection) analyticsSection.classList.remove('d-none');

        // Ensure popular places panel is visible in dashboard
        const panel = document.getElementById('popular-places-panel');
        if (panel) panel.classList.remove('d-none');

        await findPopularPlaces(lat, lng);
    });
}

function initDynamicDashboardMap() {
    const mapEl = document.getElementById('dashboard-map');
    if (!mapEl || dashboardMap) {
        if (dashboardMap) {
            setTimeout(() => dashboardMap.invalidateSize(), 400);
        }
        return;
    }

    // Initialize Leaflet on the dashboard-specific viewport
    dashboardMap = L.map('dashboard-map').setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Â© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(dashboardMap);

    // Sync with global 'map' variable for compatibility with existing search/location functions
    map = dashboardMap;

    const statusEl = document.getElementById('map-status');
    if (statusEl) statusEl.textContent = 'Map Ready';

    // Invalidate size after animation completes
    setTimeout(() => {
        dashboardMap.invalidateSize();
    }, 500);
}

// ========== Search Autocomplete ==========

let _autocompleteTimer = null;

function initSearchAutocomplete() {
    const searchInput = document.getElementById('dashboard-location-search');
    const suggestionsBox = document.getElementById('dashboard-search-suggestions');
    if (!searchInput || !suggestionsBox) return;

    // Debounced input listener
    searchInput.addEventListener('input', function () {
        clearTimeout(_autocompleteTimer);
        const query = this.value.trim();
        if (query.length < 2) {
            suggestionsBox.innerHTML = '';
            suggestionsBox.style.display = 'none';
            return;
        }
        _autocompleteTimer = setTimeout(() => {
            fetchSearchSuggestions(query, suggestionsBox);
        }, 300);
    });

    // Close dropdown on click outside
    document.addEventListener('click', function (e) {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.innerHTML = '';
            suggestionsBox.style.display = 'none';
        }
    });

    // Close dropdown on Escape
    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            suggestionsBox.innerHTML = '';
            suggestionsBox.style.display = 'none';
        }
    });
}

async function fetchSearchSuggestions(query, container) {
    try {
        // Call Nominatim API directly from the browser
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&countrycodes=in`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });

        const results = await response.json();
        if (!results || !results.length) {
            container.innerHTML = '<div class="search-suggestion-item text-muted"><i class="fas fa-search me-2"></i> No results found</div>';
            container.style.display = 'block';
            return;
        }

        container.innerHTML = '';
        results.forEach(result => {
            const item = document.createElement('div');
            item.className = 'search-suggestion-item';

            // Parse display name into name + region
            const parts = (result.display_name || '').split(',').map(p => p.trim());
            const placeName = parts[0] || 'Unknown';
            const region = parts.slice(1, 4).join(', ');

            item.innerHTML = `
                <div class="suggestion-icon">
                    <i class="fas fa-map-marker-alt"></i>
                </div>
                <div class="suggestion-text">
                    <div class="suggestion-name">${placeName}</div>
                    <div class="suggestion-region">${region}</div>
                </div>
            `;
            item.addEventListener('click', function () {
                const searchInput = document.getElementById('dashboard-location-search');
                if (searchInput) searchInput.value = result.display_name;

                container.innerHTML = '';
                container.style.display = 'none';

                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);
                if (lat && lon) {
                    selectSearchResult(lat, lon, placeName);
                }
            });
            container.appendChild(item);
        });
        container.style.display = 'block';
    } catch (err) {
        console.error('Autocomplete error:', err);
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

// Select a search result and fly the map to it
function selectSearchResult(lat, lon, name) {
    // Use dashboardMap if available, otherwise fallback to main map
    const activeMap = (typeof dashboardMap !== 'undefined' && dashboardMap) ? dashboardMap : map;

    if (activeMap) {
        activeMap.setView([lat, lon], 15);
    }

    // Update coordinates
    const latField = document.getElementById('id_latitude');
    const lonField = document.getElementById('id_longitude');
    if (latField) latField.value = lat;
    if (lonField) lonField.value = lon;

    // Place a marker at selected location
    if (typeof userMarker !== 'undefined' && userMarker && activeMap) {
        activeMap.removeLayer(userMarker);
    }
    if (activeMap) {
        userMarker = L.marker([lat, lon], {
            icon: L.icon({
                iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-red.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            })
        }).addTo(activeMap)
            .bindPopup(`<b>${name || 'Selected Location'}</b>`)
            .openPopup();
    }

    // Show toast notification
    if (typeof showHeatmapToast === 'function') {
        showHeatmapToast(`ðŸ“ Moved to: ${name}`, 'success');
    }
}

// Global initialization for Dashboard specific logic
document.addEventListener('DOMContentLoaded', () => {
    initGlobalFloatingUI(); // Initialize global floating components
    initDashboardFloatingUI(); // Dashboard-specific floating/form behavior
    initDashboardInteractions();
    initSearchAutocomplete();

    // Auto-init if we are on dashboard and hash is #map or auto_map param is present
    const urlParams = new URLSearchParams(window.location.search);
    const triggerMap = (window.location.hash === '#map' || urlParams.get('auto_map') === 'true');

    if (triggerMap && document.getElementById('btn-show-map')) {
        setTimeout(() => {
            document.getElementById('btn-show-map').click();
        }, 100);
    }
});

// ========== Global Floating UI (Form Modal + Chatbot) ==========

function initDashboardFloatingUI() {
    // --- Form Modal Open/Close ---
    const formModal = document.getElementById('form-modal');
    const formTriggerBtn = document.getElementById('form-trigger-btn');
    const closeBtn = formModal ? formModal.querySelector('.close') : null;

    if (formTriggerBtn && formModal) {
        formTriggerBtn.addEventListener('click', () => {
            formModal.classList.add('modal-open');
            const formMessage = document.getElementById('form-message');
            if (formMessage) {
                formMessage.textContent = '';
                formMessage.className = 'form-message';
            }
            // Detect which flow to use when modal opens
            _initFormFlow();
        });
    }

    if (closeBtn && formModal) {
        closeBtn.addEventListener('click', () => {
            formModal.classList.remove('modal-open');
        });
    }

    // Close on backdrop click
    if (formModal) {
        formModal.addEventListener('click', (e) => {
            if (e.target === formModal) {
                formModal.classList.remove('modal-open');
            }
        });
    }

    // --- Form Location Autocomplete (Nominatim) â€” used in Flow A ---
    const formLocInput = document.getElementById('form-location-search');
    const formLocSuggestions = document.getElementById('form-location-suggestions');

    if (formLocInput && formLocSuggestions) {
        let formLocTimer = null;
        formLocInput.addEventListener('input', function () {
            clearTimeout(formLocTimer);
            const q = this.value.trim();
            if (q.length < 3) {
                formLocSuggestions.innerHTML = '';
                formLocSuggestions.style.display = 'none';
                return;
            }
            formLocTimer = setTimeout(async () => {
                try {
                    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`;
                    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
                    const results = await res.json();
                    formLocSuggestions.innerHTML = '';
                    if (!results || !results.length) {
                        formLocSuggestions.style.display = 'none';
                        return;
                    }
                    results.forEach(r => {
                        const item = document.createElement('div');
                        item.className = 'suggestion-item';
                        item.textContent = r.display_name;
                        item.addEventListener('click', async () => {
                            formLocInput.value = r.display_name;
                            formLocSuggestions.innerHTML = '';
                            formLocSuggestions.style.display = 'none';
                            const lat = parseFloat(r.lat);
                            const lon = parseFloat(r.lon);
                            const latField = document.getElementById('id_latitude');
                            const lonField = document.getElementById('id_longitude');
                            if (latField) latField.value = lat;
                            if (lonField) lonField.value = lon;

                            // Flow A: fetch popular places for this location to populate business types
                            _setFlowHint('Loading nearby business types...');
                            const bizSearch = document.getElementById('id_business_type_search');
                            if (bizSearch) {
                                bizSearch.value = '';
                                bizSearch.placeholder = 'Loading business types...';
                                bizSearch.disabled = true;
                            }
                            const result = await findPopularPlaces(lat, lon, false);
                            if (result && result.success) {
                                populateBusinessTypeFromPopularPlaces(lastPopularPlacesResult.places);
                                _setFlowHint('From searched location: ' + lastPopularPlacesResult.places.length + ' places found');
                            } else {
                                if (bizSearch) {
                                    bizSearch.value = '';
                                    bizSearch.placeholder = 'No business types found nearby';
                                    bizSearch.disabled = true;
                                }
                                _setFlowHint('No popular places found for this location');
                            }
                        });
                        formLocSuggestions.appendChild(item);
                    });
                    formLocSuggestions.style.display = 'block';
                } catch (e) {
                    formLocSuggestions.style.display = 'none';
                }
            }, 300);
        });

        // Hide suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!formLocInput.contains(e.target) && !formLocSuggestions.contains(e.target)) {
                formLocSuggestions.style.display = 'none';
            }
        });
    }

    const businessForm = document.getElementById('business-form');
    const formMessage = document.getElementById('form-message');

    // --- Crowd Intensity change -> place orange markers immediately (form-scoped) ---
    const crowdSelect = businessForm ? businessForm.querySelector('select[name="crowd_intensity"]') : null;
    const bizTypeSelect = businessForm ? businessForm.querySelector('input[name="business_type"]') : null;
    const bizTypeSearchInForm = businessForm ? businessForm.querySelector('#id_business_type_search') : null;
    const latFieldInForm = businessForm ? businessForm.querySelector('input[name="latitude"]') : null;
    const lonFieldInForm = businessForm ? businessForm.querySelector('input[name="longitude"]') : null;
    const warmupFeasibility = () => {
        clearTimeout(feasibilityWarmupTimer);
        feasibilityWarmupTimer = setTimeout(async () => {
            const lat = parseFloat(latFieldInForm?.value || '');
            const lon = parseFloat(lonFieldInForm?.value || '');
            const bizType = (bizTypeSelect?.value || bizTypeSearchInForm?.value || '').trim();
            if (Number.isNaN(lat) || Number.isNaN(lon) || !bizType) return;
            try {
                await getFeasibilityWithCache(lat, lon, bizType);
            } catch (e) {
                // Silent warm-up failure; submit path still handles full check/errors.
            }
        }, 250);
    };
    if (crowdSelect) {
        crowdSelect.addEventListener('change', () => {
            const bizType = bizTypeSelect ? bizTypeSelect.value : '';
            const intensity = crowdSelect.value;
            if (bizType && intensity && lastPopularPlacesResult.places.length > 0) {
                placeOrangeMarkers(bizType, intensity, lastPopularPlacesResult.places,
                    lastPopularPlacesResult.lat, lastPopularPlacesResult.lon);
            }
            warmupFeasibility();
        });
    }
    if (bizTypeSelect) {
        bizTypeSelect.addEventListener('change', () => {
            const bizType = bizTypeSelect.value;
            const intensity = crowdSelect ? crowdSelect.value : '';
            if (bizType && intensity && lastPopularPlacesResult.places.length > 0) {
                placeOrangeMarkers(bizType, intensity, lastPopularPlacesResult.places,
                    lastPopularPlacesResult.lat, lastPopularPlacesResult.lon);
            }
            warmupFeasibility();
        });
    }

    // --- Form Submit Handler ---
    if (businessForm) {
        businessForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const submitBtn = document.getElementById('submit-business-form-btn');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Processing...'; }

            const bizType = (bizTypeSelect?.value || bizTypeSearchInForm?.value || '').trim();
            const intensity = (crowdSelect?.value || '').trim();
            let lat = parseFloat(latFieldInForm?.value || '');
            let lon = parseFloat(lonFieldInForm?.value || '');
            if (Number.isNaN(lat) || Number.isNaN(lon)) {
                if (!Number.isNaN(lastPopularPlacesResult.lat) && !Number.isNaN(lastPopularPlacesResult.lon)) {
                    lat = lastPopularPlacesResult.lat;
                    lon = lastPopularPlacesResult.lon;
                } else if (userMarker && typeof userMarker.getLatLng === 'function') {
                    const ll = userMarker.getLatLng();
                    lat = parseFloat(ll.lat);
                    lon = parseFloat(ll.lng);
                }
            }

            // Validation
            if (!bizType) {
                if (formMessage) { formMessage.textContent = 'Please select a Business Type.'; formMessage.className = 'form-message error'; }
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
                return;
            }
            if (!intensity) {
                if (formMessage) { formMessage.textContent = 'Please select a Crowd Intensity.'; formMessage.className = 'form-message error'; }
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
                return;
            }
            if (!lat || !lon) {
                if (formMessage) { formMessage.textContent = 'Please select a Business Location.'; formMessage.className = 'form-message error'; }
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
                return;
            }

            const hasCachedPlacesForSubmit = (
                lastPopularPlacesResult.places.length > 0 &&
                Math.abs((lastPopularPlacesResult.lat || 0) - lat) <= 0.01 &&
                Math.abs((lastPopularPlacesResult.lon || 0) - lon) <= 0.01
            );

            // Keep submit fast: do not refetch popular places here. If cache is stale/missing,
            // we still proceed using available crowd-zone data and center fallback.
            if (!hasCachedPlacesForSubmit && formMessage) {
                formMessage.textContent = 'Using current map analysis. For richer matches, pick location from suggestions first.';
                formMessage.className = 'form-message';
            }

            // Match behavior with feasibility flow: check first, then show ranked orange zones only if feasible.
            if (formMessage) { formMessage.textContent = 'Checking feasibility...'; formMessage.className = 'form-message'; }
            const feasData = await getFeasibilityWithCache(lat, lon, bizType || '');

            if (!feasData.success) {
                const errText = feasData.error || feasData.message || 'Could not check feasibility.';
                if (formMessage) { formMessage.textContent = errText; formMessage.className = 'form-message error'; }
                notifyChatFromMap('Feasibility check failed: ' + errText);
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
                return;
            }

            if (!feasData.feasible) {
                const msg = feasData.message || 'This business setup is not feasible for the selected location.';
                if (formMessage) { formMessage.textContent = msg; formMessage.className = 'form-message error'; }
                notifyChatFromMap(msg);
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
                return;
            }

            // Place orange markers for matching type + intensity
            const placesForRanking = hasCachedPlacesForSubmit ? lastPopularPlacesResult.places : [];
            placeOrangeMarkers(bizType, intensity, placesForRanking,
                lastPopularPlacesResult.lat || lat, lastPopularPlacesResult.lon || lon);

            // Close modal and show success
            if (formMessage) {
                formMessage.textContent = feasData.message || `Showing best ${bizType.replace(/_/g, ' ')} locations for ${intensity} crowd intensity.`;
                formMessage.className = 'form-message success';
            }
            notifyChatFromMap(feasData.message || `Feasible. Showing best matching zones for ${bizType}.`);
            setTimeout(() => {
                if (formModal) formModal.classList.remove('modal-open');
                if (formMessage) {
                    formMessage.textContent = '';
                    formMessage.className = 'form-message';
                }
            }, 2500);

            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
        });
    }

}

// Detect and set up the correct flow when the form modal opens
function _initFormFlow() {
    const formLocInput = document.getElementById('form-location-search');
    const bizSearch = document.getElementById('id_business_type_search');
    const hiddenBiz = document.getElementById('id_business_type');

    const hasLocation = lastPopularPlacesResult.places.length > 0;

    if (hasLocation) {
        // â”€â”€ FLOW B: Location already selected on map â”€â”€
        // Pre-fill location field (read-only)
        if (formLocInput) {
            formLocInput.value = 'Current map location (' +
                (lastPopularPlacesResult.lat || '').toString().substring(0, 7) + ', ' +
                (lastPopularPlacesResult.lon || '').toString().substring(0, 7) + ')';
            formLocInput.readOnly = true;
            formLocInput.style.opacity = '0.7';
            formLocInput.style.cursor = 'not-allowed';
        }
        // Set hidden lat/lon
        const latField = document.getElementById('id_latitude');
        const lonField = document.getElementById('id_longitude');
        if (latField) latField.value = lastPopularPlacesResult.lat;
        if (lonField) lonField.value = lastPopularPlacesResult.lon;

        // Populate business type from cached popular places
        populateBusinessTypeFromPopularPlaces(lastPopularPlacesResult.places);
        _setFlowHint('From your selected map location: ' + lastPopularPlacesResult.places.length + ' places nearby');
    } else {
        // â”€â”€ FLOW A: No location selected yet â”€â”€
        if (formLocInput) {
            formLocInput.value = '';
            formLocInput.readOnly = false;
            formLocInput.style.opacity = '1';
            formLocInput.style.cursor = 'text';
        }
        if (hiddenBiz) hiddenBiz.value = '';
        _allBusinessCategories = [];
        if (bizSearch) {
            bizSearch.value = '';
            bizSearch.disabled = true;
            bizSearch.placeholder = 'Search a location first to load types...';
        }
        _setFlowHint('Search a location above to load business types');
    }
}

// Update the hint text below the business type dropdown
function _setFlowHint(text) {
    const hint = document.getElementById('form-flow-hint');
    if (hint) hint.textContent = text;
}

// ========== Populate Business Type from Popular Places ==========

function populateBusinessTypeFromPopularPlaces(places) {
    const searchInput = document.getElementById('id_business_type_search');
    const suggestionsBox = document.getElementById('business-type-suggestions');
    const hiddenInput = document.getElementById('id_business_type');
    const hiddenSelect = document.getElementById('id_business_type_select');

    // Extract unique business categories from popular places tags
    const typeMap = new Map();
    (places || []).forEach(place => {
        const tags = place.tags || {};
        const type = tags.amenity || tags.shop || tags.tourism || tags.leisure;
        if (type && !typeMap.has(type)) {
            const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            typeMap.set(type, label);
        }
    });

    // Keep global autocomplete categories in sync with current location data.
    _allBusinessCategories = Array.from(typeMap.values())
        .sort((a, b) => a.localeCompare(b));

    if (hiddenInput) hiddenInput.value = '';
    if (hiddenSelect) hiddenSelect.value = '';
    if (recommendedBusinessHidden) recommendedBusinessHidden.value = '';
    if (suggestionsBox) suggestionsBox.style.display = 'none';

    if (typeMap.size === 0) {
        if (searchInput) {
            searchInput.value = '';
            searchInput.disabled = true;
            searchInput.placeholder = 'No business types found nearby';
        }
        return;
    }

    if (searchInput) {
        searchInput.disabled = false;
        searchInput.value = '';
        searchInput.placeholder = `Type to search ${_allBusinessCategories.length} business types...`;
    }
}

// ========== Place Orange Markers for Matching Business Type + Crowd Intensity ==========

function placeOrangeMarkers(businessType, crowdIntensity, places, centerLat, centerLon) {
    // Clear previous orange markers
    const activeMap = (typeof map !== 'undefined' && map) ? map : null;
    if (activeMap) {
        orangeMarkers.forEach(m => activeMap.removeLayer(m));
    }
    orangeMarkers = [];

    if (!activeMap) return;

    // Normalize intensity: 'moderate' maps to 'medium' in classifyCrowd
    let intensityNorm = (crowdIntensity === 'moderate' ? 'medium' : crowdIntensity || '').toLowerCase();
    const bizKey = String(businessType || '').trim().toLowerCase().replace(/\s+/g, '_');
    const allPlaces = Array.isArray(places) ? places : [];

    const orangeIcon = L.icon({
        iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-orange.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const intensityColors = { low: '#4CAF50', medium: '#FFC107', high: '#F44336' };
    const intensityLabels = { low: 'Low', medium: 'Moderate', high: 'High' };

    // Infer preferred crowd intensity from backend mapping when not explicitly selected.
    if (!intensityNorm && businessByIntensity && typeof businessByIntensity === 'object') {
        const order = ['low', 'medium', 'high'];
        intensityNorm = order.find(level => {
            const arr = businessByIntensity[level] || [];
            return arr.some(x => String(x).toLowerCase().replace(/\s+/g, '_') === bizKey);
        }) || '';
    }

    function haversineMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = deg => (deg * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function normalizeType(value) {
        return String(value || '').toLowerCase().replace(/\s+/g, '_').trim();
    }

    function placeTypeFor(place) {
        const tags = place.tags || {};
        return normalizeType(tags.amenity || tags.shop || tags.tourism || tags.leisure || '');
    }

    function coordsFor(place) {
        let pLat = place.lat;
        let pLon = place.lon;
        if (!pLat && place.center) { pLat = place.center.lat; pLon = place.center.lon; }
        if (!pLat || !pLon) return null;
        return { lat: parseFloat(pLat), lon: parseFloat(pLon) };
    }

    function typeMatches(place) {
        if (!bizKey) return false;
        const tags = place.tags || {};
        const pType = placeTypeFor(place);
        const pName = normalizeType(tags.name || '');
        if (!pType && !pName) return false;
        const bizToken = bizKey.split('_')[0] || bizKey;
        return pType === bizKey || pType.includes(bizKey) || bizKey.includes(pType) || pName.includes(bizToken);
    }

    // ML category match: compare selected intensity's recommended categories with place type/name.
    const mlCategorySet = new Set(
        ((businessByIntensity && intensityNorm && businessByIntensity[intensityNorm]) || [])
            .map(v => normalizeType(v))
            .filter(Boolean)
    );
    function mlMatches(place) {
        if (!mlCategorySet.size) return true; // if no ML map available, do not block.
        const tags = place.tags || {};
        const pType = placeTypeFor(place);
        const pName = normalizeType(tags.name || '');
        if (!pType && !pName) return false;
        for (const mlType of mlCategorySet) {
            const token = mlType.split('_')[0] || mlType;
            if (pType === mlType || pType.includes(mlType) || mlType.includes(pType) || pName.includes(token)) {
                return true;
            }
        }
        return false;
    }

    // Candidate popular places that match user-selected business and ML-recommended categories.
    const matchingPlaces = [];
    allPlaces.forEach(place => {
        if (!typeMatches(place)) return;
        if (!mlMatches(place)) return;
        const pt = coordsFor(place);
        if (!pt) return;
        const footfall = estimateBaseFootfall(place);
        const placeIntensity = classifyCrowd(footfall);
        if (intensityNorm && placeIntensity !== intensityNorm) return;
        matchingPlaces.push({
            place,
            lat: pt.lat,
            lon: pt.lon,
            placeIntensity,
            placeType: placeTypeFor(place),
        });
    });

    // Priority 1: place orange markers directly at matched place points (as requested).
    let matchCount = 0;
    if (matchingPlaces.length > 0) {
        matchingPlaces
            .sort((a, b) => {
                const da = (!Number.isNaN(centerLat) && !Number.isNaN(centerLon))
                    ? haversineMeters(parseFloat(centerLat), parseFloat(centerLon), a.lat, a.lon)
                    : 0;
                const db = (!Number.isNaN(centerLat) && !Number.isNaN(centerLon))
                    ? haversineMeters(parseFloat(centerLat), parseFloat(centerLon), b.lat, b.lon)
                    : 0;
                return da - db;
            })
            .slice(0, 10)
            .forEach(mp => {
                const tags = mp.place.tags || {};
                const name = tags.name || mp.placeType || 'Business';
                const typeLabel = (mp.placeType || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const crowdLabel = intensityLabels[mp.placeIntensity] || mp.placeIntensity;
                const color = intensityColors[mp.placeIntensity] || '#FFA500';
                const popupHtml = `
                    <div style="min-width:190px;">
                        <b>${name}</b><br>
                        <b>Category:</b> ${typeLabel}<br>
                        <b>Crowd:</b> ${crowdLabel}<br>
                        <small>Matched with selected business + ML category rules</small>
                        <div style="margin-top:4px;background:${color};height:6px;border-radius:999px;"></div>
                    </div>`;
                const marker = L.marker([mp.lat, mp.lon], { icon: orangeIcon })
                    .addTo(activeMap)
                    .bindPopup(popupHtml);
                orangeMarkers.push(marker);
                matchCount += 1;
            });
    }

    // Priority 2 fallback: rank crowd zones by nearby matching places.
    const zones = (lastCrowdIntensityData && lastCrowdIntensityData[intensityNorm]) || [];
    const zoneRadiusM = 900;
    const zoneCandidates = zones
        .map(zone => {
            const zLat = parseFloat(zone.latitude);
            const zLon = parseFloat(zone.longitude);
            if (Number.isNaN(zLat) || Number.isNaN(zLon)) return null;

            let nearbyMatchCount = 0;
            matchingPlaces.forEach(mp => {
                if (haversineMeters(zLat, zLon, mp.lat, mp.lon) <= zoneRadiusM) nearbyMatchCount += 1;
            });

            const baseCount = parseFloat(zone.count || 0) || 0;
            const centerDistance = (!Number.isNaN(centerLat) && !Number.isNaN(centerLon))
                ? haversineMeters(parseFloat(centerLat), parseFloat(centerLon), zLat, zLon)
                : 0;

            // Higher nearby business matches + higher crowd evidence wins.
            const score = (nearbyMatchCount * 1000) + baseCount - (centerDistance * 0.001);
            return { zone, zLat, zLon, nearbyMatchCount, baseCount, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    if (matchCount === 0) {
        const topZones = zoneCandidates.slice(0, 5);
        topZones.forEach((z, idx) => {
            const popupHtml = `
                <div style="min-width:200px;">
                    <b>Best Match Zone #${idx + 1}</b><br>
                    <b>Business:</b> ${(businessType || 'Business').replace(/_/g, ' ')}<br>
                    <b>Crowd:</b> ${(intensityLabels[intensityNorm] || intensityNorm || 'Any')}<br>
                    <b>Matched nearby places:</b> ${z.nearbyMatchCount}<br>
                    <b>Total POIs in zone:</b> ${Math.round(z.baseCount)}
                </div>`;
            const marker = L.marker([z.zLat, z.zLon], { icon: orangeIcon })
                .addTo(activeMap)
                .bindPopup(popupHtml);
            orangeMarkers.push(marker);
            matchCount += 1;
        });
    }

    // If no zone ranking available, fall back to top matching business places.
    if (matchCount === 0 && matchingPlaces.length > 0) {
        matchingPlaces.slice(0, 5).forEach(mp => {
            const tags = mp.place.tags || {};
            const name = tags.name || mp.placeType || 'Business';
            const typeLabel = (mp.placeType || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const crowdLabel = intensityLabels[mp.placeIntensity] || mp.placeIntensity;
            const color = intensityColors[mp.placeIntensity] || '#FFA500';
            const popupHtml = `
                <div style="min-width:180px;">
                    <b style="font-size:1rem;">${name}</b><br>
                    <span style="color:#666;font-size:0.85rem;">${typeLabel}</span><br>
                    <span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.8rem;font-weight:700;display:inline-block;margin-top:4px;">${crowdLabel} Crowd</span>
                </div>`;
            const marker = L.marker([mp.lat, mp.lon], { icon: orangeIcon })
                .addTo(activeMap)
                .bindPopup(popupHtml);
            orangeMarkers.push(marker);
            matchCount += 1;
        });
    }

    // Last-resort fallback only if we have absolutely no map data to rank.
    if (matchCount === 0 && !Number.isNaN(parseFloat(centerLat)) && !Number.isNaN(parseFloat(centerLon))) {
        const marker = L.marker([parseFloat(centerLat), parseFloat(centerLon)], { icon: orangeIcon })
            .addTo(activeMap)
            .bindPopup('<b>No ranked zones found for this combination here yet.</b>');
        orangeMarkers.push(marker);
        matchCount = 1;
    }

    if (typeof showHeatmapToast === 'function') {
        const typeLabel = String(businessType || 'business').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const intensityLabel = (intensityNorm || crowdIntensity || 'any').charAt(0).toUpperCase() + (intensityNorm || crowdIntensity || 'any').slice(1);
        if (matchCount > 0) {
            showHeatmapToast(`Found ${matchCount} best matching spot(s) for ${typeLabel} (${intensityLabel} crowd).`, 'success');
        } else {
            showHeatmapToast(`No matches for "${typeLabel}" and "${intensityLabel}" crowd. Try another intensity or location.`, 'error');
        }
    }

    // If we have matches, fit map to show them all
    if (matchCount > 0 && activeMap) {
        try {
            const group = L.featureGroup(orangeMarkers);
            activeMap.fitBounds(group.getBounds().pad(0.2));
        } catch (e) {
            // fallback: just center on the search location
            if (centerLat && centerLon) activeMap.setView([centerLat, centerLon], 14);
        }
    }
}




