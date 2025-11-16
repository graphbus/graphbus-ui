
from graphbus import graphbus_agent, depends_on
from typing import Dict

@graphbus_agent
@depends_on("ConversationAgent")
class IntentClassifierAgent:
    """Classifies user intent from messages"""

    def classify_intent(self, message: str) -> Dict:
        """Classify the intent of a user message"""
        message_lower = message.lower()

        # Simple keyword-based classification
        if any(word in message_lower for word in ["hello", "hi", "hey"]):
            return {"intent": "greeting", "confidence": 0.9}
        elif any(word in message_lower for word in ["bye", "goodbye", "see you"]):
            return {"intent": "farewell", "confidence": 0.9}
        elif "?" in message:
            return {"intent": "question", "confidence": 0.7}
        else:
            return {"intent": "statement", "confidence": 0.6}
