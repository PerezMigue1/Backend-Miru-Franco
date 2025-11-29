#!/bin/bash

# Script de Verificación Rápida de Seguridad
# Ejecutar: bash scripts/verificar-seguridad.sh

echo "🔍 Verificación de Seguridad - Backend Miru"
echo "=========================================="
echo ""

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Variables
API_URL="${API_URL:-http://localhost:3000}"
PASSED=0
FAILED=0

# Función para verificar
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ $1${NC}"
        ((FAILED++))
    fi
}

# 1. Verificar que el código de validación existe
echo "1. Verificando código de validación..."
if grep -r "sanitizeInput" src/ > /dev/null 2>&1; then
    check "sanitizeInput() existe"
else
    check "sanitizeInput() NO existe"
fi

if grep -r "containsSQLInjection" src/ > /dev/null 2>&1; then
    check "containsSQLInjection() existe"
else
    check "containsSQLInjection() NO existe"
fi

# 2. Verificar bcrypt
echo ""
echo "2. Verificando hash de contraseñas..."
if grep -r "bcrypt.hash" src/ > /dev/null 2>&1; then
    check "bcrypt.hash() está siendo usado"
else
    check "bcrypt.hash() NO está siendo usado"
fi

# 3. Verificar validador de contraseñas
echo ""
echo "3. Verificando validador de contraseñas..."
if [ -f "src/common/validators/password.validator.ts" ]; then
    check "password.validator.ts existe"
    if grep -q "@MinLength(8" src/common/validators/password.validator.ts; then
        check "Longitud mínima de 8 caracteres configurada"
    fi
else
    check "password.validator.ts NO existe"
fi

# 4. Verificar protección contra fuerza bruta
echo ""
echo "4. Verificando protección contra fuerza bruta..."
if grep -r "recordFailedLoginAttempt" src/ > /dev/null 2>&1; then
    check "recordFailedLoginAttempt() existe"
else
    check "recordFailedLoginAttempt() NO existe"
fi

if grep -r "isAccountLocked" src/ > /dev/null 2>&1; then
    check "isAccountLocked() existe"
else
    check "isAccountLocked() NO existe"
fi

# 5. Verificar JWT
echo ""
echo "5. Verificando JWT..."
if grep -r "JwtService" src/ > /dev/null 2>&1; then
    check "JwtService está siendo usado"
else
    check "JwtService NO está siendo usado"
fi

if grep -r "expiresIn" src/ > /dev/null 2>&1; then
    check "Expiración de tokens configurada"
else
    check "Expiración de tokens NO configurada"
fi

# 6. Verificar revocación de tokens
echo ""
echo "6. Verificando revocación de tokens..."
if grep -r "revokeToken" src/ > /dev/null 2>&1; then
    check "revokeToken() existe"
else
    check "revokeToken() NO existe"
fi

if grep -r "isTokenRevoked" src/ > /dev/null 2>&1; then
    check "isTokenRevoked() existe"
else
    check "isTokenRevoked() NO existe"
fi

# 7. Verificar headers de seguridad
echo ""
echo "7. Verificando headers de seguridad..."
if grep -r "X-Content-Type-Options" src/ > /dev/null 2>&1; then
    check "X-Content-Type-Options configurado"
else
    check "X-Content-Type-Options NO configurado"
fi

if grep -r "X-Frame-Options" src/ > /dev/null 2>&1; then
    check "X-Frame-Options configurado"
else
    check "X-Frame-Options NO configurado"
fi

if grep -r "Strict-Transport-Security" src/ > /dev/null 2>&1; then
    check "Strict-Transport-Security configurado"
else
    check "Strict-Transport-Security NO configurado"
fi

# 8. Verificar logging seguro
echo ""
echo "8. Verificando logging seguro..."
if grep -r "sanitizeForLogging" src/ > /dev/null 2>&1; then
    check "sanitizeForLogging() existe"
else
    check "sanitizeForLogging() NO existe"
fi

# 9. Verificar rate limiting
echo ""
echo "9. Verificando rate limiting..."
if [ -f "src/common/guards/rate-limit.guard.ts" ]; then
    check "rate-limit.guard.ts existe"
else
    check "rate-limit.guard.ts NO existe"
fi

# 10. Verificar sesiones expiradas
echo ""
echo "10. Verificando sesiones expiradas por inactividad..."
if grep -r "INACTIVITY_TIMEOUT" src/ > /dev/null 2>&1; then
    check "INACTIVITY_TIMEOUT configurado"
else
    check "INACTIVITY_TIMEOUT NO configurado"
fi

# 11. Verificar OAuth
echo ""
echo "11. Verificando OAuth..."
if [ -f "src/auth/strategies/google.strategy.ts" ]; then
    check "Google OAuth strategy existe"
else
    check "Google OAuth strategy NO existe"
fi

# 12. Verificar CSRF (parcial)
echo ""
echo "12. Verificando CSRF (parcial)..."
if [ -f "src/common/guards/csrf.guard.ts" ]; then
    check "csrf.guard.ts existe (⚠️ necesita activación)"
else
    check "csrf.guard.ts NO existe"
fi

# 13. Verificar RBAC (parcial)
echo ""
echo "13. Verificando RBAC (parcial)..."
if [ -f "src/common/guards/roles.guard.ts" ]; then
    check "roles.guard.ts existe (⚠️ necesita endpoints admin)"
else
    check "roles.guard.ts NO existe"
fi

# Resumen
echo ""
echo "=========================================="
echo "📊 Resumen:"
echo -e "${GREEN}✅ Pasados: $PASSED${NC}"
echo -e "${RED}❌ Fallidos: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 ¡Todo el código de seguridad está presente!${NC}"
    echo ""
    echo "⚠️  Nota: Esto solo verifica que el código existe."
    echo "   Para verificar que funciona, usa la guía:"
    echo "   GUIA_VERIFICACION_IMPLEMENTACION.md"
else
    echo -e "${YELLOW}⚠️  Algunos elementos faltan. Revisa los errores arriba.${NC}"
fi

