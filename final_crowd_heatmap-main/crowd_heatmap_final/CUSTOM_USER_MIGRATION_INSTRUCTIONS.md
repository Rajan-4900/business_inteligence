# Custom User Model - Migration Instructions

This document describes how to apply the Custom User model and run migrations.

## Summary of Changes

- **New app**: `users` with `CustomUser` model
- **Authentication**: Email-based (no username)
- **Fields**: email, full_name, phone_number, user_type (Businessman/Customer)

---

## Important: Fresh Database Required

Because `AUTH_USER_MODEL` has been changed, Django's auth system will use the new `CustomUser` table instead of the default `auth_user`. If you have **already run migrations** before, the old `auth_user` table exists and will conflict.

### Option A: Development - Fresh Start (Recommended)

If you have no important data in the database:

```bash
# 1. Delete the existing database
# Windows (PowerShell):
Remove-Item db.sqlite3 -ErrorAction SilentlyContinue

# Or manually delete db.sqlite3 from the project root

# 2. Run all migrations
python manage.py migrate

# 3. Create a superuser (use email, not username)
python manage.py createsuperuser
# When prompted: enter email, full_name, phone_number, user_type, password
```

### Option B: Production - Preserving Data

If you have important data, you'll need to:

1. Export your data from the existing database
2. Delete the database and run migrations
3. Re-import your data (excluding auth_user if you're replacing users)

---

## Verification

After migrating:

1. **Admin login**: Use email + password (not username)
   ```
   http://127.0.0.1:8000/admin/
   ```

2. **Create user via shell**:
   ```python
   from users.models import CustomUser
   user = CustomUser.objects.create_user(
       email='test@example.com',
       password='securepassword123',
       full_name='John Doe',
       phone_number='+1234567890',
       user_type='customer'
   )
   ```

3. **Password hashing**: Django's `set_password()` and `create_user()` handle hashing automatically (PBKDF2 by default).

---

## Files Created/Modified

| File | Purpose |
|------|---------|
| `users/models.py` | CustomUser model, CustomUserManager |
| `users/admin.py` | Admin registration with list_display, list_filter |
| `users/migrations/0001_initial.py` | Initial migration |
| `crowd_heatmap_project/settings.py` | AUTH_USER_MODEL, users in INSTALLED_APPS |
