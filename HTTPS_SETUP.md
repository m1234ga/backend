# HTTPS Setup Guide

The backend server is now configured to run on HTTPS by default. This guide explains how to set it up.

## Quick Start

### 1. Generate SSL Certificates

For development, you can generate self-signed certificates using one of the provided scripts:

**On Windows (PowerShell):**
```powershell
.\generate-ssl-certs.ps1
```

**On Linux/Mac (Bash):**
```bash
chmod +x generate-ssl-certs.sh
./generate-ssl-certs.sh
```

**Manual (using OpenSSL):**
```bash
mkdir ssl
openssl req -x509 -newkey rsa:4096 -nodes -keyout ssl/key.pem -out ssl/cert.pem -days 365
```

### 2. Start the Server

The server will automatically use HTTPS if SSL certificates are found in the `ssl/` directory:

- Certificate: `ssl/cert.pem`
- Private Key: `ssl/key.pem`

If certificates are not found, the server will fall back to HTTP with a warning message.

## Configuration

### Environment Variables

You can configure HTTPS behavior using the following environment variables:

#### Option 1: Full Paths (Recommended)
- `USE_HTTPS`: Set to `false` to disable HTTPS (default: `true`)
- `SSL_CERT_PATH`: Full path to SSL certificate file
- `SSL_KEY_PATH`: Full path to SSL private key file
- `FRONTEND_URL`: Frontend URL for CORS and redirects (will use HTTPS/HTTP based on server type)

#### Option 2: Filenames with Base Path
- `SSL_CERT_FILENAME`: Certificate filename (e.g., `cert.pem`)
- `SSL_KEY_FILENAME`: Private key filename (e.g., `key.pem`)
- `SSL_BASE_PATH`: Base directory path (default: `ssl/` relative to server file)

#### Priority Order
1. If `SSL_CERT_PATH` and `SSL_KEY_PATH` are set, these full paths are used
2. If `SSL_CERT_FILENAME` and `SSL_KEY_FILENAME` are set, these are combined with `SSL_BASE_PATH`
3. Otherwise, defaults to `ssl/cert.pem` and `ssl/key.pem` in the backend directory

### Example `.env` files:

**Using full paths:**
```env
USE_HTTPS=true
SSL_CERT_PATH=/path/to/your/certificate.pem
SSL_KEY_PATH=/path/to/your/private-key.pem
FRONTEND_URL=https://localhost:3000
PORT=5000
```

**Using filenames:**
```env
USE_HTTPS=true
SSL_BASE_PATH=/etc/ssl/certs
SSL_CERT_FILENAME=server.crt
SSL_KEY_FILENAME=server.key
FRONTEND_URL=https://localhost:3000
PORT=5000
```

**Using relative paths (default):**
```env
USE_HTTPS=true
SSL_CERT_PATH=ssl/cert.pem
SSL_KEY_PATH=ssl/key.pem
FRONTEND_URL=https://localhost:3000
PORT=5000
```

## Production

For production environments, use certificates from a trusted Certificate Authority (CA):

1. **Let's Encrypt** (Free): Use Certbot to obtain certificates
2. **Commercial CA**: Purchase certificates from providers like DigiCert, GlobalSign, etc.
3. **Cloud Provider**: Use managed certificates from AWS, Azure, Google Cloud, etc.

Place your production certificates in the location specified by `SSL_CERT_PATH` and `SSL_KEY_PATH`.

## Browser Warnings

When using self-signed certificates (development), browsers will show a security warning. This is expected and safe for development. You can:

- Click "Advanced" → "Proceed to localhost" (Chrome/Edge)
- Click "Advanced" → "Accept the Risk and Continue" (Firefox)

## Troubleshooting

### Server falls back to HTTP
- Check that certificate files exist at the specified paths
- Verify file permissions allow reading the certificate and key files
- Check console output for specific error messages

### CORS errors
- Ensure `FRONTEND_URL` environment variable matches your frontend URL
- Update CORS origins in `server.ts` if needed

### OpenSSL not found
- Install OpenSSL:
  - Windows: `choco install openssl` or download from [Win32OpenSSL](https://slproweb.com/products/Win32OpenSSL.html)
  - Mac: `brew install openssl`
  - Linux: `sudo apt-get install openssl` (Ubuntu/Debian) or `sudo yum install openssl` (RHEL/CentOS)

