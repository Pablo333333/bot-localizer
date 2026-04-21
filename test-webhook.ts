import axios from 'axios';

const mockPayload = {
  "call": {
    "agent_id": "agent_b8abf941c156192b1995f36c5d",
    "call_id": "test_123_" + Date.now(),
    "from_number": "+34600000000",
    "call_analysis": {
      "call_successful": true,
      "custom_analysis_data": {
        "tipo_inmueble": "Local",
        "disponibilidad": "DISPONIBLE",
        "negocio_anterior": "Panadería",
        "precio_alquiler": "1200",
        "municipio": "Barcelona",
        "nombre_contacto": "Juan Perez"
      }
    }
  }
};

async function runTest() {
  try {
    console.log('Enviando mock payload a http://localhost:3000/webhooks/retell ...');
    const response = await axios.post('http://localhost:3000/webhooks/retell', mockPayload);
    console.log('Respuesta del servidor:', response.status, response.data);
  } catch (error) {
    console.error('Error en el test:', error.response?.status, error.response?.data || error.message);
  }
}

runTest();
