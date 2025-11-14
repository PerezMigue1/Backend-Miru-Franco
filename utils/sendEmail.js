const sgMail = require('@sendgrid/mail');

// Configurar API key de SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('⚠️ SENDGRID_API_KEY no configurada. Los emails no se enviarán.');
}

const sendOTPEmail = async (correo, codigoOTP) => {
  // Verificar que SendGrid esté configurado
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error('SendGrid no está configurado. Por favor configura SENDGRID_API_KEY.');
  }

  if (!process.env.SENDGRID_FROM_EMAIL) {
    throw new Error('SENDGRID_FROM_EMAIL no está configurado.');
  }
  try {
    const msg = {
      to: correo,
      from: {
        name: process.env.SENDGRID_FROM_NAME || 'Miru Franco Salón Beauty',
        email: process.env.SENDGRID_FROM_EMAIL,
      },
      subject: 'Código de activación - Miru Franco',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #710014;">Bienvenido a Miru Franco Salón Beauty</h2>
          <p>Tu código de verificación es:</p>
          <div style="background-color: #f2f1ed; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h1 style="color: #161616; font-size: 32px; letter-spacing: 8px; margin: 0;">${codigoOTP}</h1>
          </div>
          <p style="color: #666;">Ingresa este código en la aplicación para activar tu cuenta.</p>
          <p style="color: #666; font-size: 12px;">Este código expira en 2 minutos.</p>
          <p style="color: #666; font-size: 12px;">Si no solicitaste este código, ignora este mensaje.</p>
        </div>
      `,
    };
    
    await sgMail.send(msg);
    console.log('Correo de activación enviado a:', correo);
  } catch (err) {
    console.error('Error enviando correo de activación:', err.response?.body || err.message);
    throw new Error('No se pudo enviar el correo de activación');
  }
};

module.exports = { sendOTPEmail };

