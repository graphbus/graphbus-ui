from graphbus import graphbus_agent, subscribe
from typing import Dict, List, Set

@graphbus_agent(name="RoomManager")
class RoomManager:
    """Manages chat rooms and their members"""
    
    def __init__(self):
        self.rooms: Dict[str, Set[str]] = {}  # room_id -> set of user_ids
        
    def create_room(self, room_id: str) -> dict:
        """Create a new chat room"""
        if room_id in self.rooms:
            return {"success": False, "error": "Room already exists"}
        self.rooms[room_id] = set()
        return {"success": True, "room_id": room_id}
    
    def join_room(self, room_id: str, user_id: str) -> dict:
        """Add user to a room"""
        if room_id not in self.rooms:
            self.rooms[room_id] = set()
        self.rooms[room_id].add(user_id)
        return {"success": True, "room_id": room_id, "user_id": user_id, "member_count": len(self.rooms[room_id])}
    
    def leave_room(self, room_id: str, user_id: str) -> dict:
        """Remove user from a room"""
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            self.rooms[room_id].remove(user_id)
            return {"success": True}
        return {"success": False, "error": "User not in room"}
    
    def get_room_members(self, room_id: str) -> List[str]:
        """Get all members in a room"""
        return list(self.rooms.get(room_id, set()))
    
    def list_rooms(self) -> List[dict]:
        """List all active rooms"""
        return [{"room_id": room_id, "member_count": len(members)} for room_id, members in self.rooms.items()]
