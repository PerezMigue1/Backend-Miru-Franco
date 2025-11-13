const { mg, DOMAIN } = require('../config/mailgun');
const { generarLinkVerificacion } = require('../utils/emailVerification');

async function enviarEmailVerificacion(email, token) {
  const verificationLink = generarLinkVerificacion(token, email);
  
  const data = {
    from: 'Miru Franco Beauty Salón <noreply@sandbox8e95977472d64fd7a004560539f87f8f.mailgun.org>',
    to: email,
    subject: 'Verifica tu correo electrónico - Miru Franco',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #710014; color: #F2F1ED; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
          .content { background-color: #f9f9f9; padding: 30px; }
          .button { 
            display: inline-block; 
            padding: 12px 30px; 
            background-color: #710014; 
            color: #F2F1ED; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 20px 0;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Miru Franco Beauty Salón</h1>
          </div>
          <div class="content">
            <h2>¡Bienvenido/a!</h2>
            <p>Gracias por registrarte en Miru Franco Beauty Salón.</p>
            <p>Para completar tu registro, por favor verifica tu correo electrónico haciendo clic en el siguiente botón:</p>
            <div style="text-align: center;">
              <a href="${verificationLink}" class="button">Verificar Correo Electrónico</a>
            </div>
            <p>O copia y pega este enlace en tu navegador:</p>
            <p style="word-break: break-all; color: #710014;">${verificationLink}</p>
            <p><strong>Este enlace expirará en 24 horas.</strong></p>
            <p>Si no creaste esta cuenta, puedes ignorar este correo.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Miru Franco Beauty Salón. Todos los derechos reservados.</p>
            <p>Segunda Cerrada de Allende No. 15, Colonia Juárez, Huejutla de Reyes, Hidalgo</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      ¡Bienvenido/a a Miru Franco Beauty Salón!
      
      Gracias por registrarte. Para completar tu registro, verifica tu correo electrónico visitando este enlace:
      
      ${verificationLink}
      
      Este enlace expirará en 24 horas.
      
      Si no creaste esta cuenta, puedes ignorar este correo.
    `
  };

  try {
    const response = await mg.messages.create(DOMAIN, data);
    return { success: true, messageId: response.id };
  } catch (error) {
    console.error('Error enviando email:', error);
    throw new Error('Error al enviar el email de verificación');
  }
}

module.exports = {
  enviarEmailVerificacion
};

