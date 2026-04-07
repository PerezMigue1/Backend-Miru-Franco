// src/services/paquetes.ts

export const deletePaquete = async (id: string) => {
  // Asegúrate de que la URL coincida con tu backend
  const response = await fetch(`http://localhost:3001/api/paquetes/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Error al eliminar el paquete');
  }

  return await response.json();
};