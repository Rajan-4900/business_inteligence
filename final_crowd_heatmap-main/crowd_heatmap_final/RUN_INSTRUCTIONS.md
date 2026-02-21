# How to Execute the Crowd Heatmap Project

## Step-by-Step Execution Guide

### Step 1: Navigate to Project Directory
Open PowerShell or Command Prompt and navigate to the project folder:
```powershell
cd C:\Users\vhavi\OneDrive\Documents\Desktop\crowd_heatmap
```

### Step 2: Install Dependencies
Install all required Python packages:
```powershell
pip install -r requirements.txt
```

**Note:** If you encounter any issues, you can install packages individually:
```powershell
pip install django==6.0.1
pip install channels==4.1.0
pip install daphne==4.1.2
pip install opencv-python==4.10.0.84
pip install numpy
pip install requests
```

### Step 3: Run Database Migrations (if not already done)
```powershell
python manage.py migrate
```

### Step 4: Create Superuser (Optional - for admin access)
This allows you to access the Django admin panel:
```powershell
python manage.py createsuperuser
```
Follow the prompts to create a username, email, and password.

### Step 5: Start the Development Server
```powershell
python manage.py runserver
```

You should see output like:
```
Starting development server at http://127.0.0.1:8000/
Quit the server with CTRL-BREAK.
```

### Step 6: Open in Browser
Open your web browser and navigate to:
```
http://127.0.0.1:8000/
```

### Step 7: Access Admin Panel (Optional)
If you created a superuser, you can access the admin panel at:
```
http://127.0.0.1:8000/admin/
```

## Quick Start (All Commands Together)

```powershell
# Navigate to project
cd C:\Users\vhavi\OneDrive\Documents\Desktop\crowd_heatmap

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Start server
python manage.py runserver
```

Then open: **http://127.0.0.1:8000/**

## Troubleshooting

### Port Already in Use
If port 8000 is already in use, specify a different port:
```powershell
python manage.py runserver 8080
```

### Module Not Found Errors
Make sure you're in a virtual environment (recommended):
```powershell
# Create virtual environment
python -m venv venv

# Activate virtual environment (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Then install dependencies
pip install -r requirements.txt
```

### Database Errors
If you get database errors, try:
```powershell
python manage.py makemigrations
python manage.py migrate
```

## Using the Application

1. **Search Locations**: Type a location in the search bar and click "Search"
2. **Find Your Location**: Click "Find My Location" button
3. **Find Popular Places**: After finding your location, click "Find Popular Places (5km)"
4. **Submit Form**: Click "Submit Business Info" button, fill the form, and submit
5. **Chatbot**: Use the chatbot in the bottom-right corner for help

## Stopping the Server

Press `CTRL + C` in the terminal to stop the development server.
