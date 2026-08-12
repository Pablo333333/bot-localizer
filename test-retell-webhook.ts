import axios from 'axios';

const payload = {
  "event_type": "call_analyzed",
  "call_id": "test_call_12345",
  "agent_id": "agent_b8abf941c156192b1995f36c5d",
  "from_number": "+34600112233",
  "to_number": "+34622334455",
  "call_analysis": {
    "call_successful": true,
    "call_summary": "Llamada de prueba exitosa. El cliente está interesado en publicar el local en alquiler y prefiere seguimiento por WhatsApp.",
    "custom_analysis_data": {
      "target_contact": "contacto_2",
      "tipo_inmueble": "Local Comercial",
      "disponibilidad": "Disponible",
      "estado": "Buen estado",
      "superficie_total": "120",
      "superficie_util": "110",
      "negocio_anterior": "Cafetería",
      "numero_banios": "2",
      "tipo_via": "Calle",
      "nombre_via": "Gran Vía",
      "numero_via": "45",
      "pueblo_barrio": "Centro",
      "municipio": "Madrid",
      "provincia": "Madrid",
      "precio_alquiler": "1500",
      "fianza_meses": "2",
      "es_negociable": "SI",
      "vado": "NO",
      "altura_techos": "3.5m",
      "num_plantas": "1",
      "certificado_energetico": "C",
      "anio_construccion": "1998",
      "url_imagen": "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing",
      "publicacion_autorizada": "SI",
      "contrato": "Alquiler",
      "Ilocalizable": "",
      "nombre_contacto_2": "Carlos Gómez (Test)",
      "contacto_2_con": "Particular",
      "contacto_2_por": "WhatsApp",
      "email_propietario_gestor": "carlos.test@example.com",
      "email_avisos": "avisos.test@example.com"
    }
  }
};

async function testWebhook() {
  try {
    console.log('Enviando payload de prueba a http://localhost:3000/webhooks/retell...');
    const response = await axios.post('http://localhost:3000/webhooks/retell', payload);
    console.log('Respuesta del servidor:', response.status, response.data);
  } catch (error: any) {
    if (error.response) {
      console.error('Error del servidor:', error.response.status, error.response.data);
    } else {
      console.error('Error al enviar la petición:', error.message);
    }
  }
}

testWebhook();
