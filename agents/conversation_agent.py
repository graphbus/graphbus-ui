
from graphbus import graphbus_agent
from typing import Dict, List

@graphbus_agent
class ConversationAgent:
    """Manages conversation history and context"""

    def __init__(self):
        self.history: List[Dict[str, str]] = []

    def add_message(self, role: str, content: str) -> Dict:
        """Add a message to conversation history"""
        message = {"role": role, "content": content}
        self.history.append(message)
        return {"success": True, "message_count": len(self.history)}

    def get_history(self, limit: int = 10) -> List[Dict[str, str]]:
        """Get recent conversation history"""
        return self.history[-limit:]

    def clear_history(self) -> Dict:
        """Clear conversation history"""
        count = len(self.history)
        self.history = []
        return {"success": True, "cleared_count": count}
