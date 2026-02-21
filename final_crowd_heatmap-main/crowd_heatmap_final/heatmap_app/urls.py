from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('chat/', views.chat_message, name='chat_message'),
    path('submit-form/', views.submit_form, name='submit_form'),
    path('search-location/', views.search_location, name='search_location'),
    path('find-popular-places/', views.find_popular_places, name='find_popular_places'),
    path('analyze-crowd-intensity/', views.analyze_crowd_intensity, name='analyze_crowd_intensity'),
    path('autocomplete-location/', views.autocomplete_location, name='autocomplete_location'),
    path('check-feasibility/', views.check_feasibility, name='check_feasibility'),
    path('business-recommendations/', views.business_recommendations, name='business_recommendations'),
    path('contact/', views.contact_us, name='contact_us'),
    path('api/user-location/', views.report_user_location, name='report_user_location'),
    path('api/analyze-location/', views.analyze_location, name='analyze_location'),
    path('api/generate-best-locations/', views.generate_best_locations, name='generate_best_locations'),
    path('api/business-types/', views.get_business_types, name='get_business_types'),
    path('api/find-matching-locations/', views.find_matching_locations, name='find_matching_locations'),
]
