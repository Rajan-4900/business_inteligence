from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class CustomUserManager(BaseUserManager):
    """Custom user manager where email is the unique identifier for authentication."""

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('The Email field must be set')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)  # Django handles hashing
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_active', True)
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')
        return self.create_user(email, password, **extra_fields)


class UserType(models.TextChoices):
    """User type choices - stored in database as text values."""
    BUSINESSMAN = 'businessman', 'Businessman'
    CUSTOMER = 'customer', 'Customer'


class CustomUser(AbstractUser):
    """
    Custom User model using email as the unique identifier.
    Username field is removed; email is used for authentication.
    """
    username = None  # Remove username field

    objects = CustomUserManager()

    email = models.EmailField('email address', unique=True)
    full_name = models.CharField('full name', max_length=150)
    phone_number = models.CharField('phone number', max_length=20)
    user_type = models.CharField(
        'user type',
        max_length=20,
        choices=UserType.choices,
        default=UserType.CUSTOMER,
    )

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['full_name', 'phone_number', 'user_type']

    class Meta:
        verbose_name = 'user'
        verbose_name_plural = 'users'

    def __str__(self):
        return self.email
