import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer


@database_sync_to_async
def _user_owns_store(user, store_id):
    from .models import Store

    if not user or not user.is_authenticated:
        return False
    try:
        return Store.objects.filter(id=store_id, owner=user).exists()
    except (ValueError, TypeError):
        return False


class StoreDashboardConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.store_id = self.scope['url_route']['kwargs']['store_id']
        self.room_group_name = f'store_{self.store_id}'

        user = self.scope.get('user')
        allowed = await _user_owns_store(user, self.store_id)
        if not allowed:
            await self.close(code=4401)
            return

        # Unirse al grupo de la tienda
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        if not hasattr(self, 'room_group_name'):
            return
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    # Recibir evento desde el backend (cuando llega un pedido o mensaje)
    async def order_update(self, event):
        message = event['message']
        # Enviar al WebSocket del frontend
        await self.send(text_data=json.dumps({
            'type': 'ORDER_UPDATE',
            'payload': message
        }))
