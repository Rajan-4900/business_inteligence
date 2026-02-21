from django.contrib import admin
from .models import BusinessUser, ContactMessage

@admin.register(BusinessUser)
class BusinessUserAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'business_type', 'crowd_intensity', 'created_at']
    list_filter = ['crowd_intensity', 'created_at']
    search_fields = ['name', 'email', 'business_type']

@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'subject', 'created_at']
    list_filter = ['created_at']
    search_fields = ['name', 'email', 'subject', 'message']
