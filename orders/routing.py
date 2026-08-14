from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/store/(?P<store_id>[^/]+)/$', consumers.StoreDashboardConsumer.as_asgi()),
]