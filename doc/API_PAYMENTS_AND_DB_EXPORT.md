# Pagos (BIN / MSI) y exportación directa BD

Base URL del backend: `{API_URL}` (ej. `https://tu-api.com/api` si el prefijo es `/api`).

## 1. BIN lookup (público)

**`GET {API_URL}/payments/bin-lookup?bin={digits}`**

- **bin**: al menos 6 dígitos del PAN (se normaliza a dígitos; se usan hasta 8 para la caché).
- **Respuesta 200** (ejemplo; mismo criterio que el route Next original, más campo extra):

```json
{
  "scheme": "visa",
  "brand": "Visa",
  "bankName": "BBVA",
  "country": "Mexico",
  "cardKind": "credit",
  "paymentCategory": "credito",
  "rawType": "credit",
  "prepaid": false,
  "lookupSource": "binlist",
  "indicioMsi": "probable"
}
```

- **indicioMsi**: `probable` | `sin_indicio` (heurística local por nombre de banco, igual que `msiPorBancoEmisor.ts`).

**Errores:** `400` (BIN inválido), `429` / `502` / `503` según saturación o fallo de APIs externas (mensajes en `{ "error": "..." }`).

---

## 2. MSI solo por nombre de banco (público)

**`GET {API_URL}/payments/msi-indicio?bancoEmisor={string}`**

```json
{ "indicioMsi": "probable" }
```

No llama APIs externas.

---

## 3. Export directo BD (solo admin)

**`GET {API_URL}/db/export-direct`**

- **Auth:** `Authorization: Bearer <JWT>` de usuario con rol **admin** (misma protección que el resto de `/db/*`).
- **Query:** mismos parámetros que la ruta Next `export-direct`:
  - Sin `tabla`: lista de tablas `{ "tablas": ["usuarios", ...] }`.
  - `tabla`, `formato` (`json` | `csv`), `meta`, `columnas`, `fechaDesde`, `fechaHasta`, `soloActivos`, `columna`, `valor`, etc.

**Respuesta:** JSON o archivo adjunto (`Content-Disposition: attachment`) según `formato` y rama, igual que el front.

---

## 4. Métodos de pago guardados (JWT obligatorio)

Base: `{API_URL}/payments/metodos-pago`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/payments/metodos-pago` | Lista métodos activos del usuario. Admin: `?usuarioId=` para otro usuario. |
| `GET` | `/payments/metodos-pago/:id` | Detalle (solo propietario o admin). |
| `POST` | `/payments/metodos-pago` | Registra tarjeta tokenizada (body tras pasarela). |
| `PATCH` | `/payments/metodos-pago/:id` | `esPredeterminada`, `etiqueta`. |
| `DELETE` | `/payments/metodos-pago/:id` | Baja lógica (`activo: false`). |

**Headers:** `Authorization: Bearer <JWT>`

**POST body (ejemplo):**

```json
{
  "proveedor": "mercadopago",
  "idExterno": "CARD_ID_DE_LA_PASARELA",
  "ultimos4": "5547",
  "marca": "visa",
  "bancoNombre": "Banorte",
  "expMes": 5,
  "expAnio": 2029,
  "tipoTarjeta": "credito",
  "esVirtual": false,
  "etiqueta": "Tarjeta principal",
  "esPredeterminada": true
}
```

`tipoTarjeta`: `credito` | `debito` (opcional). Si ya existía la misma terna `usuario + proveedor + idExterno` inactiva, se reactiva.

---

## Frontend (miru-franco-web)

1. Definir la URL base del API, por ejemplo:
   - `NEXT_PUBLIC_API_URL=https://tu-dominio.com/api`
2. Sustituir llamadas a:
   - `/api/bin-lookup` → `{NEXT_PUBLIC_API_URL}/payments/bin-lookup`
   - `/api/.../msi...` → `{NEXT_PUBLIC_API_URL}/payments/msi-indicio` (si se usaba aparte)
   - `/api/db/export-direct` → `{NEXT_PUBLIC_API_URL}/db/export-direct` (con Bearer admin)
3. Eliminar rutas `app/api/...` duplicadas en el repo web cuando apunten aquí.
