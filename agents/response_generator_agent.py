
from graphbus import graphbus_agent, depends_on, invoke
from typing import Dict

@graphbus_agent
@depends_on("ConversationAgent", "IntentClassifierAgent")
class ResponseGeneratorAgent:
    """Generates responses based on intent and context"""

    def generate_response(self, message: str) -> Dict:
        """Generate a response to user message"""
        # Get intent
        intent_result = invoke("IntentClassifierAgent", "classify_intent", message=message)
        intent = intent_result.get("intent", "unknown")

        # Generate appropriate response
        responses = {
            "greeting": "Hello! How can I help you today?",
            "farewell": "Goodbye! Have a great day!",
            "question": "That's an interesting question. Let me think about that...",
            "statement": "I understand. Tell me more!"
        }

        response_text = responses.get(intent, "I'm not sure how to respond to that.")

        # Add to conversation history
        invoke("ConversationAgent", "add_message", role="user", content=message)
        invoke("ConversationAgent", "add_message", role="assistant", content=response_text)

        return {
            "response": response_text,
            "intent": intent,
            "confidence": intent_result.get("confidence", 0.0)
        }
