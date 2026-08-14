"""Tests de las funciones puras del bot — sin DB, sin red, sin LLM.

Cubren la logica que protege el DINERO: clasificador de metodo de pago, red
anti-fraude que redacta numeros de pago inventados, saneo de tokens de control
del LLM, y el clasificador de 'si' para reutilizar direccion.
"""
from types import SimpleNamespace

import pytest

from orders.bot_engine import WhatsAppBotEngine
from orders.services.menu_extractor import normalize_product_name


# ---------- _match_payment_method ----------

@pytest.mark.parametrize("text,expected", [
    ("nequi", "NEQUI"),
    ("te transfiero", "NEQUI"),
    ("por daviplata", "NEQUI"),
    ("1", "NEQUI"),
    ("efectivo", "CASH"),
    ("Tengo cash querida", "CASH"),
    ("Money billete sobre billete", "CASH"),
    ("contra entrega", "CASH"),
    ("2", "CASH"),
    # substring de digito NO debe clasificar (bug historico '1' in "100")
    ("un billete de 100", "CASH"),   # cash por 'billete', no por el 1
    ("pago 100", None),              # solo un numero, sin palabra clave
    ("nequi o efectivo?", None),     # ambiguo -> re-preguntar
    ("hola", None),
])
def test_match_payment_method(text, expected):
    assert WhatsAppBotEngine._match_payment_method(text) == expected


# ---------- _is_affirmative ----------

@pytest.mark.parametrize("text", ["si", "sí", "SI", "dale", "la misma", "ok", "perfecto"])
def test_is_affirmative_true(text):
    assert WhatsAppBotEngine._is_affirmative(text) is True


@pytest.mark.parametrize("text", [
    "Calle 45 # 12-30 apto 201",   # una direccion JAMAS es un 'si'
    "no",
    "otra direccion",
    "",
])
def test_is_affirmative_false(text):
    assert WhatsAppBotEngine._is_affirmative(text) is False


# ---------- _sanitize_output ----------

def test_sanitize_strips_control_tokens():
    dirty = "<|channel|>analysis<|message|>pienso...<|channel|>final<|message|>Hola, tu pedido va."
    clean = WhatsAppBotEngine._sanitize_output(dirty)
    assert "Hola, tu pedido va." in clean
    assert "<|" not in clean
    assert "analysis" not in clean


def test_sanitize_empty():
    assert WhatsAppBotEngine._sanitize_output("") == ""


# ---------- _redact_payment_leak (ANTI-FRAUDE) ----------

def _engine_with(payment_instructions):
    """Construye un self falso: la funcion solo toca self.store y self.order."""
    fake = SimpleNamespace(
        store=SimpleNamespace(payment_instructions=payment_instructions),
        order=SimpleNamespace(id="ORD-TEST"),
    )
    return fake


def test_redact_blocks_invented_number():
    fake = _engine_with("Nequi al 3001112233")
    leaked = "Paga al 3009998888 por favor"  # numero NO autorizado
    out = WhatsAppBotEngine._redact_payment_leak(fake, leaked)
    assert "3009998888" not in out
    assert "3001112233" in out  # entrega el numero REAL


def test_redact_allows_authorized_number():
    fake = _engine_with("Nequi al 3001112233")
    ok = "Recuerda pagar al 3001112233"  # numero autorizado -> intacto
    out = WhatsAppBotEngine._redact_payment_leak(fake, ok)
    assert out == ok


def test_redact_no_numbers_passthrough():
    fake = _engine_with("Nequi al 3001112233")
    txt = "Gracias por tu compra!"
    assert WhatsAppBotEngine._redact_payment_leak(fake, txt) == txt


# ---------- normalize_product_name ----------

def test_normalize_product_name_dedupe():
    assert normalize_product_name("Hamburguesa Clásica") == normalize_product_name("hamburguesa clasica")
    assert normalize_product_name("  Pizza!! ") == normalize_product_name("pizza")
