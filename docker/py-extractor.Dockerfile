FROM python:3.12-slim

WORKDIR /app
COPY docker/py-extractor/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY docker/py-extractor/app.py app.py

EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]