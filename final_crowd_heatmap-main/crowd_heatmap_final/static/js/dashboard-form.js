// ========== Dashboard Startup Form Functionality ==========

function initDashboardStartupForm() {
    // Location search autocomplete for dashboard form
    const formLocInput = document.getElementById('dashboard-form-location-search');
    const formLocSuggestions = document.getElementById('dashboard-form-location-suggestions');

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
                    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1&countrycodes=in`);
                    const results = await response.json();

                    if (!results || results.length === 0) {
                        formLocSuggestions.innerHTML = '<div class="list-group-item text-muted">No results found</div>';
                        formLocSuggestions.style.display = 'block';
                        return;
                    }

                    formLocSuggestions.innerHTML = '';
                    results.forEach(result => {
                        const item = document.createElement('div');
                        item.className = 'list-group-item list-group-item-action';
                        item.style.cursor = 'pointer';

                        const displayName = result.display_name || result.name;
                        item.textContent = displayName;

                        item.addEventListener('click', () => {
                            formLocInput.value = displayName;
                            formLocSuggestions.innerHTML = '';
                            formLocSuggestions.style.display = 'none';

                            // Store coordinates
                            const lat = parseFloat(result.lat);
                            const lon = parseFloat(result.lon);
                            document.getElementById('dashboard-id_latitude').value = lat;
                            document.getElementById('dashboard-id_longitude').value = lon;

                            // Load business types for this location
                            loadBusinessTypesForLocation(lat, lon);
                        });

                        formLocSuggestions.appendChild(item);
                    });
                    formLocSuggestions.style.display = 'block';
                } catch (error) {
                    console.error('Location search failed:', error);
                }
            }, 300);
        });

        // Close suggestions when clicking outside
        document.addEventListener('click', function (e) {
            if (!formLocInput.contains(e.target) && !formLocSuggestions.contains(e.target)) {
                formLocSuggestions.style.display = 'none';
            }
        });
    }

    // Form submission
    const form = document.getElementById('dashboard-business-form');
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            const formData = new FormData(form);
            const submitBtn = document.getElementById('dashboard-submit-business-form-btn');
            const messageDiv = document.getElementById('dashboard-form-message');
            const resultBanner = document.getElementById('dashboard-feasibility-result-banner');

            // Show loading state
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';
            messageDiv.innerHTML = '';
            resultBanner.classList.add('d-none');

            try {
                const response = await fetch('/submit-form/', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'X-CSRFToken': formData.get('csrfmiddlewaretoken')
                    }
                });

                const data = await response.json();

                if (data.success) {
                    // Show success message
                    messageDiv.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i>${data.message}</div>`;

                    // Show feasibility result if available
                    if (data.feasibility) {
                        resultBanner.classList.remove('d-none');
                        resultBanner.className = `alert alert-${data.feasibility.viable ? 'success' : 'warning'}`;
                        resultBanner.innerHTML = `
                            <strong>Feasibility Analysis:</strong> ${data.feasibility.analysis}
                            ${data.feasibility.score ? `<br>Score: ${data.feasibility.score}/100` : ''}
                        `;
                    }

                    // Fetch matching locations for the map
                    const lat = document.getElementById('dashboard-id_latitude').value;
                    const lon = document.getElementById('dashboard-id_longitude').value;
                    const businessType = document.getElementById('dashboard-id_business_type_dropdown').value;
                    const crowdIntensity = document.getElementById('dashboard-id_crowd_intensity').value;

                    try {
                        const matchRes = await fetch('/api/find-matching-locations/', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRFToken': formData.get('csrfmiddlewaretoken')
                            },
                            body: JSON.stringify({
                                latitude: lat,
                                longitude: lon,
                                business_type: businessType,
                                crowd_intensity: crowdIntensity
                            })
                        });
                        const matchData = await matchRes.json();

                        if (matchData.success && matchData.matches && matchData.matches.length > 0) {
                            // Delay briefly for user to read success message, then redirect to Map
                            setTimeout(async () => {
                                // Hide form and launchpad, show map
                                document.getElementById('dashboard-startup-form-section').classList.add('d-none');
                                document.getElementById('dashboard-launchpad').classList.add('d-none');
                                const mapContainer = document.getElementById('dynamic-map-container');
                                mapContainer.classList.remove('d-none');

                                // Reset form
                                form.reset();
                                document.getElementById('dashboard-id_business_type_dropdown').innerHTML = '<option value="">-- Search a location first --</option>';
                                resultBanner.classList.add('d-none');
                                messageDiv.innerHTML = '';

                                // Initialize map if not ready yet
                                if (typeof initDynamicDashboardMap === 'function') {
                                    initDynamicDashboardMap();
                                }

                                // Wait a tick for map DOM to settle after being shown
                                await new Promise(r => setTimeout(r, 300));

                                // Force-sync global `map` to dashboardMap so all heatmap functions draw here
                                if (typeof dashboardMap !== 'undefined' && dashboardMap) {
                                    window.map = dashboardMap;
                                    dashboardMap.invalidateSize();
                                }

                                if (typeof dashboardMap === 'undefined' || !dashboardMap) return;

                                // Clear old orange markers
                                if (Array.isArray(window.orangeMarkers)) {
                                    window.orangeMarkers.forEach(m => dashboardMap.removeLayer(m));
                                }
                                window.orangeMarkers = [];

                                // Add new orange markers
                                const orangeIcon = L.icon({
                                    iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-orange.png',
                                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
                                    iconSize: [25, 41],
                                    iconAnchor: [12, 41],
                                    popupAnchor: [1, -34],
                                    shadowSize: [41, 41]
                                });

                                matchData.matches.forEach((loc, idx) => {
                                    const latLng = [loc.lat, loc.lon];
                                    const marker = L.marker(latLng, { icon: orangeIcon }).addTo(dashboardMap)
                                        .bindPopup(`<b>Potential Location ${idx + 1}</b><br>Suitable for ${loc.business.replace(/_/g, ' ').toUpperCase()}<br>Crowd: ${loc.intensity.toUpperCase()}`);
                                    window.orangeMarkers.push(marker);
                                });

                                // Use first match as epicenter for popular places
                                const targetLat = matchData.matches[0].lat;
                                const targetLon = matchData.matches[0].lon;

                                // Open first popup
                                if (window.orangeMarkers.length > 0) {
                                    window.orangeMarkers[0].openPopup();
                                }

                                // Fly to the marker location — then draw heatmap AFTER animation ends
                                dashboardMap.once('moveend', async () => {
                                    // Re-sync map after flyTo (prevents geolocation override from winning)
                                    window.map = dashboardMap;

                                    // Now trigger popular places + crowd intensity heatmap from orange marker epicenter
                                    if (typeof findPopularPlaces === 'function') {
                                        try {
                                            await findPopularPlaces(targetLat, targetLon, false);
                                        } catch (err) {
                                            console.error('Error fetching popular places:', err);
                                        }
                                    }
                                });

                                // Start the flyTo animation (will trigger moveend above when done)
                                dashboardMap.flyTo([targetLat, targetLon], 14, {
                                    animate: true,
                                    duration: 1.5
                                });

                            }, 1500);
                        }
                    } catch (e) {
                        console.error('Error fetching matching locations:', e);
                        setTimeout(() => {
                            form.reset();
                            document.getElementById('dashboard-id_business_type_dropdown').innerHTML = '<option value="">-- Search a location first --</option>';
                            resultBanner.classList.add('d-none');
                        }, 3000);
                    }
                } else {
                    // Show error message
                    messageDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>${data.message || 'Submission failed. Please try again.'}</div>`;
                }
            } catch (error) {
                console.error('Form submission error:', error);
                messageDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle me-2"></i>Network error. Please try again.</div>';
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-check-circle me-2"></i>Check Feasibility & Submit';
            }
        });
    }

    // Reset button
    const resetBtn = document.getElementById('dashboard-reset-business-form-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', function () {
            const form = document.getElementById('dashboard-business-form');
            if (form) {
                form.reset();
                document.getElementById('dashboard-id_business_type_dropdown').innerHTML = '<option value="">-- Search a location first --</option>';
                document.getElementById('dashboard-form-message').innerHTML = '';
                document.getElementById('dashboard-feasibility-result-banner').classList.add('d-none');
                document.getElementById('dashboard-id_latitude').value = '';
                document.getElementById('dashboard-id_longitude').value = '';
            }
        });
    }
}

// Load business types based on location
async function loadBusinessTypesForLocation(lat, lon) {
    const dropdown = document.getElementById('dashboard-id_business_type_dropdown');
    const hint = document.getElementById('dashboard-form-flow-hint');

    if (!dropdown) return;

    try {
        const response = await fetch(`/api/business-types/?lat=${lat}&lon=${lon}`);
        const data = await response.json();

        if (data.business_types && data.business_types.length > 0) {
            dropdown.innerHTML = '<option value="">-- Select business type --</option>';
            data.business_types.forEach(type => {
                const option = document.createElement('option');
                option.value = type.value || type;
                option.textContent = type.label || type;
                dropdown.appendChild(option);
            });

            if (hint) {
                hint.innerHTML = '<i class="fas fa-check-circle me-1 text-success"></i>Business types loaded for this location.';
            }
        } else {
            dropdown.innerHTML = '<option value="">-- No business types available --</option>';
        }
    } catch (error) {
        console.error('Failed to load business types:', error);
        dropdown.innerHTML = '<option value="">-- Failed to load business types --</option>';
    }
}
