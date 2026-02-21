import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
print(f"API Key: {api_key[:5]}...{api_key[-5:]}")

genai.configure(api_key=api_key)

try:
    print("Available models:")
    for m in genai.list_models():
        print(f" - {m.name}")
except Exception as e:
    print(f"Error listing models: {e}")
