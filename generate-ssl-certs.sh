#!/bin/bash

# Script to generate self-signed SSL certificates for development
# Usage: ./generate-ssl-certs.sh

SSL_DIR="ssl"
CERT_FILE="$SSL_DIR/cert.pem"
KEY_FILE="$SSL_DIR/key.pem"

# Create ssl directory if it doesn't exist
mkdir -p "$SSL_DIR"

# Check if OpenSSL is installed
if ! command -v openssl &> /dev/null; then
    echo "❌ OpenSSL is not installed. Please install OpenSSL first."
    echo "   On Windows, you can install it via:"
    echo "   - Chocolatey: choco install openssl"
    echo "   - Or download from: https://slproweb.com/products/Win32OpenSSL.html"
    exit 1
fi

# Generate self-signed certificate
echo "🔐 Generating self-signed SSL certificate..."
openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 365 \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

if [ $? -eq 0 ]; then
    echo "✅ SSL certificates generated successfully!"
    echo "   Certificate: $CERT_FILE"
    echo "   Private Key: $KEY_FILE"
    echo ""
    echo "⚠️  Note: These are self-signed certificates for development only."
    echo "   Your browser will show a security warning. You can safely proceed."
    echo "   For production, use certificates from a trusted CA (e.g., Let's Encrypt)."
else
    echo "❌ Failed to generate SSL certificates"
    exit 1
fi

