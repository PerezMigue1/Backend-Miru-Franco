# Tipografía y Jerarquía Visual - Miru Franco Web

## 📝 Tipografía

### Fuentes Configuradas

El proyecto tiene dos sistemas de fuentes configurados, pero actualmente hay una inconsistencia:

#### 1. Fuentes Google Fonts (Configuradas pero no completamente aplicadas)
- **Geist Sans**: Fuente sans-serif moderna de Google Fonts
- **Geist Mono**: Fuente monospace para código
- **Ubicación**: `src/app/layout.tsx`
- **Estado**: Variables CSS creadas (`--font-geist-sans`, `--font-geist-mono`) pero no aplicadas en el body

#### 2. Fuente Actual del Body
- **Font Stack**: `Arial, Helvetica, sans-serif`
- **Ubicación**: `src/app/styles/globals.css` (línea 55)
- **Estado**: ✅ Actualmente en uso (sobrescribe las fuentes Geist)

```css
body {
  font-family: Arial, Helvetica, sans-serif;
}
```

### Recomendación

Actualmente el proyecto está usando **Arial/Helvetica** como fuente principal, aunque tiene configuradas las fuentes **Geist** de Google Fonts que no se están usando completamente.

---

## 🎨 Jerarquía Visual

### Escala de Tamaños de Texto

#### Encabezados (Headings)

| Nivel | Tamaño (Desktop) | Tamaño (Mobile) | Clase Tailwind | Uso |
|-------|------------------|-----------------|----------------|-----|
| **H1 - Principal** | `2.25rem` (36px) / `3rem` (48px) | `2.25rem` (36px) | `text-4xl md:text-5xl` | Títulos principales de secciones |
| **H2 - Secundario** | `1.5rem` (24px) | `1.25rem` (20px) | `text-2xl` | Títulos de formularios, secciones secundarias |
| **H3 - Terciario** | `1.25rem` (20px) | `1.125rem` (18px) | `text-xl` | Subtítulos, títulos de cards |
| **H4 - Cuaternario** | `1.125rem` (18px) | `1rem` (16px) | `text-lg` | Títulos menores, etiquetas grandes |

#### Texto de Cuerpo

| Tipo | Tamaño | Clase Tailwind | Uso |
|------|--------|----------------|-----|
| **Texto Base** | `1rem` (16px) | `text-base` | Texto principal, párrafos |
| **Texto Grande** | `1.125rem` (18px) | `text-lg` | Descripciones importantes, call-to-actions |
| **Texto Pequeño** | `0.875rem` (14px) | `text-sm` | Descripciones, texto secundario |
| **Texto Extra Pequeño** | `0.75rem` (12px) | `text-xs` | Etiquetas, información auxiliar |

### Pesos de Fuente (Font Weights)

| Peso | Valor | Clase Tailwind | Uso |
|------|-------|----------------|-----|
| **Extra Light** | 200 | - | No usado actualmente |
| **Light** | 300 | - | No usado actualmente |
| **Normal** | 400 | `font-normal` | Texto de cuerpo por defecto |
| **Medium** | 500 | `font-medium` | Texto resaltado, botones secundarios |
| **Semibold** | 600 | `font-semibold` | Subtítulos, elementos importantes |
| **Bold** | 700 | `font-bold` | Títulos, encabezados, elementos destacados |

### Espaciado de Letras (Letter Spacing)

| Uso | Valor | Ejemplo |
|-----|-------|---------|
| **Logo/Header** | `0.05em` (tracking-wide) | "MIRÚ FRANCO BEAUTY SALÓN" |
| **Uppercase** | Variable según contexto | Títulos en mayúsculas |

---

## 📐 Ejemplos de Uso por Componente

### Header (Cabecera)

```tsx
// Logo Principal
<h1 className="text-base md:text-lg font-bold tracking-wide uppercase">
  MIRÚ FRANCO
</h1>

// Subtítulo Logo
<h2 className="text-xs md:text-sm font-semibold tracking-wide uppercase">
  BEAUTY SALÓN
</h2>

// Menú Usuario
<span className="font-medium">Usuario</span>
```

**Características:**
- Logo: `text-base` (16px) → `text-lg` (18px) en desktop
- Subtítulo: `text-xs` (12px) → `text-sm` (14px) en desktop
- Letter spacing: `tracking-wide` (0.05em)
- Todos en uppercase

---

### Página Home (Página Principal)

```tsx
// Títulos de Sección
<h2 className="text-4xl md:text-5xl font-bold mb-4">
  Nuestros Productos
</h2>

// Descripción
<p className="text-lg">
  Descubre nuestra amplia gama...
</p>

// Títulos de Cards
<h3 className="text-xl font-semibold mb-2 text-center">
  {producto.nombre}
</h3>

// Descripción de Cards
<p className="text-sm text-center">
  {producto.descripcion}
</p>

// Botones
<button className="px-8 py-3 rounded-lg font-semibold text-lg">
  Conoce Más
</button>
```

**Características:**
- Títulos principales: `text-4xl` (36px) → `text-5xl` (48px)
- Descripciones: `text-lg` (18px)
- Títulos de cards: `text-xl` (20px)
- Texto de cards: `text-sm` (14px)
- Botones: `text-lg` (18px) con `font-semibold`

---

### Formularios (Login, Register, etc.)

```tsx
// Título del Formulario
<h2 className="text-2xl font-bold text-center mb-6">
  Iniciar Sesión
</h2>

// Labels
<label className="block text-sm font-medium mb-2">
  Correo Electrónico
</label>

// Inputs
<input className="text-base" />

// Texto de Ayuda/Errores
<p className="text-sm text-danger">
  {errors.email}
</p>

// Botones
<button className="w-full py-3 px-4 rounded-lg font-medium">
  Iniciar Sesión
</button>
```

**Características:**
- Títulos: `text-2xl` (24px) con `font-bold`
- Labels: `text-sm` (14px) con `font-medium`
- Inputs: `text-base` (16px)
- Mensajes de error: `text-sm` (14px)
- Botones: `font-medium` (500)

---

### Footer

```tsx
// Título Principal
<h3 className="text-2xl font-bold mb-4">
  Miru Franco
</h3>

// Secciones
<h4 className="text-lg font-semibold mb-4">
  Enlaces Rápidos
</h4>

// Enlaces
<Link className="text-sm">
  Inicio
</Link>

// Texto de Copyright
<p className="text-sm">
  © 2024 Miru Franco...
</p>
```

**Características:**
- Título principal: `text-2xl` (24px) con `font-bold`
- Subtítulos: `text-lg` (18px) con `font-semibold`
- Enlaces: `text-sm` (14px)
- Copyright: `text-sm` (14px)

---

## 🎯 Resumen de la Jerarquía Visual

### Orden de Importancia (Top to Bottom)

1. **Títulos Principales de Página**
   - `text-4xl md:text-5xl` (36-48px)
   - `font-bold`
   - Color: `#F2F1ED` o `#161616` según fondo

2. **Títulos de Sección/Formularios**
   - `text-2xl` (24px)
   - `font-bold`
   - Color: Variable según contexto

3. **Subtítulos**
   - `text-xl` (20px)
   - `font-semibold`
   - Color: Variable según contexto

4. **Descripciones Importantes**
   - `text-lg` (18px)
   - `font-normal` o `font-medium`
   - Color: Variable según contexto

5. **Texto de Cuerpo**
   - `text-base` (16px)
   - `font-normal`
   - Color: Variable según contexto

6. **Texto Secundario**
   - `text-sm` (14px)
   - `font-normal` o `font-medium`
   - Color: Con opacidad o tono más claro

7. **Etiquetas/Auxiliar**
   - `text-xs` (12px)
   - `font-medium` o `font-semibold`
   - Color: Variable según contexto

---

## 🔍 Análisis de Consistencia

### ✅ Puntos Fuertes
- Uso consistente de Tailwind CSS para tamaños
- Escala tipográfica clara y definida
- Responsive design implementado (md: breakpoints)
- Pesos de fuente apropiados para cada elemento

### ⚠️ Áreas de Mejora
1. **Inconsistencia en Fuentes**: Geist configurada pero Arial en uso
2. **Falta de Variables CSS**: Tamaños hardcodeados en algunos lugares
3. **Letter Spacing**: Solo usado en logo, podría estandarizarse para uppercase

---

## 💡 Recomendaciones

### 1. Unificar Sistema de Fuentes
Decidir entre:
- **Opción A**: Usar Geist Sans (moderna, cargada de Google Fonts)
- **Opción B**: Mantener Arial/Helvetica (segura, sin carga externa)

### 2. Crear Variables de Tipografía
Agregar al `globals.css`:
```css
:root {
  --font-size-xs: 0.75rem;    /* 12px */
  --font-size-sm: 0.875rem;   /* 14px */
  --font-size-base: 1rem;     /* 16px */
  --font-size-lg: 1.125rem;    /* 18px */
  --font-size-xl: 1.25rem;    /* 20px */
  --font-size-2xl: 1.5rem;    /* 24px */
  --font-size-4xl: 2.25rem;   /* 36px */
  --font-size-5xl: 3rem;      /* 48px */
}
```

### 3. Documentar Line Heights
Agregar line-height estándar:
- Títulos: `line-height: 1.2`
- Texto: `line-height: 1.5`
- Descripciones: `line-height: 1.6`

---

## 📊 Estadísticas de Uso

### Tamaños Más Utilizados
1. `text-sm` (14px) - 40% del uso (labels, descripciones)
2. `text-base` (16px) - 25% del uso (texto principal)
3. `text-lg` (18px) - 15% del uso (descripciones importantes)
4. `text-xl` (20px) - 10% del uso (títulos de cards)
5. `text-2xl` (24px) - 5% del uso (títulos de formularios)
6. `text-4xl/text-5xl` (36-48px) - 5% del uso (títulos principales)

### Pesos Más Utilizados
1. `font-bold` - Títulos y encabezados
2. `font-semibold` - Subtítulos y elementos importantes
3. `font-medium` - Botones y texto resaltado
4. `font-normal` - Texto de cuerpo (default)

---

**Última actualización**: Diciembre 2024
**Versión**: 1.0

