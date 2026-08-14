from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from . import views
from . import auth_views
from . import whatsapp_views
from . import telegram_views
from . import billing_views
from . import reports_views
from . import staff_views
from . import data_deletion_views

router = DefaultRouter()
router.register(r'stores', views.StoreViewSet)
router.register(r'categories', views.CategoryViewSet)
router.register(r'products', views.ProductViewSet)
router.register(r'orders', views.OrderViewSet)
router.register(r'customers', views.CustomerViewSet)

urlpatterns = [
    path('api/', include(router.urls)),
    path('api/webhook/whatsapp/', views.WhatsAppWebhookView.as_view(), name='whatsapp_webhook'),
    path('api/webhook/telegram/', telegram_views.TelegramWebhookView.as_view(), name='telegram_webhook'),
    path('api/webhook/telegram/<str:secret>/', telegram_views.TelegramWebhookView.as_view(), name='telegram_webhook_store'),
    path('api/webhook/payment/', views.PaymentWebhookView.as_view(), name='payment_webhook'),

    # Menú por foto con IA
    path('api/menu/extract/', views.MenuExtractView.as_view(), name='menu_extract'),
    path('api/menu/confirm/', views.MenuConfirmView.as_view(), name='menu_confirm'),

    # Menú digital (imagen que el bot envía al cliente)
    path('api/menu/image/', views.MenuImageView.as_view(), name='menu_image'),
    path('api/menu/image/upload/', views.MenuImageUploadView.as_view(), name='menu_image_upload'),
    path('api/menu/image/background/', views.MenuBackgroundView.as_view(), name='menu_image_background'),

    # Billing (planes y suscripción)
    path('api/billing/plans/', billing_views.PlansView.as_view(), name='billing_plans'),
    path('api/billing/subscription/', billing_views.SubscriptionView.as_view(), name='billing_subscription'),

    # Reportes del comercio (ventas, más vendidos, embudo) y exportación
    path('api/reports/summary/', reports_views.ReportSummaryView.as_view(), name='report_summary'),
    path('api/reports/orders.csv/', reports_views.ReportOrdersCSVView.as_view(), name='report_orders_csv'),
    
    # Panel administrativo interno (equipo DILO — roles dilo_admin/soporte/lectura)
    path('api/staff/login/', staff_views.StaffLoginView.as_view(), name='staff_login'),
    path('api/staff/login/verify/', staff_views.StaffLoginVerifyView.as_view(), name='staff_login_verify'),
    path('api/staff/me/', staff_views.StaffMeView.as_view(), name='staff_me'),
    path('api/staff/overview/', staff_views.StaffOverviewView.as_view(), name='staff_overview'),
    path('api/staff/stores/', staff_views.StaffStoreListView.as_view(), name='staff_stores'),
    path('api/staff/stores/<uuid:store_id>/', staff_views.StaffStoreDetailView.as_view(), name='staff_store_detail'),
    path('api/staff/stores/<uuid:store_id>/subscription/', staff_views.StaffSubscriptionChangeView.as_view(), name='staff_store_subscription'),
    path('api/staff/stores/<uuid:store_id>/customers/', staff_views.StaffStoreCustomersView.as_view(), name='staff_store_customers'),
    path('api/staff/impersonate/', staff_views.StaffImpersonateView.as_view(), name='staff_impersonate'),
    path('api/staff/audit/', staff_views.StaffAuditLogView.as_view(), name='staff_audit'),

    # Auth endpoints
    path('api/auth/register/', auth_views.RegisterView.as_view(), name='auth_register'),
    path('api/auth/verify/', auth_views.VerifyOTPView.as_view(), name='auth_verify'),
    path('api/auth/login/', auth_views.LoginView.as_view(), name='auth_login'),
    path('api/auth/refresh/', TokenRefreshView.as_view(), name='auth_refresh'),
    path('api/auth/me/', auth_views.MeView.as_view(), name='auth_me'),
    path('api/auth/resend-otp/', auth_views.ResendOTPView.as_view(), name='auth_resend_otp'),
    path('api/auth/google/', auth_views.GoogleLoginView.as_view(), name='auth_google'),
    path('api/auth/delete-account/', data_deletion_views.DeleteMyAccountView.as_view(), name='auth_delete_account'),

    # Contraseña olvidada y cambio de correo (enlace de un solo uso por email)
    path('api/auth/password-reset/', auth_views.PasswordResetRequestView.as_view(), name='auth_password_reset'),
    path('api/auth/password-reset/confirm/', auth_views.PasswordResetConfirmView.as_view(), name='auth_password_reset_confirm'),
    path('api/auth/email-change/', auth_views.EmailChangeRequestView.as_view(), name='auth_email_change'),
    path('api/auth/email-change/confirm/', auth_views.EmailChangeConfirmView.as_view(), name='auth_email_change_confirm'),

    # Eliminación de datos (requisito de Meta para aprobar la app)
    path('api/meta/data-deletion/', data_deletion_views.MetaDataDeletionCallbackView.as_view(), name='meta_data_deletion'),
    path('api/meta/data-deletion/status/', data_deletion_views.DataDeletionStatusView.as_view(), name='meta_data_deletion_status'),


    # Telegram connect endpoints (bot por tienda)
    path('api/telegram/connect/', telegram_views.TelegramConnectView.as_view(), name='telegram_connect'),
    path('api/telegram/status/', telegram_views.TelegramStatusView.as_view(), name='telegram_status'),
    path('api/telegram/disconnect/', telegram_views.TelegramDisconnectView.as_view(), name='telegram_disconnect'),

    # WhatsApp Embedded Signup endpoints
    path('api/whatsapp/token-exchange/', whatsapp_views.WhatsAppTokenExchangeView.as_view(), name='whatsapp_token_exchange'),
    path('api/whatsapp/disconnect/', whatsapp_views.WhatsAppDisconnectView.as_view(), name='whatsapp_disconnect'),
    path('api/whatsapp/status/', whatsapp_views.WhatsAppStatusView.as_view(), name='whatsapp_status'),
    path('api/whatsapp/templates/', whatsapp_views.WhatsAppTemplatesView.as_view(), name='whatsapp_templates'),
]