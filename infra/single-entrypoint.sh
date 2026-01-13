#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_USER:=arkeo}"
: "${POSTGRES_PASSWORD:=arkeo}"
: "${POSTGRES_DB:=arkeo_racing}"
: "${PGDATA:=/var/lib/postgresql/data/pgdata}"
: "${ARKEOD_ENABLED:=0}"
: "${ARKEOD_REQUIRED:=0}"
: "${ARKEOD_DOWNLOAD_URL:=}"
: "${ARKEOD_HOME:=/app/data/arkeo}"
: "${ARKEOD_KEY_NAME:=arkeo-racing-hot}"
: "${ARKEOD_KEYRING_BACKEND:=test}"
: "${ARKEOD_KEYRING_PASSWORD:=}"
: "${ARKEOD_MNEMONIC:=}"
: "${ARKEOD_ENV_PATH:=/app/.env}"
: "${ARKEOD_BUILD_FROM_SOURCE:=0}"
: "${ARKEOD_SOURCE_REPO:=https://github.com/arkeonetwork/arkeo.git}"
: "${ARKEOD_SOURCE_REF:=v1.0.16}"

export PGDATA

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initializing Postgres data dir"
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  pwfile=$(mktemp)
  echo "$POSTGRES_PASSWORD" > "$pwfile"
  chown postgres:postgres "$pwfile"
  chmod 600 "$pwfile"
  gosu postgres initdb -D "$PGDATA" -U "$POSTGRES_USER" --pwfile="$pwfile" --auth=md5
  rm -f "$pwfile"
fi

ensure_pg_hba() {
  local hba="$PGDATA/pg_hba.conf"
  if [ -f "$hba" ]; then
    if ! grep -q "0.0.0.0/0" "$hba"; then
      echo "host all all 0.0.0.0/0 md5" >> "$hba"
    fi
    if ! grep -q "::/0" "$hba"; then
      echo "host all all ::/0 md5" >> "$hba"
    fi
  fi
}

ensure_pg_hba

gosu postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses='*'" -w start

resolve_arkeod_url() {
  if [ -n "$ARKEOD_DOWNLOAD_URL" ]; then
    echo "$ARKEOD_DOWNLOAD_URL"
    return 0
  fi

  case "$(uname -m)" in
    x86_64|amd64)
      echo "https://github.com/arkeonetwork/arkeo/releases/latest/download/arkeod_linux_amd64"
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_arkeod_from_source() {
  if ! command -v git >/dev/null 2>&1 || ! command -v make >/dev/null 2>&1 || ! command -v go >/dev/null 2>&1; then
    echo "arkeod source build skipped: missing git/make/go"
    return 1
  fi

  local repo ref tmpdir
  repo="$ARKEOD_SOURCE_REPO"
  ref="$ARKEOD_SOURCE_REF"
  tmpdir="$(mktemp -d)"

  echo "Building arkeod from source (${repo}@${ref})"
  if ! git clone --depth 1 --branch "$ref" "$repo" "$tmpdir"; then
    rm -rf "$tmpdir"
    echo "arkeod source clone failed"
    return 1
  fi

  export GOPATH="${ARKEOD_HOME}/go"
  export GOBIN="${ARKEOD_HOME}/bin"
  mkdir -p "$GOPATH" "$GOBIN"

  if ! (cd "$tmpdir" && make install); then
    rm -rf "$tmpdir"
    echo "arkeod source build failed"
    return 1
  fi

  rm -rf "$tmpdir"
  if [ -x "$ARKEOD_HOME/bin/arkeod" ]; then
    ln -sf "$ARKEOD_HOME/bin/arkeod" /usr/local/bin/arkeod
    return 0
  fi

  echo "arkeod source build finished without binary"
  return 1
}

ensure_arkeod() {
  if command -v arkeod >/dev/null 2>&1; then
    return 0
  fi

  mkdir -p "$ARKEOD_HOME/bin"
  if [ -x "$ARKEOD_HOME/bin/arkeod" ]; then
    ln -sf "$ARKEOD_HOME/bin/arkeod" /usr/local/bin/arkeod
    return 0
  fi

  if [ "$ARKEOD_BUILD_FROM_SOURCE" = "1" ]; then
    ensure_arkeod_from_source
    return $?
  fi

  local url
  if url="$(resolve_arkeod_url)"; then
    echo "Downloading arkeod from $url"
    local tmpfile
    tmpfile="$(mktemp)"
    if ! curl -fsSL "$url" -o "$tmpfile"; then
      rm -f "$tmpfile"
      echo "arkeod download failed"
    else
      chmod +x "$tmpfile"
      mv "$tmpfile" "$ARKEOD_HOME/bin/arkeod"
      ln -sf "$ARKEOD_HOME/bin/arkeod" /usr/local/bin/arkeod
      return 0
    fi
  else
    echo "arkeod download skipped: no URL for arch $(uname -m)"
  fi

  ensure_arkeod_from_source
}

ensure_hot_wallet() {
  mkdir -p "$ARKEOD_HOME"
  arkeod config chain-id "${ARKEO_CHAIN_ID:-}" --home "$ARKEOD_HOME" >/dev/null 2>&1 || true
  arkeod config node "${ARKEO_RPC_URL:-}" --home "$ARKEOD_HOME" >/dev/null 2>&1 || true
  arkeod config keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME" >/dev/null 2>&1 || true

  if arkeod keys show "$ARKEOD_KEY_NAME" --keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME" >/dev/null 2>&1; then
    local address
    address="$(arkeod keys show "$ARKEOD_KEY_NAME" -a --keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME")"
    echo "$address" > "$ARKEOD_HOME/${ARKEOD_KEY_NAME}.address"
    chmod 600 "$ARKEOD_HOME/${ARKEOD_KEY_NAME}.address"
    echo "Hot wallet ready: $address"
    return 0
  fi

  local mnemonic
  mnemonic="$(printf '%s' "$ARKEOD_MNEMONIC" | tr -d '\r\n')"

  write_mnemonic_to_env() {
    if [ -z "$ARKEOD_ENV_PATH" ] || [ ! -w "$ARKEOD_ENV_PATH" ]; then
      echo "Skipping .env update; ARKEOD_ENV_PATH not writable"
      return 1
    fi

    local escaped
    escaped="$(printf '%s' "$mnemonic" | sed 's/"/\\"/g')"
    if grep -q '^ARKEOD_MNEMONIC=' "$ARKEOD_ENV_PATH"; then
      sed -i.bak "s/^ARKEOD_MNEMONIC=.*/ARKEOD_MNEMONIC=\"${escaped}\"/" "$ARKEOD_ENV_PATH"
    else
      printf '\nARKEOD_MNEMONIC="%s"\n' "$escaped" >> "$ARKEOD_ENV_PATH"
    fi
  }

  local wallet_output="$ARKEOD_HOME/${ARKEOD_KEY_NAME}.txt"
  if [ -n "$mnemonic" ]; then
    if [ "$ARKEOD_KEYRING_BACKEND" = "file" ]; then
      if [ -z "$ARKEOD_KEYRING_PASSWORD" ]; then
        echo "ARKEOD_KEYRING_PASSWORD is required for file keyring backend"
        return 1
      fi
      printf '%s\n%s\n%s\n' "$ARKEOD_KEYRING_PASSWORD" "$ARKEOD_KEYRING_PASSWORD" "$mnemonic" \
        | arkeod keys add "$ARKEOD_KEY_NAME" --recover --keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME" \
        > "$wallet_output" 2>&1
    else
      printf '%s\n' "$mnemonic" \
        | arkeod keys add "$ARKEOD_KEY_NAME" --recover --keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME" \
        > "$wallet_output" 2>&1
    fi
  else
    if [ "$ARKEOD_KEYRING_BACKEND" = "file" ]; then
      if [ -z "$ARKEOD_KEYRING_PASSWORD" ]; then
        echo "ARKEOD_KEYRING_PASSWORD is required for file keyring backend"
        return 1
      fi
      printf '%s\n%s\n' "$ARKEOD_KEYRING_PASSWORD" "$ARKEOD_KEYRING_PASSWORD" \
        | arkeod keys add "$ARKEOD_KEY_NAME" --keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME" \
        > "$wallet_output" 2>&1
    else
      arkeod keys add "$ARKEOD_KEY_NAME" --keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME" \
        > "$wallet_output" 2>&1
    fi
  fi

  chmod 600 "$wallet_output"
  if [ -z "$mnemonic" ]; then
    mnemonic="$(sed -n 's/^.*mnemonic: *\"\\(.*\\)\".*/\\1/p' "$wallet_output" | head -n1)"
    if [ -z "$mnemonic" ]; then
      mnemonic="$(sed -n 's/^.*mnemonic: *//p' "$wallet_output" | head -n1)"
    fi
    if [ -z "$mnemonic" ]; then
      mnemonic="$(grep -E '^[a-z]+( [a-z]+){11,}$' "$wallet_output" | head -n1 || true)"
    fi
    if [ -n "$mnemonic" ]; then
      write_mnemonic_to_env || true
    else
      echo "Hot wallet created, but mnemonic could not be parsed for .env"
    fi
  fi
  local address
  address="$(arkeod keys show "$ARKEOD_KEY_NAME" -a --keyring-backend "$ARKEOD_KEYRING_BACKEND" --home "$ARKEOD_HOME")"
  echo "$address" > "$ARKEOD_HOME/${ARKEOD_KEY_NAME}.address"
  chmod 600 "$ARKEOD_HOME/${ARKEOD_KEY_NAME}.address"
  echo "Hot wallet created: $address"
}

if [ "$ARKEOD_ENABLED" = "1" ]; then
  if ensure_arkeod; then
    if ! ensure_hot_wallet; then
      if [ "$ARKEOD_REQUIRED" = "1" ]; then
        exit 1
      fi
      echo "Hot wallet init failed; continuing without it"
    fi
  else
    if [ "$ARKEOD_REQUIRED" = "1" ]; then
      exit 1
    fi
    echo "arkeod unavailable; continuing without hot wallet"
  fi
fi

export PGPASSWORD="$POSTGRES_PASSWORD"
if ! gosu postgres psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1; then
  gosu postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi
unset PGPASSWORD

export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}}"

cd /app/apps/api
if [ "${PRISMA_ACCEPT_DATA_LOSS:-0}" = "1" ]; then
  npm run prisma:deploy -- --accept-data-loss
else
  npm run prisma:deploy
fi
npm run db:seed

node /app/apps/api/dist/src/index.js
