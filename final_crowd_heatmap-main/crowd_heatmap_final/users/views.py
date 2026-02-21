"""
Views for user authentication and registration.
"""
from django.contrib import messages
from django.contrib.auth import login, logout
from django.shortcuts import redirect, render
from django.urls import reverse

from .forms import LoginForm, UserCreationForm


def login_view(request):
    """
    Handle user login with email and password.
    - GET: Display login form
    - POST: Authenticate, set session expiry based on 'remember me', redirect to home
    """
    if request.user.is_authenticated:
        messages.info(request, 'You are already logged in.')
        return redirect('home')

    if request.method == 'POST':
        form = LoginForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)

            # Session expiry: 0 = browser session, else persistent (e.g. 2 weeks)
            if form.cleaned_data.get('remember_me'):
                request.session.set_expiry(60 * 60 * 24 * 14)  # 2 weeks
            else:
                request.session.set_expiry(0)  # Expire when browser closes

            messages.success(request, f'Welcome back, {user.full_name}!')
            next_url = request.GET.get('next') or reverse('home')
            return redirect(next_url)
    else:
        form = LoginForm(request)

    return render(request, 'users/login.html', {'form': form})


def register_view(request):
    """
    Handle user registration.
    - GET: Display registration form
    - POST: Validate, save user, redirect to login with success message
    """
    if request.user.is_authenticated:
        messages.info(request, 'You are already logged in.')
        return redirect('home')

    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            messages.success(
                request,
                'Registration successful! You can now log in with your email and password.',
            )
            return redirect('login')
        else:
            messages.error(
                request,
                'Please correct the errors below and try again.',
            )
    else:
        form = UserCreationForm()

    return render(request, 'users/register.html', {'form': form})


def logout_view(request):
    """Log out the user and show a confirmation message."""
    logout(request)
    messages.success(request, 'You have been logged out successfully.')
    return redirect('login')
