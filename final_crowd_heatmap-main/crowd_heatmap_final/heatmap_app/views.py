from pathlib import Path

# Load ML model, feature columns, and per-intensity business options at module load
_MODEL_DIR = Path(__file__).resolve().parent.parent / 'crowd_heatmap_project'
_MODEL_PATH = _MODEL_DIR / 'business_model.pkl'
_DATASET_PATH = _MODEL_DIR / 'business_dataset.csv'

_model = None
_feature_columns = None
_business_choices_by_intensity = {}
# Reset on module reload to pick up retrained model
_model = None


def _load_model():
    """
    Lazy-load model, expected feature columns, and business choices per
    crowd intensity (derived from the CSV used to train the model).
    """
    global _model, _feature_columns, _business_choices_by_intensity

    if _model is None:
        import pickle
        import pandas as pd
        with open(_MODEL_PATH, 'rb') as f:
            _model = pickle.load(f)

        # Get expected columns from training data (for get_dummies alignment)
        df = pd.read_csv(_DATASET_PATH)
        X = df[['crowd', 'shops', 'area']]
        X_dummies = pd.get_dummies(X)
        _feature_columns = X_dummies.columns.tolist()

        # Build a lookup of available businesses per intensity level,
        # e.g. {"high": ["cafe", "restaurant", ...], ...}
        _business_choices_by_intensity = (
            df.groupby('crowd')['business']
            .apply(lambda s: sorted(set(s.dropna())))
            .to_dict()
        )

    return _model, _feature_columns


def get_business_choices_for_intensity(intensity: str):
    """
    Return a list of business names from the CSV for the given intensity.
    Falls back to all known businesses if the intensity key is missing.
    """
    # Ensure model/dataset are initialized so the mapping is built
    _load_model()

    normalized = (intensity or '').strip().lower()
    if not normalized:
        normalized = 'low'

    choices = _business_choices_by_intensity.get(normalized)
    if choices:
        return choices

    # Fallback: flatten all unique businesses if specific intensity not found
    all_unique = set()
    for items in _business_choices_by_intensity.values():
        all_unique.update(items)
    return sorted(all_unique)


def get_all_business_choices():
    """
    Return the entire mapping {intensity: [business, ...]} derived from
    the training CSV so the frontend can stay in sync dynamically.
    """
    _load_model()
    # Shallow copy to avoid accidental mutation from callers
    return {k: list(v) for k, v in _business_choices_by_intensity.items()}


# Intensity mapping: intensity -> list of (shops, area) variants from dataset for variety
_INTENSITY_VARIANTS = {
    'high': [('high', 'commercial'), ('high', 'market'), ('medium', 'college'), ('high', 'mall'), ('medium', 'office')],
    'medium': [('medium', 'residential'), ('medium', 'commercial'), ('low', 'residential'), ('medium', 'city_center')],
    'low': [('low', 'outskirts'), ('low', 'industrial'), ('low', 'village'), ('low', 'storage')],
}


def _infer_area_from_pois(elements):
    """Infer area type from POI tags to vary ML prediction by location."""
    type_counts = {}
    for el in (elements or []):
        tags = el.get('tags') or {}
        t = tags.get('amenity') or tags.get('shop') or tags.get('tourism') or ''
        if t:
            type_counts[t] = type_counts.get(t, 0) + 1
    if not type_counts:
        return None
    # Map POI types to dataset area values
    if type_counts.get('restaurant', 0) + type_counts.get('cafe', 0) + type_counts.get('fast_food', 0) > 3:
        return 'commercial'
    if type_counts.get('school', 0) + type_counts.get('college', 0) + type_counts.get('university', 0) > 1:
        return 'college'
    if type_counts.get('hospital', 0) + type_counts.get('pharmacy', 0) > 1:
        return 'residential'
    if type_counts.get('mall', 0) or type_counts.get('market', 0):
        return 'market' if type_counts.get('market', 0) else 'mall'
    if type_counts.get('place_of_worship', 0) + type_counts.get('community_centre', 0) > 2:
        return 'residential'
    return None


def predict_business(intensity, area_hint=None):
    """
    Predict best business type based on crowd intensity and optional area hint.
    Uses area_hint to pick a (shops, area) variant so predictions vary by location.
    """
    intensity = (intensity or 'low').strip().lower()
    variants = _INTENSITY_VARIANTS.get(intensity, _INTENSITY_VARIANTS['low'])
    # If we have an area hint, try to use a variant that matches or fall back to first
    shops, area = variants[0]
    if area_hint:
        area_lower = area_hint.strip().lower()
        for s, a in variants:
            if a == area_lower:
                shops, area = s, a
                break
    crowd = intensity
    import pandas as pd
    data = pd.DataFrame([[crowd, shops, area]], columns=['crowd', 'shops', 'area'])
    data = pd.get_dummies(data)
    model, feature_columns = _load_model()
    data = data.reindex(columns=feature_columns, fill_value=0)
    prediction = model.predict(data)
    return str(prediction[0])





from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.urls import reverse
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.contrib import messages
import json
import math
import requests
from .forms import BusinessUserForm, ContactForm
from .models import BusinessUser, ContactMessage
from .consumers import get_bot_response
from . import utils


# Shared Overpass helper so we can gracefully handle temporary failures /
# HTML responses and try secondary endpoints before failing.
_OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/cgi/interpreter",
]


from django.core.cache import cache
import hashlib

def _run_overpass_query(query: str, timeout: int = 30):
    """
    Try one or more Overpass API endpoints and return parsed JSON data.
    Returns (data, error_message). On success, error_message is None.
    Uses Django's cache to prevent Overpass rate limits (Too Many Requests).
    """
    # 1. Check cache first
    query_hash = hashlib.md5(query.encode('utf-8')).hexdigest()
    cache_key = f"overpass_{query_hash}"
    cached_data = cache.get(cache_key)
    if cached_data:
        return cached_data, None

    # 2. If not cached, fetch from Overpass
    last_error = None
    headers = {'User-Agent': 'CrowdHeatmapApp/1.0 (Django)'}
    for url in _OVERPASS_URLS:
        try:
            response = requests.post(
                url, data={"data": query}, headers=headers, timeout=timeout
            )
            response.raise_for_status()
            data = response.json()
            # Overpass can return error in 'remark' key
            if isinstance(data, dict) and data.get('remark'):
                last_error = data.get('remark', 'Overpass API error')
                continue
            
            # Cache the successful result for 15 minutes
            cache.set(cache_key, data, timeout=900)
            return data, None
        except requests.exceptions.Timeout:
            last_error = 'Overpass API timeout. Please try again in a moment.'
        except requests.exceptions.RequestException as exc:
            last_error = str(exc)
        except (ValueError, KeyError) as exc:
            last_error = f'Invalid Overpass response: {exc}'
            
    return None, last_error

@login_required
def home(request):
    """Main page with map and controls (login required)."""
    return render(request, 'heatmap_app/home.html')

def contact_us(request):
    """Contact Us page view."""
    if request.method == 'POST':
        form = ContactForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, 'Your message has been sent successfully!')
            return redirect('contact_us')
        else:
            messages.error(request, 'There was an error with your submission. Please check the form.')
    else:
        form = ContactForm()
    
    return render(request, 'heatmap_app/contact.html', {'form': form})


@login_required
def dashboard(request):
    """Dashboard analytics view (login required)."""
    return render(request, 'heatmap_app/dashboard.html')


@csrf_exempt
@require_http_methods(['POST'])
def report_user_location(request):
    """
    Receive user's current location (from browser geolocation or IP fallback).
    POST body: { "latitude": float, "longitude": float, "accuracy": int (optional), "source": "gps"|"ip" (optional) }
    Returns JSON: { "success": bool, "message": str }. Coordinates can be used for map/heatmap server-side if needed.
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
    accuracy = data.get('accuracy')
    # Optional: store in session for server-side use, e.g. request.session['user_lat'], request.session['user_lon']
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


@csrf_exempt
@require_http_methods(['POST'])
def chat_message(request):
    """HTTP fallback for chatbot when WebSocket is not available."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'})
    user_message = (data.get('message') or '').strip()
    if not user_message:
        return JsonResponse({'success': False, 'message': 'Message is required'})
    reply = get_bot_response(user_message)
    return JsonResponse({'success': True, 'message': reply})

def submit_form(request):
    """Handle form submission"""
    if request.method == 'POST':
        form = BusinessUserForm(request.POST)
        if form.is_valid():
            form.save()
            return JsonResponse({'success': True, 'message': 'Form submitted successfully!'})
        else:
            # Flatten errors into a readable message
            error_parts = []
            for field, errs in form.errors.items():
                label = field.replace('_', ' ').title()
                error_parts.append(f"{label}: {', '.join(errs)}")
            error_msg = ' | '.join(error_parts) if error_parts else 'Please check the form fields.'
            return JsonResponse({'success': False, 'message': error_msg, 'errors': form.errors})
    return JsonResponse({'success': False, 'message': 'Invalid request method'})

@csrf_exempt
def search_location(request):
    """Search for locations using Nominatim API (OpenStreetMap)"""
    if request.method == 'POST':
        data = json.loads(request.body)
        query = data.get('query', '')
        
        # Call Nominatim API for location search (India-only)
        try:
            url = "https://nominatim.openstreetmap.org/search"
            headers = {'User-Agent': 'CrowdHeatmapApp/1.0'}
            params = {
                "q": query,
                "format": "json",
                "limit": 5,
                "addressdetails": 1,
                "countrycodes": "in",
                # India bounding box: left,top,right,bottom
                "viewbox": "68,37.5,97.5,6.5",
                "bounded": 1,
            }
            response = requests.get(url, headers=headers, params=params)
            results = response.json()
            return JsonResponse({'success': True, 'results': results})
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)})
    
    return JsonResponse({'success': False, 'message': 'Invalid request method'})


@csrf_exempt
def autocomplete_location(request):
    """Return lightweight suggestions for location autocomplete."""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'success': False, 'message': 'Invalid JSON'})

        query = (data.get('query') or '').strip()
        if not query:
            return JsonResponse({'success': True, 'results': []})

        try:
            url = "https://nominatim.openstreetmap.org/search"
            headers = {'User-Agent': 'CrowdHeatmapApp/1.0'}
            params = {
                "q": query,
                "format": "json",
                "limit": 5,
                "addressdetails": 1,
                "countrycodes": "in",
                # India bounding box: left,top,right,bottom
                "viewbox": "68,37.5,97.5,6.5",
                "bounded": 1,
            }
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            raw_results = response.json()

            suggestions = []
            for r in raw_results:
                suggestions.append({
                    "display_name": r.get("display_name"),
                    "lat": r.get("lat"),
                    "lon": r.get("lon"),
                })

            return JsonResponse({'success': True, 'results': suggestions})
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)})

    return JsonResponse({'success': False, 'message': 'Invalid request method'})

@csrf_exempt
@require_http_methods(['POST'])
def find_popular_places(request):
    """Find popular places within 5km radius using Overpass API."""
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)

    lat = data.get('latitude')
    lon = data.get('longitude')
    if lat is None or lon is None:
        return JsonResponse({
            'success': False,
            'error': 'Latitude and longitude are required'
        }, status=400)
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'error': 'Invalid coordinates'}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return JsonResponse({'success': False, 'error': 'Coordinates out of range'}, status=400)

    # Overpass query: nodes and ways with amenity within 5km
    query = f"""[out:json][timeout:25];
(
  node["amenity"](around:5000,{lat},{lon});
  way["amenity"](around:5000,{lat},{lon});
);
out center;
"""
    results, error = _run_overpass_query(query, timeout=30)
    if error or results is None:
        return JsonResponse({
            'success': False,
            'error': error or 'Unable to fetch popular places. Please try again.'
        })
    elements = results.get('elements', [])
    
    # --- PER-PLACE REVENUE CALCULATION ---
    enriched_places, total_area_revenue = utils.enrich_places_with_revenue(elements)
    
    return JsonResponse({
        'success': True, 
        'results': enriched_places,
        'total_area_revenue': total_area_revenue
    })

@csrf_exempt
def analyze_crowd_intensity(request):
    """Analyze crowd intensity in 5km radius and return high/medium/low areas"""
    if request.method == 'POST':
        data = json.loads(request.body)
        lat = data.get('latitude')
        lon = data.get('longitude')
        
        if not lat or not lon:
            return JsonResponse({'success': False, 'message': 'Latitude and longitude are required'})
        
        try:
            # Use Overpass API to find amenities and POIs within 5km radius
            query = f"""
            [out:json][bbox:6.5,68.0,37.5,97.5];
            (
              node["amenity"](around:5000,{lat},{lon});
              way["amenity"](around:5000,{lat},{lon});
              relation["amenity"](around:5000,{lat},{lon});
              node["shop"](around:5000,{lat},{lon});
              way["shop"](around:5000,{lat},{lon});
              node["tourism"](around:5000,{lat},{lon});
              way["tourism"](around:5000,{lat},{lon});
            );
            out center;
            """
            results, error = _run_overpass_query(query, timeout=30)
            if error or results is None:
                return JsonResponse({'success': False, 'error': error or 'Unable to analyze crowd intensity'})

            elements = results.get('elements', [])
            
            # Calculate density by dividing area into sectors
            # High intensity: > 15 POIs per sector
            # Medium intensity: 5-15 POIs per sector
            # Low intensity: < 5 POIs per sector
            
            # Divide 5km radius into 9 sectors (3x3 grid)
            sector_size = 5000 / 3  # ~1.67km per sector
            sectors = {}
            
            for element in elements:
                elem_lat = element.get('lat') or (element.get('center', {}).get('lat'))
                elem_lon = element.get('lon') or (element.get('center', {}).get('lon'))
                
                if not elem_lat or not elem_lon:
                    continue
                
                # Calculate distance from center
                R = 6371000  # Earth radius in meters
                lat1_rad = math.radians(lat)
                lat2_rad = math.radians(elem_lat)
                delta_lat = math.radians(elem_lat - lat)
                delta_lon = math.radians(elem_lon - lon)
                
                a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
                c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
                distance = R * c
                
                if distance > 5000:
                    continue
                
                # Determine sector (0-8)
                angle = math.atan2(elem_lat - lat, elem_lon - lon)
                angle_deg = math.degrees(angle) + 180  # 0-360
                
                # Sector based on angle and distance
                angle_sector = int(angle_deg / 120)  # 0-2
                dist_sector = int(distance / sector_size)  # 0-2
                sector_key = f"{dist_sector}_{angle_sector}"
                
                if sector_key not in sectors:
                    sectors[sector_key] = []
                sectors[sector_key].append({
                    'lat': elem_lat,
                    'lon': elem_lon,
                    'name': element.get('tags', {}).get('name', 'Unknown'),
                    'type': element.get('tags', {}).get('amenity') or element.get('tags', {}).get('shop') or element.get('tags', {}).get('tourism', 'Unknown')
                })
            
            # Classify sectors by intensity
            high_intensity_areas = []
            medium_intensity_areas = []
            low_intensity_areas = []
            
            for sector_key, pois in sectors.items():
                count = len(pois)
                # Calculate center of sector
                avg_lat = sum(p['lat'] for p in pois) / count
                avg_lon = sum(p['lon'] for p in pois) / count
                
                if count >= 15:
                    high_intensity_areas.append({
                        'latitude': avg_lat,
                        'longitude': avg_lon,
                        'count': count,
                        'sector': sector_key
                    })
                elif count >= 5:
                    medium_intensity_areas.append({
                        'latitude': avg_lat,
                        'longitude': avg_lon,
                        'count': count,
                        'sector': sector_key
                    })
                else:
                    low_intensity_areas.append({
                        'latitude': avg_lat,
                        'longitude': avg_lon,
                        'count': count,
                        'sector': sector_key
                    })
            
            # If no sectors found, create default areas based on distance
            if not high_intensity_areas and not medium_intensity_areas and not low_intensity_areas:
                # Create default areas at different distances
                high_intensity_areas = [{'latitude': lat, 'longitude': lon, 'count': len(elements), 'sector': 'center'}]
                medium_intensity_areas = []
                low_intensity_areas = []

            # ML business prediction based on dominant intensity (location-aware)
            dominant = 'low'
            if high_intensity_areas:
                dominant = 'high'
            elif medium_intensity_areas:
                dominant = 'medium'

            area_hint = _infer_area_from_pois(elements)
            business_prediction = None
            try:
                primary = predict_business(dominant, area_hint=area_hint)
                # Business options sourced directly from the CSV
                csv_choices = get_business_choices_for_intensity(dominant)
                alternatives = []
                for alt_level in ['high', 'medium', 'low']:
                    if alt_level != dominant:
                        alt_biz = predict_business(alt_level)
                        if alt_biz and alt_biz != primary and alt_biz not in [a['business'] for a in alternatives]:
                            alternatives.append({'business': alt_biz, 'intensity': alt_level})

                reasoning = {
                    'high': 'High foot traffic in commercial area — ideal for food, retail, and services.',
                    'medium': 'Moderate crowd in residential area — good for essentials like grocery, pharmacy.',
                    'low': 'Low traffic in outskirts — suited for storage, warehouse, or niche ventures.',
                }.get(dominant, '')

                best_times = {
                    'high': 'Peak hours 10am–8pm. Morning (6–10am) has lower competition.',
                    'medium': 'Steady flow 9am–7pm. Evening slightly busier.',
                    'low': 'Flexible timing. Consider proximity to transport for visibility.',
                }.get(dominant, '')

                business_prediction = {
                    'primary': primary,
                    'reasoning': reasoning,
                    'alternatives': alternatives[:2],
                    'best_times': best_times,
                    'choices': csv_choices,
                    'intensity': dominant,
                }
            except Exception:
                pass  # Heatmap still works; frontend handles null

            return JsonResponse({
                'success': True,
                'high_intensity': high_intensity_areas,
                'medium_intensity': medium_intensity_areas,
                'low_intensity': low_intensity_areas,
                'total_pois': len(elements),
                'business_prediction': business_prediction,
                # Full per-intensity business mapping so the frontend
                # can show dynamic suggestions everywhere.
                'business_by_intensity': get_all_business_choices(),
                
                # REVENUE PREDICTION
                'crowd_score': utils.calculate_crowd_score(elements),
                'estimated_revenue': utils.predict_revenue(utils.calculate_crowd_score(elements)),
            })
            
        except Exception as e:
            import traceback
            return JsonResponse({'success': False, 'error': str(e), 'traceback': traceback.format_exc()})
    
    return JsonResponse({'success': False, 'message': 'Invalid request method'})


@csrf_exempt
def check_feasibility(request):
    """
    Check if a business type is feasible at the given location based on crowd intensity.
    POST: { latitude, longitude, business_type (optional) }
    Returns: { success, feasible, dominant_intensity, message, latitude, longitude }
    """
    if request.method != 'POST':
        return JsonResponse({'success': False, 'message': 'Invalid request method'})
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'})
    lat = data.get('latitude')
    lon = data.get('longitude')
    business_type = (data.get('business_type') or '').strip()
    if not lat or not lon:
        return JsonResponse({'success': False, 'message': 'Latitude and longitude are required'})
    try:
        query = f"""
        [out:json][bbox:6.5,68.0,37.5,97.5];
        (
          node["amenity"](around:5000,{lat},{lon});
          way["amenity"](around:5000,{lat},{lon});
          relation["amenity"](around:5000,{lat},{lon});
          node["shop"](around:5000,{lat},{lon});
          way["shop"](around:5000,{lat},{lon});
          node["tourism"](around:5000,{lat},{lon});
          way["tourism"](around:5000,{lat},{lon});
        );
        out center;
        """
        results, error = _run_overpass_query(query, timeout=30)
        if error or results is None:
            return JsonResponse({'success': False, 'error': error or 'Unable to analyze location'})
        elements = results.get('elements', [])
        sector_size = 5000 / 3
        sectors = {}
        for element in elements:
            elem_lat = element.get('lat') or (element.get('center', {}).get('lat'))
            elem_lon = element.get('lon') or (element.get('center', {}).get('lon'))
            if not elem_lat or not elem_lon:
                continue
            R = 6371000
            lat1_rad = math.radians(lat)
            lat2_rad = math.radians(elem_lat)
            delta_lat = math.radians(elem_lat - lat)
            delta_lon = math.radians(elem_lon - lon)
            a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
            distance = R * c
            if distance > 5000:
                continue
            angle = math.atan2(elem_lat - lat, elem_lon - lon)
            angle_deg = math.degrees(angle) + 180
            angle_sector = int(angle_deg / 120)
            dist_sector = int(distance / sector_size)
            sector_key = f"{dist_sector}_{angle_sector}"
            if sector_key not in sectors:
                sectors[sector_key] = []
            sectors[sector_key].append({'lat': elem_lat, 'lon': elem_lon})
        # --- DYNAMIC FEASIBILITY CORRECTION ---
        # 1. Prepare candidate types (synonyms + normalization)
        biz_normalized = business_type.lower().replace(' ', '_').strip()
        if biz_normalized.endswith('_business'):
            biz_normalized = biz_normalized[:-9]
        
        # Mapping common synonyms to dataset categories
        synonym_map = {
            'grocery_shop': 'supermarket',
            'grocery': 'supermarket',
            'medical_store': 'pharmacy',
            'chemist': 'pharmacy',
            'pub': 'restaurant',
            'bar': 'restaurant',
            'coffee_shop': 'cafe',
            'book_shop': 'book_store',
            'cloth_store': 'clothing_store',
            'garments': 'clothing_store',
        }
        search_target = synonym_map.get(biz_normalized, biz_normalized)
        
        # 2. Check actual POI frequency in the area to provide "Dynamic Evidence"
        # If the area already has many of these businesses, it's proven to be a feasible location.
        found_count = 0
        for element in elements:
            tags = element.get('tags', {})
            # Check amenity, shop, or name for the business type
            poi_type = (tags.get('amenity') or tags.get('shop') or tags.get('tourism') or '').lower()
            poi_name = tags.get('name', '').lower()
            if biz_normalized in poi_type or search_target in poi_type or biz_normalized in poi_name:
                found_count += 1

        high_c, medium_c, low_c = 0, 0, 0
        for pois in sectors.values():
            count = len(pois)
            if count >= 15:
                high_c += 1
            elif count >= 5:
                medium_c += 1
            else:
                low_c += 1
        
        dominant = 'low'
        if high_c > 0:
            dominant = 'high'
        elif medium_c > 0:
            dominant = 'medium'
            
        allowed_businesses = [b.lower().replace(' ', '_') for b in get_business_choices_for_intensity(dominant)]
        recommended_primary = predict_business(dominant, _infer_area_from_pois(elements)).lower().replace(' ', '_')

        if business_type:
            # 3. Final Feasibility Decision (Permissive)
            # Feasible if: 
            # - Matches CSV intensity list
            # - Matches ML primary recommendation
            # - Many similar businesses already exist in the area (dynamic proof)
            # - High intensity areas are generally feasible for most services
            
            is_in_dataset = (biz_normalized in allowed_businesses or search_target in allowed_businesses)
            is_recommended = (biz_normalized == recommended_primary or search_target == recommended_primary)
            has_local_proof = (found_count >= 2) # If at least 2 exist, it's definitely feasible
            
            feasible = is_in_dataset or is_recommended or has_local_proof
            
            # Bonus: High intensity is feasible for almost anything retail/food
            if not feasible and dominant == 'high' and ('shop' in biz_normalized or 'store' in biz_normalized or 'food' in biz_normalized):
                feasible = True
            
            if feasible:
                if has_local_proof:
                    message = f'✅ Feasible: We found {found_count} similar businesses in the area, confirming this is a strong location for a "{business_type}".'
                else:
                    message = f'✅ Feasible: A "{business_type}" matches the {dominant} crowd profile and development level of this area.'
            else:
                message = f'❌ Not feasible: The area currently has {dominant} intensity and low indicators for "{business_type}". Consider a {recommended_primary.replace("_", " ")} instead.'
        else:
            feasible = True
            message = f'Location analyzed. Dominant crowd intensity is {dominant}. We recommend starting a {recommended_primary.replace("_", " ")} here.'
        return JsonResponse({
            'success': True,
            'feasible': feasible,
            'dominant_intensity': dominant,
            'message': message,
            'latitude': lat,
            'longitude': lon,
            'recommended_business': recommended_primary,
        })
    except Exception as e:
        import traceback
        return JsonResponse({'success': False, 'error': str(e), 'traceback': traceback.format_exc()})
def business_recommendations(request):
    # Keep legacy route but serve the dashboard AI flow directly so the
    # sidebar button always opens live recommendation data.
    return redirect(f"{reverse('dashboard')}?ai=true")


def _extract_coordinates(payload):
    lat = payload.get('latitude')
    lon = payload.get('longitude')
    if lat is None and payload.get('lat') is not None:
        lat = payload.get('lat')
    if lon is None and payload.get('lng') is not None:
        lon = payload.get('lng')
    if lat is None or lon is None:
        raise ValueError('Latitude and longitude are required')
    lat = float(lat)
    lon = float(lon)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError('Coordinates out of range')
    return lat, lon


@csrf_exempt
@require_http_methods(['POST'])
def analyze_location(request):
    """
    Analyze a selected location and return:
    - smart revenue forecast
    - strategic recommendations
    - crowd score and feasibility score
    """
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)

    try:
        lat, lon = _extract_coordinates(data)
    except (ValueError, TypeError) as exc:
        return JsonResponse({'success': False, 'error': str(exc)}, status=400)

    business_type = (data.get('business_type') or data.get('type') or 'default').strip()

    query = f"""[out:json][timeout:25];
(
  node["amenity"](around:5000,{lat},{lon});
  way["amenity"](around:5000,{lat},{lon});
  relation["amenity"](around:5000,{lat},{lon});
  node["shop"](around:5000,{lat},{lon});
  way["shop"](around:5000,{lat},{lon});
  node["tourism"](around:5000,{lat},{lon});
  way["tourism"](around:5000,{lat},{lon});
);
out center;
"""
    results, error = _run_overpass_query(query, timeout=30)
    if error or results is None:
        return JsonResponse({'success': False, 'error': error or 'Unable to analyze location'}, status=502)

    elements = results.get('elements', [])
    revenue_data = utils.calculate_smart_revenue(elements, business_type=business_type)
    crowd_score = utils.calculate_crowd_score(elements)

    # Recommended business from location dynamics when caller did not pass specific type.
    area_hint = _infer_area_from_pois(elements)
    if crowd_score >= 70:
        dominant = 'high'
    elif crowd_score >= 35:
        dominant = 'medium'
    else:
        dominant = 'low'
    recommended_business = predict_business(dominant, area_hint=area_hint)

    return JsonResponse({
        'success': True,
        'latitude': lat,
        'longitude': lon,
        'business_type': business_type,
        'revenue_data': revenue_data,
        'recommendations': revenue_data.get('recommendations', []),
        'crowd_score': crowd_score,
        'feasibility_score': revenue_data.get('potential_score', 0),
        'potential_score': revenue_data.get('potential_score', 0),
        'recommended_business': recommended_business,
    })


@csrf_exempt
@require_http_methods(['POST'])
def generate_best_locations(request):
    """
    Generate 1-3 best business locations (ML-style feasibility) around a base point.
    """
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)

    try:
        if data.get('latitude') is None or data.get('longitude') is None:
            # Fallback chain: session -> India center default.
            lat = request.session.get('user_lat', 19.0760)
            lon = request.session.get('user_lon', 72.8777)
        else:
            lat, lon = _extract_coordinates(data)
    except (ValueError, TypeError) as exc:
        return JsonResponse({'success': False, 'error': str(exc)}, status=400)

    query = f"""[out:json][timeout:25];
(
  node["amenity"](around:8000,{lat},{lon});
  way["amenity"](around:8000,{lat},{lon});
  relation["amenity"](around:8000,{lat},{lon});
  node["shop"](around:8000,{lat},{lon});
  way["shop"](around:8000,{lat},{lon});
  node["tourism"](around:8000,{lat},{lon});
  way["tourism"](around:8000,{lat},{lon});
  node["public_transport"](around:8000,{lat},{lon});
  way["public_transport"](around:8000,{lat},{lon});
);
out center;
"""
    results, error = _run_overpass_query(query, timeout=30)
    if error or results is None:
        return JsonResponse({'success': False, 'error': error or 'Unable to generate locations'}, status=502)

    elements = results.get('elements', [])
    top = utils.generate_best_location_candidates(lat, lon, elements, top_n=3)

    return JsonResponse({
        'success': True,
        'base_location': {'lat': lat, 'lng': lon},
        'locations': top,
    })

@require_http_methods(['GET'])
def get_business_types(request):
    """Return all dynamic expected business choices for the form dropdown."""
    lat = request.GET.get('lat')
    lon = request.GET.get('lon')
    
    # Can optimize by returning all unique business choices
    choices_by_intensity = get_all_business_choices()
    all_choices = set()
    for intensity, choices in choices_by_intensity.items():
        all_choices.update(choices)
    
    # Format for the frontend
    business_types = [{'value': c, 'label': c.replace('_', ' ').title()} for c in sorted(all_choices)]
    return JsonResponse({'success': True, 'business_types': business_types})

@csrf_exempt
@require_http_methods(['POST'])
def find_matching_locations(request):
    """
    Find 1-3 locations in a 5km radius that satisfy the exact crowd intensity and business category.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'})
        
    lat = data.get('latitude')
    lon = data.get('longitude')
    business_type = (data.get('business_type') or '').strip().lower()
    crowd_intensity = (data.get('crowd_intensity') or '').strip().lower()
    
    if not lat or not lon:
        return JsonResponse({'success': False, 'message': 'Latitude and longitude are required'})
        
    try:
        lat = float(lat)
        lon = float(lon)
        
        # 1. Get POIs in 5km radius
        query = f"""
        [out:json][bbox:6.5,68.0,37.5,97.5];
        (
          node["amenity"](around:5000,{lat},{lon});
          way["amenity"](around:5000,{lat},{lon});
          relation["amenity"](around:5000,{lat},{lon});
          node["shop"](around:5000,{lat},{lon});
          way["shop"](around:5000,{lat},{lon});
          node["tourism"](around:5000,{lat},{lon});
          way["tourism"](around:5000,{lat},{lon});
        );
        out center;
        """
        results, error = _run_overpass_query(query, timeout=30)
        if error or results is None:
            return JsonResponse({'success': False, 'error': error or 'Unable to analyze location'})
            
        elements = results.get('elements', [])
        
        # 2. Divide area into sectors and calculate intensity
        sector_size = 5000 / 3
        sectors = {}
        
        for element in elements:
            elem_lat = element.get('lat') or (element.get('center', {}).get('lat'))
            elem_lon = element.get('lon') or (element.get('center', {}).get('lon'))
            if not elem_lat or not elem_lon: continue
            
            # Distance from center
            R = 6371000
            lat1_rad = math.radians(lat)
            lat2_rad = math.radians(elem_lat)
            delta_lat = math.radians(elem_lat - lat)
            delta_lon = math.radians(elem_lon - lon)
            a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
            distance = R * c
            
            if distance > 5000: continue
            
            angle = math.atan2(elem_lat - lat, elem_lon - lon)
            angle_deg = math.degrees(angle) + 180
            angle_sector = int(angle_deg / 120)
            dist_sector = int(distance / sector_size)
            sector_key = f"{dist_sector}_{angle_sector}"
            
            if sector_key not in sectors: sectors[sector_key] = []
            sectors[sector_key].append({'lat': elem_lat, 'lon': elem_lon})

        matching_locations = []
        
        # 3. Find sectors matching the requested crowd intensity
        for sector_key, pois in sectors.items():
            count = len(pois)
            if count >= 15:
                sector_intensity = 'high'
            elif count >= 5:
                sector_intensity = 'medium'
            else:
                sector_intensity = 'low'
                
            # If the user's requested crowd intensity matches this sector's intensity
            if sector_intensity == crowd_intensity:
                # Check business feasibility in this sector
                # (For simplicity, if intensity matches, we consider it feasible,
                # as business types mapped to intensities are generally feasible there)
                
                avg_lat = sum(p['lat'] for p in pois) / count
                avg_lon = sum(p['lon'] for p in pois) / count
                
                matching_locations.append({
                    'lat': avg_lat,
                    'lon': avg_lon,
                    'intensity': sector_intensity,
                    'business': business_type
                })
                
                if len(matching_locations) >= 3:
                    break

        # 4. If no exact match, fallback to the requested base point (for UX)
        if not matching_locations:
            matching_locations.append({'lat': lat, 'lon': lon, 'intensity': crowd_intensity, 'business': business_type})
            
        return JsonResponse({
            'success': True,
            'matches': matching_locations
        })
        
    except Exception as e:
        import traceback
        return JsonResponse({'success': False, 'error': str(e), 'traceback': traceback.format_exc()})
