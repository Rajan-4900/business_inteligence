import os
import json
import google.generativeai as genai
from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from dotenv import load_dotenv

# Initialize dotenv with explicit path to project root
_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
load_dotenv(dotenv_path=_ENV_PATH, override=True)

# System instructions to give the bot personality and awareness of map commands
SYSTEM_INSTRUCTION = """
You are the "Antigravity" AI Assistant for the Crowd Heatmap Analyzer. 
Your goal is to help users find suitable locations for businesses based on crowd density.

CONSTRAINTS:
- RESPONSE LENGTH: Your response MUST be under 100 words. This is a strict limit.
- INFORMATION DENSITY: Ensure every response contains the most important key points (feasibility, density, location stats) without fluff.
- COMMAND SYNTAX: Whenever you suggest or use a map command, you MUST wrap it in double quotes (e.g., "find my location").
- INTERACTION STYLE: Use 1-3 relevant emojis naturally (e.g., 📍 🔎 🏢 📈 ✅) and keep tone clear and action-focused.

You have access to a Live Crowd Heatmap and can guide the user to control the map using specific natural language commands.
The frontend will detect commands wrapped in double quotes.

COMMANDS YOU MUST WRAP IN DOUBLE QUOTES:
1. Geolocation: "find my location", "where am i", "locate me".
2. Search: "search for [place]", "find [place]", "go to [place]".
3. Popular Places: "show popular places", "find popular places within 5km".
4. Business Feasibility: "open [business] in [place]" (e.g., "open cafe in Koramangala"). This will analyze the location and show a brown marker if feasible.
5. Business Planning Flow: "analyze [area]" or "start a business in [area]". This will guide them through picking a crowd intensity.
6. Form Control: "open form", "close form", "submit business info".
7. Map UI: "minimize map", "maximize map".

Be direct and helpful. Prioritize these user goals: find locations, locate user, and check business feasibility.
If a user asks a complex question, prioritize the data-driven answer and the relevant map command.
"""

def get_model():
    """
    Dynamically load model name and API key from environment.
    """
    # Refresh environment variables
    load_dotenv(dotenv_path=_ENV_PATH, override=True)
    
    api_key = os.getenv("GEMINI_API_KEY")
    model_name = os.getenv("GEMINI_MODEL_NAME", "models/gemini-2.0-flash")
    
    if not api_key:
        return None, "System Error: GEMINI_API_KEY not found in .env."
        
    try:
        genai.configure(api_key=api_key)
        # Initialize model with system instructions
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=SYSTEM_INSTRUCTION
        )
        return model, model_name
    except Exception as e:
        return None, f"System Error: Failed to initialize model '{model_name}': {str(e)}"

def get_bot_response(message, chat_session=None):
    """
    Call Gemini with history support and robust error handling.
    """
    # 1. Rule-based fallback for common greetings (Save API calls/Rate limits)
    lower_msg = message.lower().strip()
    
    # Check for direct greetings
    greetings = ["hi", "hello", "hey", "hola", "greetings", "good morning", "good afternoon"]
    if lower_msg in greetings:
        return "👋 Hi! I'm Antigravity. I can help you \"find my location\", \"search for Bangalore\", or \"open cafe in Koramangala\". What would you like to do? 📍"

    # Check for name/identity questions
    if "my name is" in lower_msg or "i am " in lower_msg:
        name_part = lower_msg.split("is")[-1].strip() if "is" in lower_msg else lower_msg.split("am")[-1].strip()
        return f"Nice to meet you, {name_part.capitalize()}! 😊 Try: \"find my location\", \"search for Indiranagar\", or \"open cafe in Koramangala\" for feasibility. 🏢"

    if "who are you" in lower_msg or "your name" in lower_msg:
        return "I'm Antigravity 🤖, your Crowd Heatmap assistant. I help you find places 📍, locate yourself 🧭, and check business feasibility 🏢."

    if "thank you" in lower_msg or "thanks" in lower_msg:
        return "You're welcome! ✅ Ask me to \"find my location\", \"search for a place\", or \"check feasibility\" anytime."

    model, config_error_or_name = get_model()
    if not model:
        return config_error_or_name
    
    model_name = config_error_or_name # for error reporting
    
    try:
        if chat_session:
            response = chat_session.send_message(message)
        else:
            response = model.generate_content(message)
        
        if not response or not response.text:
            return "I'm sorry, I couldn't generate a response. The prompt might have been blocked or the AI returned an empty result."
            
        return response.text
        
    except Exception as e:
        error_msg = str(e)
        if "404" in error_msg:
            return f"AI Error: Model '{model_name}' not found. Please verify the model name in your .env file."
        elif "429" in error_msg:
            return "AI Error: Rate limit exceeded. I'm receiving too many requests right now. Please wait a few seconds and try again, or try a simpler question."
        elif "401" in error_msg:
            return "AI Error: Invalid API key. Please check your GEMINI_API_KEY."
        return f"AI Error: {error_msg}"


class ChatConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.chat_session = None

    async def connect(self):
        await self.accept()
        # Initialize Gemini Chat Session for stateful conversation
        model, _ = await sync_to_async(get_model)()
        if model:
            self.chat_session = model.start_chat(history=[])

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            user_message = (data.get("message") or "").strip()
            
            if not user_message:
                await self.send(text_data=json.dumps({"message": "Please enter a message."}))
                return

            print(f"Chatbot [WS]: Processing message: {user_message[:30]}...")
            
            # Use the instance's chat_session to maintain history
            reply = await sync_to_async(get_bot_response)(user_message, self.chat_session)
            
            await self.send(text_data=json.dumps({"message": reply}))
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({"message": "Invalid message format."}))
        except Exception as e:
            await self.send(text_data=json.dumps({"message": f"Sorry, an unexpected error occurred: {str(e)}"}))
