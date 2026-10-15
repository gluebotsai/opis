FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py embeddings.py extract_pdf.py extract_text.py formatter.py structure.py ./
EXPOSE 8040
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8040"]
