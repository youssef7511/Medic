#!/bin/bash
# Start all services with docker-compose
cd /app

# Check if docker-compose is available
if ! command -v docker compose &> /dev/null; then
    echo "docker compose could not be found, trying docker-compose..."
    if ! command -v docker-compose &> /dev/null; then
        echo "ERROR: Neither 'docker compose' nor 'docker-compose' found"
        exit 1
    fi
fi

# Pull images and start services
docker compose up -d --build

echo "Services started:"
echo "  - App: http://localhost:3000"
echo "  - PostgreSQL: localhost:5432"
echo "  - MinIO Console: http://localhost:9001"
echo "  - MinIO API: http://localhost:9000"
echo ""
echo "To view logs: docker compose logs -f"
echo "To stop: docker compose down"