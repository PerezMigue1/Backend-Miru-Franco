# Recomendación: Sistema Tipográfico y Jerarquía Visual

## 🎯 Objetivo

Crear un sistema tipográfico unificado, consistente y fácil de mantener que mejore la legibilidad y jerarquía visual de todo el proyecto.

---

## ✅ Recomendación Principal

### **Usar Geist Sans como Fuente Principal**

**Razones:**
1. ✅ Ya está configurada y cargada (no añade overhead)
2. ✅ Moderna y legible (diseñada específicamente para interfaces digitales)
3. ✅ Excelente rendimiento en pantallas
4. ✅ Compatible con tu paleta de colores beige/marrones
5. ✅ Arial/Helvetica es demasiado genérica (se ve en todos lados)

**Fallback:** Mantener `sans-serif` como respaldo

---

## 📐 Sistema Tipográfico Propuesto

### 1. Variables CSS para Tipografía

Agregar al `globals.css`:

```css
:root {
  /* ... colores existentes ... */
  
  /* Sistema Tipográfico */
  --font-family-sans: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
  --font-family-mono: var(--font-geist-mono), 'Courier New', monospace;
  
  /* Escala Tipográfica (basada en ratio 1.25) */
  --font-size-xs: 0.75rem;      /* 12px - Etiquetas, badges */
  --font-size-sm: 0.875rem;     /* 14px - Labels, descripciones */
  --font-size-base: 1rem;       /* 16px - Texto de cuerpo */
  --font-size-lg: 1.125rem;     /* 18px - Descripciones importantes */
  --font-size-xl: 1.25rem;      /* 20px - Títulos de cards */
  --font-size-2xl: 1.5rem;      /* 24px - Títulos de sección */
  --font-size-3xl: 1.875rem;    /* 30px - Títulos grandes */
  --font-size-4xl: 2.25rem;     /* 36px - Hero titles (mobile) */
  --font-size-5xl: 3rem;        /* 48px - Hero titles (desktop) */
  --font-size-6xl: 3.75rem;     /* 60px - Display titles */
  
  /* Line Heights (optimizados para legibilidad) */
  --line-height-tight: 1.2;      /* Títulos grandes */
  --line-height-snug: 1.375;     /* Títulos medianos */
  --line-height-normal: 1.5;     /* Texto de cuerpo */
  --line-height-relaxed: 1.625;  /* Texto largo/artículos */
  
  /* Letter Spacing */
  --letter-spacing-tight: -0.025em;   /* Títulos grandes */
  --letter-spacing-normal: 0;         /* Default */
  --letter-spacing-wide: 0.05em;      /* Logo, uppercase */
  --letter-spacing-wider: 0.1em;      /* Display text */
  
  /* Font Weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

### 2. Aplicar Fuente en Body

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

---

## 🎨 Jerarquía Visual Mejorada

### Clases de Utilidad Tipográfica

Crear clases reutilizables en `globals.css`:

```css
/* Títulos Principales */
.text-display {
  font-size: var(--font-size-5xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-tight);
}

.text-hero {
  font-size: var(--font-size-4xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
}

/* Títulos de Sección */
.text-section-title {
  font-size: var(--font-size-3xl);
  line-height: var(--line-height-snug);
  font-weight: var(--font-weight-bold);
}

.text-page-title {
  font-size: var(--font-size-2xl);
  line-height: var(--line-height-snug);
  font-weight: var(--font-weight-bold);
}

/* Subtítulos */
.text-subtitle {
  font-size: var(--font-size-xl);
  line-height: var(--line-height-snug);
  font-weight: var(--font-weight-semibold);
}

/* Texto Destacado */
.text-lead {
  font-size: var(--font-size-lg);
  line-height: var(--line-height-relaxed);
  font-weight: var(--font-weight-normal);
}

/* Logo (ya lo tienes) */
.text-logo {
  font-size: var(--font-size-lg);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--letter-spacing-wide);
  text-transform: uppercase;
}

.text-logo-small {
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--letter-spacing-wide);
  text-transform: uppercase;
}
```

---

## 📋 Matriz de Uso por Componente

### **Header**
```tsx
// Logo Principal
<h1 className="text-logo text-logo-branding">
  MIRÚ FRANCO
</h1>

// Subtítulo Logo
<h2 className="text-logo-small text-logo-branding">
  BEAUTY SALÓN
</h2>
```

### **Página Home**
```tsx
// Título Principal de Sección
<h2 className="text-hero md:text-display">
  Nuestros Productos
</h2>

// Descripción Principal
<p className="text-lead">
  Descubre nuestra amplia gama...
</p>

// Título de Card
<h3 className="text-subtitle">
  {producto.nombre}
</h3>

// Descripción de Card
<p className="text-sm">
  {producto.descripcion}
</p>
```

### **Formularios**
```tsx
// Título del Formulario
<h2 className="text-page-title">
  Iniciar Sesión
</h2>

// Label
<label className="text-sm font-medium">
  Correo Electrónico
</label>

// Input (ya tiene text-base por defecto)
<input className="text-base" />

// Botón
<button className="text-base font-medium">
  Iniciar Sesión
</button>
```

### **Footer**
```tsx
// Título Principal
<h3 className="text-page-title">
  Miru Franco
</h3>

// Subtítulo de Sección
<h4 className="text-subtitle">
  Enlaces Rápidos
</h4>

// Enlaces y texto
<Link className="text-sm">Inicio</Link>
<p className="text-sm">© 2024...</p>
```

---

## 🎯 Mejoras Específicas Recomendadas

### 1. **Mejorar Legibilidad del Logo**

El logo actual tiene buen spacing, pero podemos mejorarlo:

```tsx
<h1 
  className="text-lg md:text-xl font-bold tracking-wider uppercase text-logo-branding"
  style={{ 
    lineHeight: '1.1',
    letterSpacing: '0.08em', // Ligeramente más espaciado
  }}
>
  MIRÚ FRANCO
</h1>
```

### 2. **Mejorar Contraste en Títulos Grandes**

Para títulos en fondos oscuros:

```css
.text-hero-light {
  font-size: var(--font-size-4xl);
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
  color: var(--texto-fondo-oscuro);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); /* Mejor legibilidad */
}
```

### 3. **Establecer Line-Height Consistente**

Todos los párrafos y descripciones deben tener `line-height: 1.6` para mejor legibilidad:

```css
.text-body {
  font-size: var(--font-size-base);
  line-height: var(--line-height-relaxed);
}

p {
  line-height: var(--line-height-relaxed);
}
```

### 4. **Responsive Typography**

Usar clamp() para escalado fluido:

```css
.text-responsive-hero {
  font-size: clamp(2rem, 5vw, 3rem); /* 32px - 48px */
  line-height: var(--line-height-tight);
  font-weight: var(--font-weight-bold);
}
```

---

## 📊 Comparación: Antes vs Después

### **Antes:**
```tsx
<h2 className="text-4xl md:text-5xl font-bold mb-4">
  Nuestros Productos
</h2>
<p className="text-lg">
  Descripción...
</p>
```

### **Después (Recomendado):**
```tsx
<h2 className="text-hero md:text-display mb-4">
  Nuestros Productos
</h2>
<p className="text-lead">
  Descripción...
</p>
```

**Ventajas:**
- ✅ Más semántico y legible
- ✅ Fácil de mantener (cambiar en un solo lugar)
- ✅ Consistencia garantizada
- ✅ Line-heights optimizados incluidos

---

## 🔧 Implementación Paso a Paso

### **Paso 1: Actualizar globals.css**
1. Agregar variables de tipografía al `:root`
2. Cambiar `font-family` en `body` a usar Geist
3. Agregar clases de utilidad tipográfica

### **Paso 2: Actualizar Componentes (Opcional)**
- Puedes migrar gradualmente
- O mantener ambos sistemas funcionando
- Las clases nuevas son opcionales, las existentes seguirán funcionando

### **Paso 3: Testing**
- Verificar en diferentes tamaños de pantalla
- Verificar legibilidad en todos los fondos
- Ajustar line-heights si es necesario

---

## 🎨 Paleta Tipográfica Final

```
┌─────────────────────────────────────────────────┐
│ DISPLAY (48-60px)                                │
│ Hero Titles, Landing Page Headlines              │
│ Line-height: 1.2, Weight: 700                    │
├─────────────────────────────────────────────────┤
│ SECTION TITLE (30-36px)                          │
│ Títulos Principales de Sección                   │
│ Line-height: 1.375, Weight: 700                  │
├─────────────────────────────────────────────────┤
│ PAGE TITLE (24px)                                │
│ Títulos de Formularios, Secciones Secundarias    │
│ Line-height: 1.375, Weight: 700                   │
├─────────────────────────────────────────────────┤
│ SUBTITLE (20px)                                   │
│ Títulos de Cards, Subtítulos                     │
│ Line-height: 1.375, Weight: 600                   │
├─────────────────────────────────────────────────┤
│ LEAD (18px)                                       │
│ Descripciones Importantes, Introducciones        │
│ Line-height: 1.625, Weight: 400                   │
├─────────────────────────────────────────────────┤
│ BODY (16px)                                       │
│ Texto Principal, Párrafos                        │
│ Line-height: 1.5, Weight: 400                    │
├─────────────────────────────────────────────────┤
│ SMALL (14px)                                      │
│ Labels, Descripciones Secundarias                │
│ Line-height: 1.5, Weight: 400/500                │
├─────────────────────────────────────────────────┤
│ XS (12px)                                         │
│ Etiquetas, Badges, Información Auxiliar         │
│ Line-height: 1.4, Weight: 500                     │
└─────────────────────────────────────────────────┘
```

---

## 💡 Recomendaciones Adicionales

### 1. **Mantener Arial como Fallback**
Si decides no usar Geist, mantén Arial pero crea el sistema de variables igual.

### 2. **Considerar una Segunda Fuente**
Para títulos más decorativos, podrías considerar:
- **Playfair Display** (serif elegante) para títulos especiales
- **Inter** (si quieres algo más neutral que Geist)

### 3. **Testing de Accesibilidad**
- Verificar contraste de texto (WCAG AA mínimo)
- Verificar tamaño mínimo de texto (14px recomendado)
- Probar con lectores de pantalla

---

## ✅ Checklist de Implementación

- [ ] Agregar variables CSS de tipografía
- [ ] Cambiar font-family del body a Geist
- [ ] Crear clases de utilidad tipográfica
- [ ] Actualizar logo con mejor letter-spacing
- [ ] Agregar text-shadow a títulos en fondos oscuros
- [ ] Establecer line-heights consistentes
- [ ] Probar en diferentes dispositivos
- [ ] Documentar en código

---

## 🚀 Resultado Esperado

Después de implementar estas recomendaciones tendrás:

1. ✅ **Sistema tipográfico unificado** y fácil de mantener
2. ✅ **Mejor legibilidad** en todos los tamaños de pantalla
3. ✅ **Jerarquía visual clara** y consistente
4. ✅ **Código más semántico** y fácil de leer
5. ✅ **Escalabilidad** para futuras expansiones

---

**¿Quieres que implemente estas recomendaciones ahora?**

