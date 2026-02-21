import requests
import math
import random
from datetime import datetime

# --- ADVANCED BUSINESS METRICS & CONFIG ---
BUSINESS_METRICS = {
    'cafe': {
        'avg_spend': 350, 
        'base_conv': 0.18, 
        'label': 'Hospitality',
        'optimal_range': (20, 60),  # Ideal crowd per hour
        'sensitivity': 'high'       # Highly sensitive to overcrowding
    },
    'restaurant': {
        'avg_spend': 1200, 
        'base_conv': 0.10, 
        'label': 'Dining',
        'optimal_range': (40, 100),
        'sensitivity': 'medium'
    },
    'fast_food': {
        'avg_spend': 500, 
        'base_conv': 0.25, 
        'label': 'Dining',
        'optimal_range': (50, 150),
        'sensitivity': 'low'
    },
    'shop': {
        'avg_spend': 2000, 
        'base_conv': 0.08, 
        'label': 'Retail',
        'optimal_range': (10, 50),
        'sensitivity': 'medium'
    },
    'supermarket': {
        'avg_spend': 1800, 
        'base_conv': 0.35, 
        'label': 'Retail',
        'optimal_range': (50, 200),
        'sensitivity': 'low'
    },
    'pharmacy': {
        'avg_spend': 800, 
        'base_conv': 0.40, 
        'label': 'Healthcare',
        'optimal_range': (10, 40),
        'sensitivity': 'high' # People need quick service
    },
    'default': {
        'avg_spend': 600, 
        'base_conv': 0.05, 
        'label': 'General Business',
        'optimal_range': (10, 50),
        'sensitivity': 'medium'
    }
}

# CQI Multipliers (Spending Power)
CQI_MULTIPLIERS = {
    'student': 0.6,    # Low spend
    'professional': 1.8, # High spend
    'family': 1.3,      # Medium-High
    'tourist': 2.5,     # Very High
    'resident': 1.0     # Baseline
}

# --- HELPER FUNCTIONS ---

def get_temporal_multiplier():
    """Smart time-of-day multiplier for crowd quality & volume."""
    hour = datetime.now().hour
    # Late Night (0-6)
    if 0 <= hour < 6: return 0.2
    # Morning Rush (6-10) - High volume, low browse time
    if 6 <= hour < 10: return 0.8
    # Lunch Peak (11-14) - Professionals eating out
    if 11 <= hour < 14: return 1.4
    # Afternoon Slump (14-17)
    if 14 <= hour < 17: return 0.9
    # Evening Peak (17-21) - Leisure + Shopping
    if 17 <= hour < 21: return 1.6
    # Late Evening (21-24)
    return 1.1

def calculate_cqi(area_type):
    """
    Calculate Customer Quality Index (CQI) based on inferred area type.
    Returns: float multiplier for revenue.
    """
    # Simply mapping area types to dominant customer profiles
    if area_type == 'college':
        return CQI_MULTIPLIERS['student']
    elif area_type == 'commercial':
        return CQI_MULTIPLIERS['professional']
    elif area_type == 'market' or area_type == 'mall':
        return CQI_MULTIPLIERS['family']
    elif area_type == 'tourism' or area_type == 'attraction':
        return CQI_MULTIPLIERS['tourist']
    return CQI_MULTIPLIERS['resident']

def get_overload_penalty(current_crowd, optimal_max, sensitivity):
    """
    Apply revenue penalty if crowd exceeds optimal capacity.
    Too many people = bad service = lost revenue.
    """
    if current_crowd <= optimal_max:
        return 1.0 # No penalty
    
    excess_ratio = (current_crowd - optimal_max) / optimal_max
    
    # Penalty severity based on business type
    factor = 0.5 if sensitivity == 'high' else 0.2
    
    # If 50% over capacity, penalty is 1.0 - (0.5 * 0.5) = 0.75 (25% loss)
    penalty = max(0.4, 1.0 - (excess_ratio * factor))
    return penalty

def calculate_crowd_score(elements):
    """Returns a score 0-100 indicating crowd density."""
    if not elements: return 0
    return min(len(elements), 100) # Simple cap for UI score

def predict_revenue(dummy_score):
    """Legacy wrapper for simple single-value return (backward compatibility)."""
    score = max(0, min(100, int(dummy_score or 0)))
    # Keep this deterministic and simple for compatibility paths.
    return int(120000 + (score * 7200))

def _infer_area_type(places):
    """Heuristics to guess area type from POIs."""
    counts = {'shop': 0, 'office': 0, 'tourism': 0, 'amenity': 0}
    for p in places:
        tags = p.get('tags', {})
        if 'shop' in tags: counts['shop'] += 1
        if 'office' in tags: counts['office'] += 1
        if 'tourism' in tags: counts['tourism'] += 1
        if 'amenity' in tags: counts['amenity'] += 1
    
    total = len(places)
    if not total: return 'residential'
    
    if counts['office'] > total * 0.2: return 'commercial'
    if counts['tourism'] > total * 0.1: return 'tourism'
    if counts['shop'] > total * 0.4: return 'market'
    return 'residential'

# --- MAIN REVENUE ENGINE ---

def _coord_from_element(el):
    lat = el.get('lat') or (el.get('center') or {}).get('lat')
    lon = el.get('lon') or (el.get('center') or {}).get('lon')
    if lat is None or lon is None:
        return None
    return float(lat), float(lon)


def enrich_places_with_revenue(places):
    """
    Advanced Revenue AI calculation.
    """
    if not places:
        return [], 0
    
    # 1. Analyze Area Context
    area_type = _infer_area_type(places)
    cqi = calculate_cqi(area_type)
    temporal_mult = get_temporal_multiplier()
    
    # Global density factor (More POIs nearby = higher baseline footfall)
    global_density_score = min(len(places) / 20.0, 3.0) 

    enriched_places = []
    total_area_monthly_revenue = 0

    for p in places:
        tags = p.get('tags', {})
        # Identify business type
        b_type = tags.get('amenity') or tags.get('shop') or tags.get('tourism') or 'default'
        # Fallback to general category in config
        metrics = BUSINESS_METRICS.get(b_type, BUSINESS_METRICS['default'])
        
        # --- SMART REVENUE LOGIC ---
        
        # 2. Footfall Simulation
        # Baseline footfall varies by business type popularity
        base_footfall = 50 * global_density_score
        
        # Apply time of day (Traffic varies by hour)
        current_footfall = base_footfall * temporal_mult
        
        # Random fluctuation for "Live Simulation" feel ( +/- 15%)
        fluctuation = 1 + (random.random() - 0.5) * 0.3
        current_footfall *= fluctuation
        
        # 3. Revenue Calculation
        avg_spend = metrics['avg_spend']
        conversion_rate = metrics['base_conv'] * cqi
        daily_revenue = current_footfall * conversion_rate * avg_spend
        monthly_revenue = daily_revenue * 30
        
        # 4. Potential Score (0-100)
        opt_min, opt_max = metrics['optimal_range']
        potential = min(100, int((current_footfall / opt_max) * 100)) if opt_max else 50
        
        # 5. Health Assessment
        if potential >= 70:
            health = 'Strong'
        elif potential >= 40:
            health = 'Moderate'
        else:
            health = 'Weak'
        
        overload_risk = max(0, int((current_footfall - opt_max) / max(1, opt_max) * 100)) if current_footfall > opt_max else 0
        
        revenue_data = {
            'estimated_daily_revenue': round(daily_revenue, 2),
            'estimated_monthly_revenue': round(monthly_revenue, 2),
            'peak_hour_revenue': round(daily_revenue / 8, 2),
            'potential_score': potential,
            'business_health': health,
            'overload_risk': overload_risk,
        }
        
        enriched = dict(p)
        enriched['revenue_data'] = revenue_data
        enriched_places.append(enriched)
        total_area_monthly_revenue += monthly_revenue

    return enriched_places, round(total_area_monthly_revenue, 2)




def _haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _daypart_multiplier(hour):
    if 5 <= hour < 10:
        return 0.78, "Morning"
    if 10 <= hour < 14:
        return 1.22, "Lunch Spike"
    if 14 <= hour < 17:
        return 0.95, "Afternoon"
    if 17 <= hour < 22:
        return 1.35, "Evening Peak"
    return 0.58, "Night Drop"


def _infer_customer_mix(elements):
    total = max(1, len(elements))
    students = 0
    professionals = 0
    families = 0
    tourists = 0

    for el in elements:
        tags = el.get('tags') or {}
        amenity = str(tags.get('amenity') or '').lower()
        shop = str(tags.get('shop') or '').lower()
        tourism = str(tags.get('tourism') or '').lower()

        if amenity in {'school', 'college', 'university'}:
            students += 2
        if amenity in {'bank', 'office', 'restaurant', 'cafe'}:
            professionals += 2
        if shop in {'supermarket', 'mall', 'clothes', 'clothing', 'department_store'}:
            families += 2
        if tourism:
            tourists += 3
        if amenity in {'park', 'cinema', 'hospital'}:
            families += 1

    # Baseline mix so sparse data still works.
    students += int(total * 0.10)
    professionals += int(total * 0.16)
    families += int(total * 0.14)
    tourists += int(total * 0.08)

    mix_total = max(1, students + professionals + families + tourists)
    return {
        "students": students / mix_total,
        "professionals": professionals / mix_total,
        "families": families / mix_total,
        "tourists": tourists / mix_total,
    }


def _customer_quality_index(mix):
    return (
        mix["students"] * CQI_MULTIPLIERS["student"] +
        mix["professionals"] * CQI_MULTIPLIERS["professional"] +
        mix["families"] * CQI_MULTIPLIERS["family"] +
        mix["tourists"] * CQI_MULTIPLIERS["tourist"]
    )


def _competition_density(elements, business_type):
    if not elements:
        return 0.0
    needle = (business_type or '').strip().lower().replace(' ', '_')
    if not needle:
        return 0.2
    same = 0
    for el in elements:
        tags = el.get('tags') or {}
        poi = str(tags.get('amenity') or tags.get('shop') or tags.get('tourism') or '').lower().replace(' ', '_')
        if poi and (poi == needle or needle in poi or poi in needle):
            same += 1
    return min(1.0, same / max(1, len(elements)))


def _recommendations_from_metrics(metrics):
    recs = []
    if metrics['overload_risk'] >= 70:
        recs.append("High overload risk detected: add queue automation and split peak-hour staffing.")
    elif metrics['overload_risk'] >= 40:
        recs.append("Moderate overload risk: introduce time-slot discounts to flatten spikes.")
    else:
        recs.append("Low overload risk: scale marketing during lunch/evening to capture unused capacity.")

    if metrics['conversion_rate'] < 0.08:
        recs.append("Conversion is weak: improve storefront visibility and local ad targeting.")
    else:
        recs.append("Conversion is healthy: prioritize upsell bundles to lift average spend.")

    if metrics['customer_quality'] < 1.1:
        recs.append("Customer quality is budget-sensitive: offer value packs and loyalty rewards.")
    elif metrics['customer_quality'] > 1.6:
        recs.append("High-spend audience detected: premium positioning can materially increase revenue.")

    return recs[:3]


def calculate_smart_revenue(elements, business_type='default', hour=None):
    """
    ML-style feasibility revenue engine using:
    - Footfall from POIs + time + popularity
    - Customer quality index by crowd mix
    - Competition-aware smart conversion
    - Overcrowding penalty with business-specific optimal range
    """
    b_key = (business_type or 'default').strip().lower().replace(' ', '_')
    metrics = BUSINESS_METRICS.get(b_key, BUSINESS_METRICS['default'])

    now_hour = datetime.now().hour if hour is None else int(hour) % 24
    time_mult, daypart = _daypart_multiplier(now_hour)
    poi_count = len(elements or [])

    popularity_signal = min(1.5, poi_count / 60.0)
    footfall = max(10.0, (22 + (poi_count * 2.8)) * (1 + popularity_signal * 0.35) * time_mult)

    crowd_mix = _infer_customer_mix(elements or [])
    customer_quality = _customer_quality_index(crowd_mix)

    competition = _competition_density(elements or [], b_key)
    rating_factor = 0.9 + min(0.3, popularity_signal * 0.2)

    optimal_min, optimal_max = metrics['optimal_range']
    overload_penalty = get_overload_penalty(footfall, optimal_max, metrics['sensitivity'])
    overload_ratio = max(0.0, (footfall - optimal_max) / max(1.0, optimal_max))
    waiting_penalty = min(0.35, overload_ratio * 0.25)

    smart_conversion = metrics['base_conv'] * (1 - competition * 0.45) * rating_factor * overload_penalty * (1 - waiting_penalty)
    smart_conversion = max(0.02, min(0.60, smart_conversion))

    dynamic_avg_spend = metrics['avg_spend'] * (0.88 + 0.24 * customer_quality)

    effective_customers = footfall * smart_conversion * customer_quality
    daily_revenue = effective_customers * dynamic_avg_spend
    monthly_revenue = daily_revenue * 30

    peak_time_mult = 1.35 if daypart != "Evening Peak" else 1.15
    peak_hour_revenue = (daily_revenue / 12.0) * peak_time_mult

    overload_risk = int(min(100, max(0.0, overload_ratio * 100)))

    potential_score = (
        (min(100, footfall) * 0.24) +
        ((1 - competition) * 100 * 0.22) +
        (min(2.5, customer_quality) / 2.5 * 100 * 0.20) +
        ((1 - min(1.0, waiting_penalty * 2)) * 100 * 0.18) +
        (min(1.0, rating_factor) * 100 * 0.16)
    )
    potential_score = int(max(0, min(100, round(potential_score))))

    if potential_score >= 78 and overload_risk < 60:
        health = 'Strong'
    elif potential_score >= 55:
        health = 'Moderate'
    else:
        health = 'Weak'

    result = {
        'daypart': daypart,
        'footfall': round(footfall, 2),
        'conversion_rate': round(smart_conversion, 4),
        'customer_quality': round(customer_quality, 3),
        'dynamic_avg_spend': round(dynamic_avg_spend, 2),
        'effective_customers': round(effective_customers, 2),
        'daily_revenue': round(daily_revenue, 2),
        'estimated_monthly_revenue': round(monthly_revenue, 2),
        'peak_hour_revenue': round(peak_hour_revenue, 2),
        'overload_risk': overload_risk,
        'potential_score': potential_score,
        'business_health': health,
    }
    result['recommendations'] = _recommendations_from_metrics(result)
    return result


def _location_factor_components(elements):
    total = max(1, len(elements))
    mix = _infer_customer_mix(elements)
    spending_power = min(100.0, (_customer_quality_index(mix) / 2.5) * 100)

    competition_total = 0
    for el in elements:
        tags = el.get('tags') or {}
        if tags.get('amenity') or tags.get('shop'):
            competition_total += 1
    competition_density = min(100.0, (competition_total / total) * 100)

    transport_growth = 0
    for el in elements:
        tags = el.get('tags') or {}
        if (tags.get('public_transport') or tags.get('highway') in {'bus_stop', 'primary'} or tags.get('railway')):
            transport_growth += 1
    area_growth = min(100.0, ((transport_growth + total * 0.08) / total) * 100)

    footfall_potential = min(100.0, total * 2.2)
    demand_supply_gap = max(0.0, min(100.0, footfall_potential * 0.75 - competition_density * 0.55 + spending_power * 0.25))

    return {
        'footfall_potential': round(footfall_potential, 2),
        'competition_density': round(competition_density, 2),
        'spending_power': round(spending_power, 2),
        'area_growth': round(area_growth, 2),
        'demand_supply_gap': round(demand_supply_gap, 2),
    }


def _recommended_business_for_candidate(factors):
    if factors['spending_power'] > 70 and factors['competition_density'] < 55:
        return 'restaurant'
    if factors['demand_supply_gap'] > 55 and factors['footfall_potential'] > 40:
        return 'cafe'
    if factors['competition_density'] > 70:
        return 'pharmacy'
    return 'supermarket'


def generate_best_location_candidates(base_lat, base_lon, elements, top_n=3):
    """
    Generate 1-3 best locations around a selected point using feasibility scoring.
    """
    offsets = [
        (0.0000, 0.0000), (0.0080, 0.0045), (-0.0080, -0.0040),
        (0.0065, -0.0060), (-0.0060, 0.0065), (0.0120, 0.0000),
        (0.0000, -0.0120), (-0.0110, 0.0020)
    ]

    candidates = []
    for i, (dlat, dlon) in enumerate(offsets, start=1):
        c_lat = float(base_lat) + dlat
        c_lon = float(base_lon) + dlon

        # Build local neighborhood for each candidate.
        local = []
        for el in (elements or []):
            coord = _coord_from_element(el)
            if not coord:
                continue
            if _haversine_m(c_lat, c_lon, coord[0], coord[1]) <= 1700:
                local.append(el)

        factors = _location_factor_components(local)
        score = (
            factors['footfall_potential'] * 0.30 +
            (100 - factors['competition_density']) * 0.22 +
            factors['spending_power'] * 0.18 +
            factors['area_growth'] * 0.15 +
            factors['demand_supply_gap'] * 0.15
        )
        score = max(0.0, min(100.0, score))

        rec_business = _recommended_business_for_candidate(factors)
        rev = calculate_smart_revenue(local, business_type=rec_business)

        candidates.append({
            'lat': round(c_lat, 6),
            'lng': round(c_lon, 6),
            'name': f"AI Zone {i}",
            'business_type': rec_business.replace('_', ' ').title(),
            'score': round(score, 1),
            'estimated_revenue': round(rev['estimated_monthly_revenue'], 2),
            'feasibility_factors': factors,
            'revenue_data': rev,
        })

    candidates.sort(key=lambda x: x['score'], reverse=True)
    return candidates[:max(1, min(3, int(top_n or 3)))]
