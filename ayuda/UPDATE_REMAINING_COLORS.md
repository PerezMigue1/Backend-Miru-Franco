# Archivos Pendientes de Actualizar

Debido al tamaño de los archivos, he actualizado:

✅ Completados:
- AuthContainer.tsx
- Footer.tsx
- MenuHamburguesa.tsx
- Header.tsx
- MenuHorizontal.tsx
- Login.tsx
- ForgotPassword.tsx (parcialmente)

⏳ Pendientes (actualización similar):
- ResetPassword.tsx
- ForgotPasswordSMS.tsx
- ForgotPasswordSecurityQuestions.tsx
- Register.tsx (archivo muy grande)
- Carousel.tsx
- home/page.tsx

Todos deben seguir el mismo patrón:
1. Importar: `import { colors, colorsWithOpacity } from '../../utils/colors';`
2. Reemplazar colores hardcodeados con:
   - Clases Tailwind: `bg-header-footer`, `text-texto-fondo-oscuro`, etc.
   - Constantes TypeScript: `colors.botonesPrincipales`, `colors.hover`, etc.
   - Opacidades: `colorsWithOpacity.bordeSutil`, `colorsWithOpacity.hover15`, etc.

