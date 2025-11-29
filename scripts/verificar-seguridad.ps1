# Script de Verificación Rápida de Seguridad (PowerShell)
# Ejecutar: .\scripts\verificar-seguridad.ps1

Write-Host "🔍 Verificación de Seguridad - Backend Miru" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$PASSED = 0
$FAILED = 0

function Check {
    param([string]$Message, [bool]$Result)
    
    if ($Result) {
        Write-Host "✅ $Message" -ForegroundColor Green
        $script:PASSED++
    } else {
        Write-Host "❌ $Message" -ForegroundColor Red
        $script:FAILED++
    }
}

# 1. Verificar que el código de validación existe
Write-Host "1. Verificando código de validación..." -ForegroundColor Yellow
$sanitizeExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "sanitizeInput" -Quiet
Check "sanitizeInput() existe" $sanitizeExists

$sqlInjectionExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "containsSQLInjection" -Quiet
Check "containsSQLInjection() existe" $sqlInjectionExists

# 2. Verificar bcrypt
Write-Host ""
Write-Host "2. Verificando hash de contraseñas..." -ForegroundColor Yellow
$bcryptExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "bcrypt\.hash" -Quiet
Check "bcrypt.hash() está siendo usado" $bcryptExists

# 3. Verificar validador de contraseñas
Write-Host ""
Write-Host "3. Verificando validador de contraseñas..." -ForegroundColor Yellow
$passwordValidatorExists = Test-Path "src/common/validators/password.validator.ts"
Check "password.validator.ts existe" $passwordValidatorExists

if ($passwordValidatorExists) {
    $minLengthExists = Get-Content "src/common/validators/password.validator.ts" | Select-String -Pattern "@MinLength\(8" -Quiet
    Check "Longitud mínima de 8 caracteres configurada" $minLengthExists
}

# 4. Verificar protección contra fuerza bruta
Write-Host ""
Write-Host "4. Verificando protección contra fuerza bruta..." -ForegroundColor Yellow
$recordFailedExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "recordFailedLoginAttempt" -Quiet
Check "recordFailedLoginAttempt() existe" $recordFailedExists

$isAccountLockedExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "isAccountLocked" -Quiet
Check "isAccountLocked() existe" $isAccountLockedExists

# 5. Verificar JWT
Write-Host ""
Write-Host "5. Verificando JWT..." -ForegroundColor Yellow
$jwtServiceExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "JwtService" -Quiet
Check "JwtService está siendo usado" $jwtServiceExists

$expiresInExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "expiresIn" -Quiet
Check "Expiración de tokens configurada" $expiresInExists

# 6. Verificar revocación de tokens
Write-Host ""
Write-Host "6. Verificando revocación de tokens..." -ForegroundColor Yellow
$revokeTokenExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "revokeToken" -Quiet
Check "revokeToken() existe" $revokeTokenExists

$isTokenRevokedExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "isTokenRevoked" -Quiet
Check "isTokenRevoked() existe" $isTokenRevokedExists

# 7. Verificar headers de seguridad
Write-Host ""
Write-Host "7. Verificando headers de seguridad..." -ForegroundColor Yellow
$xContentTypeExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "X-Content-Type-Options" -Quiet
Check "X-Content-Type-Options configurado" $xContentTypeExists

$xFrameExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "X-Frame-Options" -Quiet
Check "X-Frame-Options configurado" $xFrameExists

$hstsExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "Strict-Transport-Security" -Quiet
Check "Strict-Transport-Security configurado" $hstsExists

# 8. Verificar logging seguro
Write-Host ""
Write-Host "8. Verificando logging seguro..." -ForegroundColor Yellow
$sanitizeLoggingExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "sanitizeForLogging" -Quiet
Check "sanitizeForLogging() existe" $sanitizeLoggingExists

# 9. Verificar rate limiting
Write-Host ""
Write-Host "9. Verificando rate limiting..." -ForegroundColor Yellow
$rateLimitExists = Test-Path "src/common/guards/rate-limit.guard.ts"
Check "rate-limit.guard.ts existe" $rateLimitExists

# 10. Verificar sesiones expiradas
Write-Host ""
Write-Host "10. Verificando sesiones expiradas por inactividad..." -ForegroundColor Yellow
$inactivityExists = Get-ChildItem -Path src -Recurse -Filter *.ts | Select-String -Pattern "INACTIVITY_TIMEOUT" -Quiet
Check "INACTIVITY_TIMEOUT configurado" $inactivityExists

# 11. Verificar OAuth
Write-Host ""
Write-Host "11. Verificando OAuth..." -ForegroundColor Yellow
$googleStrategyExists = Test-Path "src/auth/strategies/google.strategy.ts"
Check "Google OAuth strategy existe" $googleStrategyExists

# 12. Verificar CSRF (parcial)
Write-Host ""
Write-Host "12. Verificando CSRF (parcial)..." -ForegroundColor Yellow
$csrfGuardExists = Test-Path "src/common/guards/csrf.guard.ts"
Check "csrf.guard.ts existe (⚠️ necesita activación)" $csrfGuardExists

# 13. Verificar RBAC (parcial)
Write-Host ""
Write-Host "13. Verificando RBAC (parcial)..." -ForegroundColor Yellow
$rolesGuardExists = Test-Path "src/common/guards/roles.guard.ts"
Check "roles.guard.ts existe (⚠️ necesita endpoints admin)" $rolesGuardExists

# Resumen
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📊 Resumen:" -ForegroundColor Cyan
Write-Host "✅ Pasados: $PASSED" -ForegroundColor Green
Write-Host "❌ Fallidos: $FAILED" -ForegroundColor Red
Write-Host ""

if ($FAILED -eq 0) {
    Write-Host "🎉 ¡Todo el código de seguridad está presente!" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  Nota: Esto solo verifica que el código existe." -ForegroundColor Yellow
    Write-Host "   Para verificar que funciona, usa la guía:" -ForegroundColor Yellow
    Write-Host "   GUIA_VERIFICACION_IMPLEMENTACION.md" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  Algunos elementos faltan. Revisa los errores arriba." -ForegroundColor Yellow
}

