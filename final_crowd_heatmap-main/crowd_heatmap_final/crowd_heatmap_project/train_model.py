import pandas as pd
from sklearn.tree import DecisionTreeClassifier
import pickle

# load dataset
df = pd.read_csv("business_dataset.csv")

X = df[["crowd","shops","area"]]
y = df["business"]

# convert text to numbers
X = pd.get_dummies(X)

model = DecisionTreeClassifier()
model.fit(X, y)

# save model
pickle.dump(model, open("business_model.pkl","wb"))

print("Model trained successfully")
