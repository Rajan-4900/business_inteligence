from django.db import models

class BusinessUser(models.Model):
    CROWD_INTENSITY_CHOICES = [
        ('high', 'High - High intensity crowded area'),
        ('medium', 'Medium - Moderate crowd intensity'),
        ('low', 'Low - Low crowd intensity'),
    ]
    
    name = models.CharField(max_length=100)
    email = models.EmailField()
    phone = models.CharField(max_length=20)
    business_type = models.CharField(max_length=100)
    # If the user picked a suggestion from the AI / CSV list,
    # we store that separately so you can analyze it later.
    recommended_business = models.CharField(max_length=100, null=True, blank=True)
    crowd_intensity = models.CharField(max_length=10, choices=CROWD_INTENSITY_CHOICES)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.name} - {self.business_type}"

class ContactMessage(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField()
    subject = models.CharField(max_length=200)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Message from {self.name} - {self.subject}"
