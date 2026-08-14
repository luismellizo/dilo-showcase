FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libpq-dev gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python manage.py collectstatic --noinput

EXPOSE 8000

# Rol del contenedor via CONTAINER_ROLE (web | worker | beat) — permite usar
# la MISMA imagen para Daphne, Celery worker y Celery beat (apps separadas en
# el PaaS o servicios del compose). Default: web (migra y sirve).
CMD ["sh", "-c", "\
  if [ \"$CONTAINER_ROLE\" = \"worker\" ]; then \
    exec python -m celery -A whatsapp_orders worker -l info; \
  elif [ \"$CONTAINER_ROLE\" = \"beat\" ]; then \
    exec python -m celery -A whatsapp_orders beat -l info; \
  else \
    python manage.py migrate --noinput && \
    exec python -m daphne -b 0.0.0.0 -p 8000 whatsapp_orders.asgi:application; \
  fi"]
