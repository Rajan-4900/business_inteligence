from django import forms
from .models import BusinessUser, ContactMessage

class BusinessUserForm(forms.ModelForm):
    class Meta:
        model = BusinessUser
        fields = [
            'name',
            'email',
            'phone',
            'business_type',
            'recommended_business',
            'crowd_intensity',
            'latitude',
            'longitude',
        ]
        widgets = {
            'name': forms.TextInput(attrs={'class': 'form-control biz-input', 'placeholder': 'Enter your name'}),
            'email': forms.EmailInput(attrs={'class': 'form-control biz-input', 'placeholder': 'Enter your email'}),
            'phone': forms.TextInput(attrs={'class': 'form-control biz-input', 'placeholder': 'Enter your phone number'}),
            'business_type': forms.TextInput(attrs={'class': 'form-control biz-input', 'placeholder': 'Type of business'}),
            # This is populated automatically when user chooses a suggestion.
            'recommended_business': forms.HiddenInput(),
            'crowd_intensity': forms.Select(attrs={'class': 'form-control biz-select'}),
            'latitude': forms.HiddenInput(),
            'longitude': forms.HiddenInput(),
        }

class ContactForm(forms.ModelForm):
    class Meta:
        model = ContactMessage
        fields = ['name', 'email', 'subject', 'message']
        widgets = {
            'name': forms.TextInput(attrs={'class': 'form-control biz-input', 'placeholder': 'Your Name'}),
            'email': forms.EmailInput(attrs={'class': 'form-control biz-input', 'placeholder': 'Your Email'}),
            'subject': forms.TextInput(attrs={'class': 'form-control biz-input', 'placeholder': 'Subject'}),
            'message': forms.Textarea(attrs={'class': 'form-control biz-input', 'placeholder': 'Your Message', 'rows': 5}),
        }
