# Authentication System – Structure Summary

Complete authentication system for Crowd Heatmap using Django's built-in auth with a custom user model.

---

## 1. Project Structure

```
crowd_heatmap_final/
├── crowd_heatmap_project/     # Project settings
│   ├── settings.py            # AUTH_USER_MODEL, LOGIN_URL, email config
│   └── urls.py                # Includes users.urls, heatmap_app.urls
├── users/                     # Authentication app
│   ├── models.py              # CustomUser, UserType
│   ├── forms.py               # LoginForm, UserCreationForm
│   ├── views.py               # login, register, logout views
│   ├── admin.py               # CustomUserAdmin
│   ├── urls.py                # Auth URLs + password reset
│   └── migrations/
│       └── 0001_initial.py    # CustomUser table
├── heatmap_app/               # Main app
│   ├── views.py               # home (@login_required)
│   └── ...
├── templates/
│   ├── users/
│   │   ├── base_auth.html
│   │   ├── login.html
│   │   ├── register.html
│   │   ├── password_reset.html
│   │   ├── password_reset_done.html
│   │   ├── password_reset_confirm.html
│   │   ├── password_reset_complete.html
│   │   └── emails/
│   │       ├── password_reset_subject.txt
│   │       └── password_reset_email.html
│   └── heatmap_app/
│       └── home.html          # Dashboard with auth-aware navbar
├── static/css/style.css       # Nav bar, badge, flash message styles
└── db.sqlite3
```

---

## 2. Custom User Model

| Field        | Type     | Notes                          |
|-------------|----------|--------------------------------|
| email       | EmailField | Unique, USERNAME_FIELD        |
| full_name   | CharField  | Required                      |
| phone_number| CharField  | Required                      |
| user_type   | CharField  | Choices: Businessman, Customer|

- **Authentication**: Email + password only
- **Password hashing**: Django (PBKDF2)
- **Stored in DB**: `users_customuser` table

---

## 3. URL Routes

| URL                          | Name                    | Purpose                |
|-----------------------------|-------------------------|------------------------|
| `/accounts/register/`       | `register`              | Registration           |
| `/accounts/login/`          | `login`                 | Login                  |
| `/accounts/logout/`         | `logout`                | Logout                 |
| `/accounts/password-reset/` | `password_reset`        | Request reset email    |
| `/accounts/password-reset/done/` | `password_reset_done` | Reset email sent       |
| `/accounts/password-reset-confirm/<uidb64>/<token>/` | `password_reset_confirm` | Set new password |
| `/accounts/password-reset/complete/` | `password_reset_complete` | Reset complete   |
| `/`                         | `home`                  | Dashboard (protected)  |

---

## 4. Dashboard (Home) Page

- **Access**: `@login_required` – redirects to login if not authenticated
- **Navbar when logged in**:
  - Welcome message: `Welcome, {full_name}`
  - User type badge: Businessman (blue) / Customer (green)
  - Logout button
- **Navbar when logged out**: Login, Register buttons (defensive; page is protected)
- **App brand**: Clickable link to home

---

## 5. Django Admin

- **CustomUser** is registered
- **List display**: email, full_name, phone_number, user_type, is_staff, is_active, date_joined
- **List filter**: user_type, is_staff, is_active, date_joined
- **Search**: email, full_name, phone_number

---

## 6. Settings

```python
AUTH_USER_MODEL = 'users.CustomUser'
LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'home'
LOGOUT_REDIRECT_URL = 'home'
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'  # Dev
```

---

## 7. Auth Flow

```
Registration → Login → Dashboard (home)
     ↓              ↓
  Register      Forgot Password → Email → Reset Link → New Password → Login
```

---

## 8. Migrations

```bash
# Fresh database setup
Remove-Item db.sqlite3 -ErrorAction SilentlyContinue
python manage.py migrate
python manage.py createsuperuser  # Uses email, full_name, phone_number, user_type
```

---

## 9. Security

- CSRF protection on all forms
- Passwords hashed via Django
- Password reset tokens expire
- No user enumeration on password reset
- Email used for auth (no username)
- `@login_required` on dashboard
