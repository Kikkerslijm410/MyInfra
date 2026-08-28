FROM python:alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apk update && \
    apk upgrade

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY wsgi.py .
COPY app ./app

EXPOSE 5000
CMD ["gunicorn", "-w", "2", "--threads", "4", "--worker-class", "gthread", "-b", "0.0.0.0:5000", "wsgi:app"]
