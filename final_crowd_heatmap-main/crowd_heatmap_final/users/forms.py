"""
Custom forms for user registration and login.
"""
import re

from django import forms
from django.contrib.auth import authenticate
from django.contrib.auth.forms import (
    AuthenticationForm,
    UserCreationForm as BaseUserCreationForm,
)
from django.core.exceptions import ValidationError

from .models import CustomUser, UserType


class LoginForm(AuthenticationForm):
    """
    Custom login form using email (not username) for authentication.
    Includes optional 'Remember me' checkbox.
    """

    username = forms.EmailField(
        label='Email',
        widget=forms.EmailInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your email',
            'autocomplete': 'email',
        }),
    )
    password = forms.CharField(
        label='Password',
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your password',
            'autocomplete': 'current-password',
        }),
    )
    remember_me = forms.BooleanField(
        required=False,
        initial=False,
        widget=forms.CheckboxInput(attrs={'class': 'form-check-input'}),
        label='Remember me',
    )

    def clean(self):
        """Authenticate using email and password."""
        email = self.cleaned_data.get('username')  # Django uses 'username' for lookup
        password = self.cleaned_data.get('password')

        if email and password:
            email = email.lower().strip()
            self.user_cache = authenticate(
                self.request,
                username=email,
                password=password,
            )
            if self.user_cache is None:
                raise ValidationError(
                    'Invalid email or password. Please try again.',
                    code='invalid_login',
                )
            elif not self.user_cache.is_active:
                raise ValidationError(
                    'This account has been disabled.',
                    code='inactive',
                )
        return self.cleaned_data


class UserCreationForm(BaseUserCreationForm):
    """Custom registration form with email as username and additional fields."""

    full_name = forms.CharField(
        max_length=150,
        required=True,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your full name',
            'autocomplete': 'name',
        }),
        label='Full Name',
    )
    email = forms.EmailField(
        required=True,
        widget=forms.EmailInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your email',
            'autocomplete': 'email',
        }),
        label='Email',
    )
    phone_number = forms.CharField(
        max_length=20,
        required=True,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your phone number',
            'autocomplete': 'tel',
        }),
        label='Phone Number',
    )
    user_type = forms.ChoiceField(
        choices=[('', 'Select account type')] + list(UserType.choices),
        required=True,
        widget=forms.Select(attrs={
            'class': 'form-select',
        }),
        label='Account Type',
    )
    password1 = forms.CharField(
        label='Password',
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Create a password',
            'autocomplete': 'new-password',
        }),
    )
    password2 = forms.CharField(
        label='Confirm Password',
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Confirm your password',
            'autocomplete': 'new-password',
        }),
    )

    class Meta:
        model = CustomUser
        fields = ('full_name', 'email', 'phone_number', 'user_type')

    def clean_email(self):
        """Prevent duplicate email registration."""
        email = self.cleaned_data.get('email')
        if email:
            email = email.lower().strip()
            if CustomUser.objects.filter(email__iexact=email).exists():
                raise ValidationError(
                    'An account with this email address already exists.',
                    code='duplicate_email',
                )
        return email

    def clean_full_name(self):
        """Validate full name - non-empty, reasonable length."""
        full_name = self.cleaned_data.get('full_name', '').strip()
        if len(full_name) < 2:
            raise ValidationError('Full name must be at least 2 characters.')
        if len(full_name) > 150:
            raise ValidationError('Full name must not exceed 150 characters.')
        return full_name

    def clean_phone_number(self):
        """Basic phone number validation - allow digits, spaces, +, -, parentheses."""
        phone = self.cleaned_data.get('phone_number', '').strip()
        if not phone:
            raise ValidationError('Phone number is required.')
        # Allow common formats: +1 234 567 8900, (123) 456-7890, 123-456-7890
        if not re.match(r'^[\d\s+\-()]{7,20}$', phone):
            raise ValidationError('Enter a valid phone number.')
        if len(re.sub(r'\D', '', phone)) < 7:
            raise ValidationError('Phone number must contain at least 7 digits.')
        return phone

    def clean(self):
        """Validate password match."""
        cleaned_data = super().clean()
        password1 = cleaned_data.get('password1')
        password2 = cleaned_data.get('password2')

        if password1 and password2 and password1 != password2:
            self.add_error('password2', 'The two password fields did not match.')

        return cleaned_data

    def save(self, commit=True):
        """Save user with normalized email and hashed password."""
        user = super().save(commit=False)
        user.email = self.cleaned_data['email'].lower()
        user.full_name = self.cleaned_data['full_name']
        user.phone_number = self.cleaned_data['phone_number']
        user.user_type = self.cleaned_data['user_type']
        user.set_password(self.cleaned_data['password1'])  # Django hashes automatically
        if commit:
            user.save()
        return user
