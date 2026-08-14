"""
Endpoints de planes y suscripción (paywall del dashboard).
"""
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import Plan
from .auth_views import get_or_create_store_for
from .billing import subscription_summary

logger = logging.getLogger(__name__)


class PlansView(APIView):
    """
    GET /api/billing/plans/ — planes públicos (landing y paywall).
    """
    permission_classes = [AllowAny]

    def get(self, request):
        plans = Plan.objects.filter(is_active=True).order_by('display_order')
        return Response([
            {
                'code': p.code,
                'name': p.name,
                'price_cop': float(p.price_cop),
                'conversation_limit': p.conversation_limit,
                'features': p.features,
            }
            for p in plans
        ])


class SubscriptionView(APIView):
    """
    GET /api/billing/subscription/ — estado de la suscripción de MI tienda:
    plan, status, trial restante, conversaciones usadas vs límite.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        store = get_or_create_store_for(request.user)
        summary = subscription_summary(store)
        if summary is None:
            return Response({'error': 'Planes no configurados'}, status=503)
        return Response(summary)
