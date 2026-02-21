import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
model_name = "models/gemini-flash-latest"

print(f"Testing with Key: {api_key[:5]}...{api_key[-5:]}")
print(f"Testing with Model: {model_name}")

genai.configure(api_key=api_key)

try:
    model = genai.GenerativeModel(model_name)
    response = model.generate_content("Say 'OK' if you can hear me.")
    print("Response successful:")
    print(response.text)
except Exception as e:
    print(f"Error: {e}")
