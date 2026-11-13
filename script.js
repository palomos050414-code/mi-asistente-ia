// ===== Configuración =====
const API_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODELO = 'deepseek-v4-pro-0813';           // Modo normal: rápido, sin streaming
const MODELO_RAZONAMIENTO = 'qwen3.8-2.4t-a95b'; // "Pensamiento Profundo": reasoning puro, exige streaming
const CLAVE_STORAGE = 'dashscope_api_key'; // Nombre de la clave en sessionStorage
const PENSAMIENTO_STORAGE = 'pensamiento_profundo'; // Estado del chip "Pensamiento Profundo"
const MAX_HISTORIAL = 20;                   // Mensajes recientes que se envían al modelo
const TEMA_STORAGE = 'tema_asistente';      // Tema elegido (localStorage: no es un dato sensible)
const ACENTO_STORAGE = 'acento_asistente';  // Paleta de acento elegida (localStorage)
const TEMAS = ['oscuro', 'claro'];
const ACENTOS = ['violeta', 'rosa', 'coral'];

// Instrucciones de personalidad del asistente
const PROMPT_SISTEMA = `Eres Valentina, vendedora virtual de una tienda de maquillaje.
Responde siempre en español, con un tono amable, cercano y profesional.
- Saluda y haz preguntas breves para conocer el tipo de piel, el tono, el look que busca y su presupuesto.
- Recomienda categorías de productos (base, corrector, polvos, rubor, sombras, labiales, máscaras de pestañas, desmaquillantes, etc.) y explica por qué sirven para cada necesidad.
- No inventes precios, existencias, promociones ni datos de envío. Si preguntan por ellos, indica que pueden consultar el catálogo oficial de la tienda o hablar con un asesor humano.
- Da consejos básicos de uso y cuidado de la piel, sin hacer diagnósticos médicos. Si hay una reacción alérgica o molestia en la piel, recomienda consultar a un dermatólogo.
- Mantén las respuestas cortas (3 a 5 oraciones, salvo que el usuario pida más detalle) y termina, cuando sea natural, con una pregunta que guíe la compra.
- Si el tema no tiene relación con maquillaje o ventas, declina con amabilidad y reconduce la conversación.`;

// Mensajes amables que se muestran al usuario en cada caso de error
const MENSAJES = {
  limite: 'Estamos recibiendo muchas consultas en este momento. Por favor, espera unos segundos e inténtalo de nuevo.',
  clave: 'La clave de Alibaba Cloud (Model Studio) no es válida o no tiene permisos. Revísala en la barra lateral e inténtalo de nuevo.',
  sinClave: 'Para conversar conmigo necesito tu clave de Alibaba Cloud (Model Studio). Pégala en la barra lateral, guárdala e inténtalo de nuevo. 😊',
  modelo: 'El modelo configurado no está disponible en este momento. Avisa al administrador e inténtalo más tarde.',
  red: 'No pude conectarme en este momento. Revisa tu conexión a internet e inténtalo de nuevo.',
  generico: 'Ocurrió un problema inesperado. Por favor, inténtalo de nuevo en un momento.'
};

// ===== Referencias al DOM =====
const app = document.getElementById('app');
const formClave = document.getElementById('form-clave');
const inputClave = document.getElementById('input-clave');
const btnBorrarClave = document.getElementById('btn-borrar-clave');
const avisoClave = document.getElementById('aviso-clave');
const btnSidebar = document.getElementById('btn-sidebar');
const btnNuevo = document.getElementById('btn-nuevo');
const btnPensamiento = document.getElementById('btn-pensamiento');
const chat = document.getElementById('chat');
const bienvenida = document.getElementById('bienvenida');
const mensajes = document.getElementById('mensajes');
const formChat = document.getElementById('form-chat');
const textarea = document.getElementById('mensaje');
const btnEnviar = document.getElementById('btn-enviar');
const btnTema = document.getElementById('btn-tema');
const radiosAcento = document.querySelectorAll('input[name="acento"]');
const consultaClaro = window.matchMedia('(prefers-color-scheme: light)');
const sugerencias = document.getElementById('sugerencias');

// Historial de la conversación en memoria (solo mensajes de usuario y asistente)
let historial = [];
// Evita envíos duplicados mientras se espera respuesta
let enviando = false;
// Estado del modo "Pensamiento Profundo" (modelo de razonamiento con streaming)
let pensamientoActivo = false;
// Referencia al indicador "escribiendo..."
let indicadorEscribiendo = null;

// ===== Inicio =====
function iniciar() {
  // Tema y paleta (independiente de la clave y del chat)
  iniciarTema();

  // Si hay una clave guardada en esta sesión, la rellenamos
  const claveGuardada = obtenerClave();
  if (claveGuardada) {
    inputClave.value = claveGuardada;
    mostrarAviso('Clave cargada desde esta sesión.', 'ok');
  }

  // Restaura el modo "Pensamiento Profundo" elegido en esta sesión
  if (sessionStorage.getItem(PENSAMIENTO_STORAGE) === '1') {
    pensamientoActivo = true;
    pintarPensamiento();
  }

  formClave.addEventListener('submit', guardarClave);
  btnBorrarClave.addEventListener('click', borrarClave);
  btnSidebar.addEventListener('click', alternarBarraLateral);
  btnNuevo.addEventListener('click', nuevoChat);
  btnPensamiento.addEventListener('click', alternarPensamiento);
  formChat.addEventListener('submit', enviarMensaje);
  textarea.addEventListener('input', ajustarAltura);
  textarea.addEventListener('keydown', manejarTeclado);
  sugerencias.addEventListener('click', usarSugerencia);
}

// ===== Tema y paleta =====

// Lee de localStorage sin romper si el navegador lo bloquea
function leerPreferencia(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

// Guarda en localStorage; si no se puede, la preferencia dura solo esta visita
function guardarPreferencia(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento disponible: se ignora
  }
}

// Aplica el tema en <html> y actualiza el aria-label del interruptor
function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  btnTema.setAttribute('aria-label', tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
}

// Aplica la paleta en <html> y marca el radio correspondiente
function aplicarAcento(acento) {
  document.documentElement.dataset.acento = acento;
  radiosAcento.forEach((radio) => {
    radio.checked = radio.value === acento;
  });
}

// Alterna oscuro/claro y recuerda la elección manual
function alternarTema() {
  const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  aplicarTema(nuevo);
  guardarPreferencia(TEMA_STORAGE, nuevo);
}

// Cambia la paleta de acento desde el selector
function elegirAcento(evento) {
  aplicarAcento(evento.target.value);
  guardarPreferencia(ACENTO_STORAGE, evento.target.value);
}

// Sigue el tema del sistema solo si el usuario no eligió uno manualmente
function alCambiarTemaSistema(evento) {
  if (TEMAS.includes(leerPreferencia(TEMA_STORAGE))) return;
  aplicarTema(evento.matches ? 'claro' : 'oscuro');
}

// Sincroniza la interfaz con lo que dejó el <head> y registra los eventos
function iniciarTema() {
  const guardado = leerPreferencia(TEMA_STORAGE);
  aplicarTema(TEMAS.includes(guardado) ? guardado : (consultaClaro.matches ? 'claro' : 'oscuro'));

  const acentoGuardado = leerPreferencia(ACENTO_STORAGE);
  aplicarAcento(ACENTOS.includes(acentoGuardado) ? acentoGuardado : 'violeta');

  btnTema.addEventListener('click', alternarTema);
  radiosAcento.forEach((radio) => radio.addEventListener('change', elegirAcento));
  consultaClaro.addEventListener('change', alCambiarTemaSistema);
}

// ===== Gestión de la clave =====

// Devuelve la clave guardada en sessionStorage (o cadena vacía)
function obtenerClave() {
  return sessionStorage.getItem(CLAVE_STORAGE) || '';
}

// Guarda la clave escrita por el usuario en sessionStorage
function guardarClave(evento) {
  evento.preventDefault();
  const clave = inputClave.value.trim();

  if (!clave) {
    mostrarAviso('Escribe tu clave antes de guardar.', 'error');
    return;
  }

  sessionStorage.setItem(CLAVE_STORAGE, clave);
  mostrarAviso('✓ Clave guardada en esta sesión.', 'ok');
}

// Elimina la clave de sessionStorage y limpia el campo
function borrarClave() {
  sessionStorage.removeItem(CLAVE_STORAGE);
  inputClave.value = '';
  mostrarAviso('La clave fue eliminada.', 'ok');
}

// Muestra un aviso visual en la barra lateral
function mostrarAviso(texto, tipo) {
  avisoClave.textContent = texto;
  avisoClave.className = `aviso ${tipo}`;
}

// ===== Interfaz =====

// Muestra u oculta la barra lateral según el tamaño de pantalla
function alternarBarraLateral() {
  const esMovil = window.matchMedia('(max-width: 899px)').matches;
  const claseActiva = esMovil ? 'menu-abierto' : 'menu-oculto';
  const estaOculta = esMovil
    ? !app.classList.contains('menu-abierto')
    : app.classList.contains('menu-oculto');

  app.classList.toggle(claseActiva);
  btnSidebar.setAttribute('aria-expanded', String(estaOculta));
}

// Refleja el estado del modo pensamiento en el chip
function pintarPensamiento() {
  btnPensamiento.classList.toggle('chip-activa', pensamientoActivo);
  btnPensamiento.setAttribute('aria-pressed', String(pensamientoActivo));
}

// Activa o desactiva el modelo de razonamiento profundo
function alternarPensamiento() {
  pensamientoActivo = !pensamientoActivo;
  sessionStorage.setItem(PENSAMIENTO_STORAGE, pensamientoActivo ? '1' : '0');
  pintarPensamiento();
}

// Reinicia la conversación
function nuevoChat() {
  historial = [];
  mensajes.innerHTML = '';
  bienvenida.classList.remove('oculta');
  textarea.focus();
}

// Oculta el saludo inicial al empezar la conversación
function ocultarBienvenida() {
  bienvenida.classList.add('oculta');
}

// Añade una burbuja de mensaje (usa textContent para evitar inyección de HTML)
function agregarMensaje(rol, texto, esError = false) {
  const burbuja = document.createElement('div');
  burbuja.className = `mensaje mensaje-${rol}` + (esError ? ' mensaje-error' : '');
  burbuja.textContent = texto;
  mensajes.appendChild(burbuja);
  desplazarAlFinal();
  return burbuja;
}

// Muestra el indicador "escribiendo..." (o "pensando..." en modo profundo)
function mostrarEscribiendo(texto = 'Valentina está escribiendo') {
  indicadorEscribiendo = document.createElement('div');
  indicadorEscribiendo.className = 'mensaje mensaje-asistente escribiendo';
  indicadorEscribiendo.setAttribute('aria-label', texto);
  indicadorEscribiendo.innerHTML = '<span></span><span></span><span></span>';
  mensajes.appendChild(indicadorEscribiendo);
  desplazarAlFinal();
}

// Quita el indicador "escribiendo..."
function ocultarEscribiendo() {
  if (indicadorEscribiendo) {
    indicadorEscribiendo.remove();
    indicadorEscribiendo = null;
  }
}

// Desplaza el chat hasta el último mensaje
function desplazarAlFinal() {
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

// Activa o desactiva el botón de enviar
function establecerEnviando(valor) {
  enviando = valor;
  btnEnviar.disabled = valor;
}

// Ajusta la altura del textarea según su contenido
function ajustarAltura() {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
}

// Enter envía el mensaje; Shift + Enter agrega un salto de línea
function manejarTeclado(evento) {
  if (evento.key === 'Enter' && !evento.shiftKey) {
    evento.preventDefault();
    formChat.requestSubmit();
  }
}

// Rellena el cuadro de texto con la sugerencia elegida (sin enviarla)
function usarSugerencia(evento) {
  const boton = evento.target.closest('.sugerencia');
  if (!boton) return;
  textarea.value = boton.dataset.texto;
  ajustarAltura();
  textarea.focus();
}

// ===== Envío de mensajes =====
async function enviarMensaje(evento) {
  evento.preventDefault();
  if (enviando) return;

  const texto = textarea.value.trim();
  if (!texto) return;

  const clave = obtenerClave();
  if (!clave) {
    ocultarBienvenida();
    agregarMensaje('asistente', MENSAJES.sinClave, true);
    return;
  }

  // Preparar la interfaz para la respuesta
  ocultarBienvenida();
  agregarMensaje('usuario', texto);
  historial.push({ role: 'user', content: texto });
  textarea.value = '';
  ajustarAltura();
  establecerEnviando(true);
  mostrarEscribiendo(pensamientoActivo ? 'Valentina está pensando' : 'Valentina está escribiendo');
  let burbujaStreaming = null;

  try {
    let respuesta;
    if (pensamientoActivo) {
      // Modo "Pensamiento Profundo": streaming con la respuesta creciendo en vivo
      respuesta = await llamarModeloStreaming(clave, {
        alPrimerFragmento() {
          ocultarEscribiendo();
          burbujaStreaming = agregarMensaje('asistente', '');
        },
        alAvance(texto) {
          burbujaStreaming.textContent = texto;
          desplazarAlFinal();
        }
      });
      burbujaStreaming.textContent = respuesta;
    } else {
      respuesta = await llamarModelo(clave);
      agregarMensaje('asistente', respuesta);
    }
    historial.push({ role: 'assistant', content: respuesta });
  } catch (error) {
    // Si una respuesta a medias quedó en pantalla, la retiramos
    if (burbujaStreaming) burbujaStreaming.remove();
    // Mostramos el error como burbuja del asistente y quitamos el mensaje sin respuesta
    agregarMensaje('asistente', error.message, true);
    historial.pop();
  } finally {
    ocultarEscribiendo();
    establecerEnviando(false);
    textarea.focus();
  }
}

// ===== Conexión con el modelo =====

// Construye los mensajes para la API.
// DeepSeek-V4 acepta el rol "system": las instrucciones de Valentina
// van como mensaje de sistema real.
function construirMensajes() {
  return [
    { role: 'system', content: PROMPT_SISTEMA },
    ...historial.slice(-MAX_HISTORIAL)
  ];
}

// Realiza la petición a Model Studio y devuelve el texto de la respuesta
async function llamarModelo(clave) {
  let respuesta;
  try {
    respuesta = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clave}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODELO,
        messages: construirMensajes(),
        enable_thinking: false // DeepSeek-V4 es reasoning: lo desactivamos para respuesta inmediata
      })
    });
  } catch (error) {
    console.error('Error de red al llamar a Model Studio:', error);
    throw new Error(MENSAJES.red);
  }

  if (!respuesta.ok) {
    // Mostramos en consola el detalle que devuelve la API para diagnosticar
    const detalle = await respuesta.text().catch(() => '');
    let detalleError = detalle;
    try {
      const datosError = JSON.parse(detalle);
      if (datosError?.error) {
        detalleError = `${datosError.error.code ?? 'sin código'}: ${datosError.error.message ?? ''}`;
      }
    } catch {
      // El cuerpo no era JSON: conservamos el texto crudo para el log
    }
    console.error(`Model Studio respondió ${respuesta.status}:`, detalleError);
    throw new Error(mensajeParaEstado(respuesta.status));
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch (error) {
    console.error('La respuesta no es JSON válido:', error);
    throw new Error(MENSAJES.generico);
  }

  const contenido = datos?.choices?.[0]?.message?.content;
  if (!contenido) {
    console.error('Respuesta sin contenido:', datos);
    throw new Error(MENSAJES.generico);
  }

  return contenido.trim();
}

// Realiza la petición en streaming al modelo de razonamiento (qwen3.8-2.4t-a95b).
// La respuesta llega por eventos SSE: avisamos con alPrimerFragmento cuando hay
// texto real y con alAvance en cada avance, para ver la respuesta crecer.
async function llamarModeloStreaming(clave, { alPrimerFragmento, alAvance }) {
  let respuestaApi;
  try {
    respuestaApi = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clave}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODELO_RAZONAMIENTO,
        messages: construirMensajes(),
        enable_thinking: true, // Este modelo solo piensa: el razonamiento es obligatorio
        stream: true
      })
    });
  } catch (error) {
    console.error('Error de red al llamar a Model Studio:', error);
    throw new Error(MENSAJES.red);
  }

  if (!respuestaApi.ok) {
    // Mismo diagnóstico que en la ruta normal
    const detalle = await respuestaApi.text().catch(() => '');
    let detalleError = detalle;
    try {
      const datosError = JSON.parse(detalle);
      if (datosError?.error) {
        detalleError = `${datosError.error.code ?? 'sin código'}: ${datosError.error.message ?? ''}`;
      }
    } catch {
      // El cuerpo no era JSON: conservamos el texto crudo para el log
    }
    console.error(`Model Studio respondió ${respuestaApi.status}:`, detalleError);
    throw new Error(mensajeParaEstado(respuestaApi.status));
  }

  // Leemos el flujo SSE: líneas "data: {json}" separadas por líneas en blanco
  const lector = respuestaApi.body.getReader();
  const decodificador = new TextDecoder();
  let bufer = '';
  let texto = '';
  let razonamiento = '';
  let avisado = false;

  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      bufer += decodificador.decode(value, { stream: true });

      const lineas = bufer.split('\n');
      bufer = lineas.pop(); // La última línea puede venir incompleta
      for (const linea of lineas) {
        const limpia = linea.trim();
        if (!limpia.startsWith('data:')) continue; // Ignora comentarios y keep-alives
        const datos = limpia.slice(5).trim();
        if (datos === '[DONE]') continue;

        let trozo;
        try {
          trozo = JSON.parse(datos);
        } catch {
          continue; // Fragmento corrupto: se descarta sin romper el flujo
        }

        const delta = trozo?.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) razonamiento += delta.reasoning_content;
        if (delta.content) {
          if (!avisado) {
            avisado = true;
            alPrimerFragmento();
          }
          texto += delta.content;
          alAvance(texto);
        }
      }
    }
  } catch (error) {
    console.error('Error leyendo la respuesta en streaming:', error);
    throw new Error(MENSAJES.generico);
  }

  if (!texto.trim()) {
    // El modelo pensó pero no devolvió contenido visible
    console.error('Respuesta en streaming sin contenido. Razonamiento (final):', razonamiento.slice(-400));
    throw new Error(MENSAJES.generico);
  }

  return texto.trim();
}

// Devuelve el mensaje amable según el código de estado HTTP
function mensajeParaEstado(codigo) {
  if (codigo === 429) return MENSAJES.limite;
  if (codigo === 401 || codigo === 403) return MENSAJES.clave;
  if (codigo === 404) return MENSAJES.modelo;
  return MENSAJES.generico;
}

// ===== Arranque =====
iniciar();
