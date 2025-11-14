# Plan de Implementación: Sistema Tipográfico

## 📋 Resumen

Voy a implementar el sistema tipográfico recomendado, cambiando de Arial a Geist Sans y creando un sistema estructurado de tipografía con variables CSS y clases de utilidad.

---

## 🎯 Archivos que Modificaré

### 1. `src/app/layout.tsx` - **NUEVO: Agregar Playfair Display**
### 2. `src/app/styles/globals.css`
### 3. `src/app/layouts/Header.tsx`
### 4. `src/app/home/page.tsx` (opcional - como ejemplo)
### 5. `src/app/components/auth/Login.tsx` (opcional - como ejemplo)

---

## 📝 Cambios Detallados

### 🔧 CAMBIO 1: `src/app/layout.tsx` - **AGREGAR PLAYFAIR DISPLAY**

#### **1.1 Importar y Configurar Playfair Display**

**ANTES:**
```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
```

**DESPUÉS:**
```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Playfair_Display } from "next/font/google";
import "./styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"], // Regular, Medium, Semibold, Bold, Black
});
```

#### **1.2 Agregar Variable al Body**

**ANTES:**
```tsx
<body
  className={`${geistSans.variable} ${geistMono.variable} antialiased`}
>
```

**DESPUÉS:**
```tsx
<body
  className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} antialiased`}
>
```

---

### 🔧 CAMBIO 2: `src/app/styles/globals.css`

#### **2.1 Agregar Variables de Tipografía en `:root`**

**ANTES:**
```css
:root {
  /* Nueva Paleta de Colores */
  --fondo-general: #d0b29c;
  /* ... otros colores ... */
  --background: var(--fondo-general);
  --foreground: var(--menu-texto-principal);
}
```

**DESPUÉS:**
```css
:root {
  /* Nueva Paleta de Colores */
  --fondo-general: #d0b29c;
  /* ... otros colores existentes ... */
  --background: var(--fondo-general);
  --foreground: var(--menu-texto-principal);
  
  /* ========== SISTEMA TIPOGRÁFICO ========== */
  
  /* Font Families */
  --font-family-sans: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
  --font-family-mono: var(--font-geist-mono), 'Courier New', monospace;
  --font-family-serif: var(--font-playfair-display), 'Times New Roman', serif;
  
  /* Escala Tipográfica (basada en ratio 1.25) */
  --font-size-xs: 0.75rem;      /* 12px */
  --font-size-sm: 0.875rem;     /* 14px */
  --font-size-base: 1rem;       /* 16px */
  --font-size-lg: 1.125rem;     /* 18px */
  --font-size-xl: 1.25rem;      /* 20px */
  --font-size-2xl: 1.5rem;      /* 24px */
  --font-size-3xl: 1.875rem;    /* 30px */
  --font-size-4xl: 2.25rem;     /* 36px */
  --font-size-5xl: 3rem;        /* 48px */
  --font-size-6xl: 3.75rem;     /* 60px */
  
  /* Line Heights (optimizados para legibilidad) */
  --line-height-tight: 1.2;      /* Títulos grandes */
  --line-height-snug: 1.375;     /* Títulos medianos */
  --line-height-normal: 1.5;     /* Texto de cuerpo */
  --line-height-relaxed: 1.625;  /* Texto largo */
  
  /* Letter Spacing */
  --letter-spacing-tight: -0.025em;
  --letter-spacing-normal: 0;
  --letter-spacing-wide: 0.05em;
  --letter-spacing-wider: 0.1em;
  
  /* Font Weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

#### **2.2 Actualizar `body` para usar Geist Sans**

**ANTES:**
```css
body {
  background: #d0b29c;
  color: var(--menu-texto-principal);
  font-family: Arial, Helvetica, sans-serif;
}
```

**DESPUÉS:**
```css
body {
  background: #d0b29c;
  color: var(--menu-texto-principal);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  line-height: var(--line-height-normal);
  font-weight: var(--font-weight-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

#### **2.3 Agregar Clases de Utilidad Tipográfica (después del body)**

**NUEVO CONTENIDO:**
```css
/* ========== CLASES DE UTILIDAD TIPOGRÁFICA ========== */

/* Display - Títulos más grandes (Hero, Landing) */
.text-display {
  font-size: var(--font-size-5xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-tight);
}

@media (min-width: 768px) {
  .text-display {
    font-size: var(--font-size-6xl);
  }
}

/* Hero - Títulos principales de sección */
.text-hero {
  font-size: var(--font-size-4xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
}

@media (min-width: 768px) {
  .text-hero {
    font-size: var(--font-size-5xl);
  }
}

/* Section Title - Títulos grandes de sección */
.text-section-title {
  font-size: var(--font-size-3xl);
  line-height: var(--line-height-snug);
  font-weight: var(--font-weight-bold);
}

/* Page Title - Títulos de formularios, páginas */
.text-page-title {
  font-size: var(--font-size-2xl);
  line-height: var(--line-height-snug);
  font-weight: var(--font-weight-bold);
}

/* Subtitle - Títulos de cards, subtítulos */
.text-subtitle {
  font-size: var(--font-size-xl);
  line-height: var(--line-height-snug);
  font-weight: var(--font-weight-semibold);
}

/* Lead - Descripciones importantes, introducciones */
.text-lead {
  font-size: var(--font-size-lg);
  line-height: var(--line-height-relaxed);
  font-weight: var(--font-weight-normal);
}

/* Logo Principal */
.text-logo {
  font-size: var(--font-size-lg);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-wider);
  text-transform: uppercase;
}

@media (min-width: 768px) {
  .text-logo {
    font-size: var(--font-size-xl);
  }
}

/* Logo Secundario/Subtítulo */
.text-logo-small {
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--letter-spacing-wide);
  text-transform: uppercase;
}

@media (min-width: 768px) {
  .text-logo-small {
    font-size: var(--font-size-base);
  }
}

/* Hero Title con mejor legibilidad en fondos oscuros */
.text-hero-light {
  font-size: var(--font-size-4xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

@media (min-width: 768px) {
  .text-hero-light {
    font-size: var(--font-size-5xl);
  }
}

/* Mejorar legibilidad de párrafos */
p {
  line-height: var(--line-height-relaxed);
}

/* ========== CLASES CON PLAYFAIR DISPLAY (SERIF ELEGANTE) ========== */

/* Elegant Display - Para títulos hero muy destacados */
.text-elegant-display {
  font-family: var(--font-family-serif);
  font-size: var(--font-size-5xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-tight);
}

@media (min-width: 768px) {
  .text-elegant-display {
    font-size: var(--font-size-6xl);
  }
}

/* Elegant Hero - Para títulos principales elegantes */
.text-elegant-hero {
  font-family: var(--font-family-serif);
  font-size: var(--font-size-4xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-tight);
}

@media (min-width: 768px) {
  .text-elegant-hero {
    font-size: var(--font-size-5xl);
  }
}

/* Elegant Title - Para títulos de sección elegantes */
.text-elegant-title {
  font-family: var(--font-family-serif);
  font-size: var(--font-size-3xl);
  line-height: var(--line-height-snug);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-normal);
}

@media (min-width: 768px) {
  .text-elegant-title {
    font-size: var(--font-size-4xl);
  }
}

/* Elegant Quote - Para citas o texto destacado elegante */
.text-elegant-quote {
  font-family: var(--font-family-serif);
  font-size: var(--font-size-xl);
  line-height: var(--line-height-relaxed);
  font-weight: var(--font-weight-normal);
  font-style: italic;
  letter-spacing: var(--letter-spacing-normal);
}

@media (min-width: 768px) {
  .text-elegant-quote {
    font-size: var(--font-size-2xl);
  }
}

/* Elegant Hero con text-shadow para fondos oscuros */
.text-elegant-hero-light {
  font-family: var(--font-family-serif);
  font-size: var(--font-size-4xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-tight);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

@media (min-width: 768px) {
  .text-elegant-hero-light {
    font-size: var(--font-size-5xl);
  }
}
```

---

### 🔧 CAMBIO 3: `src/app/layouts/Header.tsx`

#### **3.1 Mejorar Logo Principal**

**ANTES:**
```tsx
<h1 
  className="text-base md:text-lg font-bold tracking-wide uppercase text-logo-branding"
  style={{ 
    textShadow: '0 2px 4px rgba(159, 109, 31, 0.3)',
    letterSpacing: '0.05em',
    lineHeight: '1.2',
    margin: 0,
    padding: 0
  }}
>
  MIRÚ FRANCO
</h1>
```

**DESPUÉS:**
```tsx
<h1 
  className="text-logo text-logo-branding"
  style={{ 
    textShadow: '0 2px 4px rgba(159, 109, 31, 0.3)',
    margin: 0,
    padding: 0
  }}
>
  MIRÚ FRANCO
</h1>
```

#### **3.2 Mejorar Subtítulo del Logo**

**ANTES:**
```tsx
<h2
  className="text-xs md:text-sm font-semibold tracking-wide uppercase text-logo-branding"
  style={{ 
    textShadow: '0 2px 4px rgba(159, 109, 31, 0.3)',
    letterSpacing: '0.05em',
    lineHeight: '1.2',
    margin: 0,
    padding: 0,
    marginTop: '2px'
  }}
>
  BEAUTY SALÓN
</h2>
```

**DESPUÉS:**
```tsx
<h2
  className="text-logo-small text-logo-branding"
  style={{ 
    textShadow: '0 2px 4px rgba(159, 109, 31, 0.3)',
    margin: 0,
    padding: 0,
    marginTop: '2px'
  }}
>
  BEAUTY SALÓN
</h2>
```

---

### 🔧 CAMBIO 4: `src/app/home/page.tsx` (Ejemplo de Migración)

#### **4.1 Ejemplo: Usar Playfair Display en Sección "Sobre Nosotros"**

**OPCIÓN CON PLAYFAIR DISPLAY (NUEVO):**
```tsx
<h2 className="text-elegant-title mb-4" style={{ color: '#F2F1ED' }}>
  Sobre Nosotros
</h2>
<p className="text-elegant-quote mb-6" style={{ color: 'rgba(242,241,237,0.9)' }}>
  En Miru Franco, nos dedicamos a realzar tu belleza natural...
</p>
```

**Comparación - ANTES (Geist Sans):**
```tsx
<h2 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: '#F2F1ED' }}>
  Sobre Nosotros
</h2>
```

---

#### **4.2 Títulos Principales de Sección (Geist Sans)**

**ANTES:**
```tsx
<h2 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: '#161616' }}>
  Nuestros Productos
</h2>
```

**DESPUÉS:**
```tsx
<h2 className="text-hero mb-4" style={{ color: '#161616' }}>
  Nuestros Productos
</h2>
```

#### **3.2 Descripciones Principales**

**ANTES:**
```tsx
<p className="text-lg" style={{ color: '#161616' }}>
  Descubre nuestra amplia gama de productos capilares de alta calidad.
</p>
```

**DESPUÉS:**
```tsx
<p className="text-lead" style={{ color: '#161616' }}>
  Descubre nuestra amplia gama de productos capilares de alta calidad.
</p>
```

#### **3.3 Títulos de Cards**

**ANTES:**
```tsx
<h3 className="text-xl font-semibold mb-2 text-center" style={{ color: '#F2F1ED' }}>
  {producto.nombre}
</h3>
```

**DESPUÉS:**
```tsx
<h3 className="text-subtitle mb-2 text-center" style={{ color: '#F2F1ED' }}>
  {producto.nombre}
</h3>
```

#### **3.4 Títulos en Fondos Oscuros**

**ANTES:**
```tsx
<h2 className="text-4xl md:text-5xl font-bold mb-4" style={{ color: '#F2F1ED' }}>
  Nuestros Servicios
</h2>
```

**DESPUÉS:**
```tsx
<h2 className="text-hero-light mb-4" style={{ color: '#F2F1ED' }}>
  Nuestros Servicios
</h2>
```

---

### 🔧 CAMBIO 5: `src/app/components/auth/Login.tsx` (Ejemplo)

#### **5.1 Título del Formulario**

**ANTES:**
```tsx
<h2 className="text-2xl font-bold text-center mb-6 text-texto-fondo-oscuro">
  Iniciar Sesión
</h2>
```

**DESPUÉS:**
```tsx
<h2 className="text-page-title text-center mb-6 text-texto-fondo-oscuro">
  Iniciar Sesión
</h2>
```

---

## 📊 Resumen de Cambios

### ✅ Archivos que Modificaré:

1. **`src/app/layout.tsx`** - **NUEVO**
   - ✅ Importar Playfair Display de Google Fonts
   - ✅ Configurar con pesos 400, 500, 600, 700, 900
   - ✅ Agregar variable al body para uso global

2. **`src/app/styles/globals.css`**
   - ✅ Agregar variables de tipografía (font-size, line-height, letter-spacing)
   - ✅ Agregar variable `--font-family-serif` para Playfair Display
   - ✅ Cambiar `font-family` del body de Arial a Geist Sans
   - ✅ Crear 8 clases de utilidad con Geist Sans
   - ✅ Crear 5 clases de utilidad con Playfair Display (serif elegante)
   - ✅ Mejorar line-height de párrafos

3. **`src/app/layouts/Header.tsx`**
   - ✅ Simplificar estilos del logo principal usando `.text-logo`
   - ✅ Simplificar estilos del subtítulo usando `.text-logo-small`

4. **`src/app/home/page.tsx`** (Opcional - Ejemplo)
   - ✅ Migrar títulos principales a `.text-hero` (Geist Sans)
   - ✅ Migrar descripciones a `.text-lead` (Geist Sans)
   - ✅ Migrar títulos de cards a `.text-subtitle` (Geist Sans)
   - ✅ Usar `.text-hero-light` para títulos en fondos oscuros (Geist Sans)
   - ✅ **NUEVO**: Usar `.text-elegant-title` en sección "Sobre Nosotros" (Playfair Display)
   - ✅ **NUEVO**: Usar `.text-elegant-quote` para citas destacadas (Playfair Display)

5. **`src/app/components/auth/Login.tsx`** (Opcional - Ejemplo)
   - ✅ Migrar título de formulario a `.text-page-title` (Geist Sans)

---

## ⚠️ Notas Importantes

### Compatibilidad
- ✅ **NO romperá código existente**: Las clases de Tailwind (`text-4xl`, `text-lg`, etc.) seguirán funcionando
- ✅ **Migración gradual**: Puedes migrar componentes cuando quieras
- ✅ **Retrocompatibilidad**: Todo el código actual seguirá funcionando

### Beneficios Inmediatos
- ✅ Cambio de fuente a Geist Sans (más moderna)
- ✅ **NUEVO**: Playfair Display disponible para títulos elegantes
- ✅ Mejor legibilidad con line-heights optimizados
- ✅ Logo mejorado con mejor letter-spacing
- ✅ Sistema estructurado para futuro mantenimiento
- ✅ Dos fuentes disponibles: Sans-serif (Geist) y Serif (Playfair) para contraste visual

---

## 🎯 Cambios que NO Haré (Por Ahora)

- ❌ No migraré TODOS los componentes (solo ejemplos)
- ❌ No cambiaré clases de Tailwind existentes que funcionan
- ❌ No modificaré otros archivos que no estén en el plan
- ❌ No crearé nuevos archivos (todo en `globals.css`)

---

## 📝 Orden de Ejecución

1. **Paso 1**: Modificar `layout.tsx`
   - Importar Playfair Display
   - Configurar con pesos necesarios
   - Agregar variable al body

2. **Paso 2**: Modificar `globals.css`
   - Agregar variables de tipografía
   - Agregar variable `--font-family-serif` para Playfair
   - Actualizar body para usar Geist Sans
   - Crear clases de utilidad con Geist Sans
   - Crear clases de utilidad con Playfair Display

3. **Paso 3**: Modificar `Header.tsx`
   - Actualizar logo principal
   - Actualizar subtítulo

4. **Paso 4**: (Opcional) Actualizar `home/page.tsx` como ejemplo
   - Migrar a clases nuevas (Geist Sans)
   - Agregar ejemplo con Playfair Display en "Sobre Nosotros"

5. **Paso 5**: (Opcional) Actualizar `Login.tsx` como ejemplo

---

## ✅ Checklist de Verificación

Antes de aplicar cambios, verificaré:
- [ ] Variables CSS correctamente definidas
- [ ] Clases no conflictúan con Tailwind
- [ ] Responsive funciona correctamente
- [ ] Logo se ve bien con nuevo letter-spacing
- [ ] Line-heights mejoran legibilidad

---

## 🚀 Resultado Esperado

Después de estos cambios tendrás:

1. ✅ **Geist Sans** como fuente principal (más moderna)
2. ✅ **Playfair Display** disponible para títulos elegantes (serif decorativo)
3. ✅ **Sistema tipográfico estructurado** con variables CSS
4. ✅ **Clases de utilidad con Geist Sans** (8 clases)
5. ✅ **Clases de utilidad con Playfair Display** (5 clases elegantes)
6. ✅ **Mejor legibilidad** con line-heights optimizados
7. ✅ **Logo mejorado** con mejor espaciado
8. ✅ **Código más semántico** (ejemplos en home y login)
9. ✅ **Contraste visual** entre sans-serif (Geist) y serif (Playfair) para jerarquía

---

## 🎨 Guía de Uso: ¿Cuándo Usar Cada Fuente?

### **Geist Sans (Sans-serif)** - Fuente Principal
- ✅ **Texto de cuerpo** (párrafos, descripciones)
- ✅ **Títulos funcionales** (formularios, secciones)
- ✅ **Navegación y UI** (botones, menús)
- ✅ **Cards y componentes** (títulos de productos, servicios)

### **Playfair Display (Serif)** - Títulos Elegantes
- ✅ **Títulos hero destacados** (landing page principal)
- ✅ **Sección "Sobre Nosotros"** (da elegancia y personalidad)
- ✅ **Citas o testimonios** (texto destacado en cursiva)
- ✅ **Títulos decorativos** (cuando quieres dar un toque sofisticado)
- ✅ **Contraste visual** (alternar con Geist Sans para jerarquía)

### **Ejemplo de Combinación:**
```tsx
{/* Título principal con Playfair (elegante) */}
<h1 className="text-elegant-hero">Transformamos tu Belleza</h1>

{/* Descripción con Geist Sans (legible) */}
<p className="text-lead">Descubre nuestros servicios...</p>

{/* Subtítulos con Geist Sans (consistente) */}
<h2 className="text-hero">Nuestros Servicios</h2>
```

---

## 📊 Resumen de Clases Disponibles

### **Con Geist Sans (8 clases):**
- `.text-display` - Títulos display grandes
- `.text-hero` - Títulos principales
- `.text-section-title` - Títulos de sección
- `.text-page-title` - Títulos de formularios
- `.text-subtitle` - Subtítulos de cards
- `.text-lead` - Descripciones importantes
- `.text-logo` - Logo principal
- `.text-logo-small` - Subtítulo del logo
- `.text-hero-light` - Hero con text-shadow

### **Con Playfair Display (5 clases):**
- `.text-elegant-display` - Display muy elegante (60px)
- `.text-elegant-hero` - Hero elegante (48px)
- `.text-elegant-title` - Título de sección elegante (36px)
- `.text-elegant-quote` - Citas o texto destacado (24px, cursiva)
- `.text-elegant-hero-light` - Hero elegante con text-shadow

---

## ❓ ¿Confirmas estos cambios?

Por favor revisa este plan y confirma:
- ✅ ¿Aplico todos los cambios propuestos (incluyendo Playfair Display)?
- ✅ ¿Incluyo los ejemplos opcionales (home/page.tsx y Login.tsx)?
- ✅ ¿Hay algo que quieras modificar antes de proceder?

**Esperando tu confirmación para proceder...**

