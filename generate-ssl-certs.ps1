# PowerShell script to generate self-signed SSL certificates for development
# Usage: .\generate-ssl-certs.ps1

$sslDir = "ssl"
$certFile = Join-Path $sslDir "cert.pem"
$keyFile = Join-Path $sslDir "key.pem"

# Create ssl directory if it doesn't exist
if (-not (Test-Path $sslDir)) {
    New-Item -ItemType Directory -Path $sslDir | Out-Null
}

# Check if OpenSSL is installed
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $opensslPath) {
    Write-Host "❌ OpenSSL is not installed. Please install OpenSSL first." -ForegroundColor Red
    Write-Host "   You can install it via:" -ForegroundColor Yellow
    Write-Host "   - Chocolatey: choco install openssl" -ForegroundColor Yellow
    Write-Host "   - Or download from: https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Yellow
    exit 1
}

# Generate self-signed certificate
Write-Host "🔐 Generating self-signed SSL certificate..." -ForegroundColor Cyan

$opensslArgs = @(
    "req",
    "-x509",
    "-newkey", "rsa:4096",
    "-nodes",
    "-keyout", $keyFile,
    "-out", $certFile,
    "-days", "365",
    "-subj", "/C=US/ST=State/L=City/O=Organization/CN=localhost"
)

& openssl $opensslArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ SSL certificates generated successfully!" -ForegroundColor Green
    Write-Host "   Certificate: $certFile" -ForegroundColor Green
    Write-Host "   Private Key: $keyFile" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  Note: These are self-signed certificates for development only." -ForegroundColor Yellow
    Write-Host "   Your browser will show a security warning. You can safely proceed." -ForegroundColor Yellow
    Write-Host "   For production, use certificates from a trusted CA (e.g., Let's Encrypt)." -ForegroundColor Yellow
} else {
    Write-Host "❌ Failed to generate SSL certificates" -ForegroundColor Red
    exit 1
}

