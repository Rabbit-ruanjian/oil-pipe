FROM python:3.11-slim

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

WORKDIR /app

# Install system dependencies (bypass proxy to avoid 502 from debian repos)
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set proxy only for pip / runtime (after apt-get)
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Clear proxy for runtime (connections go through Docker network)
ENV HTTP_PROXY=
ENV HTTPS_PROXY=

# Expose port
EXPOSE 8100

# Run the application
CMD ["python", "main.py"]
