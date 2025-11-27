export interface IUsuario {
  id: string;
  nombre: string;
  email: string;
  telefono?: string;
  password?: string;
  fechaNacimiento?: Date;
  preguntaSeguridad?: IPreguntaSeguridad;
  direccion?: IDireccion;
  perfilCapilar?: IPerfilCapilar;
  googleId?: string;
  foto?: string;
  aceptaAvisoPrivacidad: boolean;
  recibePromociones: boolean;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  codigoOTP?: string;
  otpExpira?: Date;
  confirmado: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
  activo: boolean;
}

export interface IPreguntaSeguridad {
  pregunta: string;
  respuesta?: string; // Hasheada
}

export interface IDireccion {
  calle?: string;
  numero?: string;
  colonia?: string;
  codigoPostal?: string;
  referencia?: string;
}

export interface IPerfilCapilar {
  tipoCabello: 'liso' | 'ondulado' | 'rizado';
  tieneAlergias?: boolean;
  alergias?: string;
  tratamientosQuimicos?: boolean;
  tratamientos?: string;
}

