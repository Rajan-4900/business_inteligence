import google.generativeai as genai

genai.configure(api_key="AIzaSyBPlfFZmqBQbxpeO9rYzsf6E4ScSPDlf4Y")

print("Available models:\n")

for m in genai.list_models():
    print(m.name, " -> supports:", m.supported_generation_methods)
