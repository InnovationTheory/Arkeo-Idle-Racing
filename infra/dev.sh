#!/bin/bash
# Local development script for Arkeo Racing

set -e
cd "$(dirname "$0")"

# Ensure data directories exist
mkdir -p config/postgres-data
mkdir -p config/subscriber-data

case "${1:-up}" in
  up)
    docker compose down
    docker compose build
    docker compose up
    ;;
  rebuild)
    docker compose down
    docker compose build --no-cache
    docker compose up
    ;;
  down)
    docker compose down
    ;;
  logs)
    docker compose logs -f
    ;;
  restart)
    docker compose restart
    ;;
  *)
    echo "Usage: ./dev.sh [up|rebuild|down|logs|restart]"
    echo "  up      - Build and start (default)"
    echo "  rebuild - Full rebuild with --no-cache"
    echo "  down    - Stop containers"
    echo "  logs    - Follow logs"
    echo "  restart - Restart containers"
    ;;
esac
