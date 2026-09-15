/*!
 * antibot.js — formularios publicos de FishFlow
 *
 * En uso: mariocitalan.net, la landing de Enlace Integral y fishflow.mx.
 *
 * Del 12 al 15 de septiembre de 2026 entraron 7 registros falsos al panel de
 * Mario: nombre y mensaje de letras aleatorias, teléfono inventado, y correo
 * REAL de un tercero. El correo válido es el objetivo del ataque, no un
 * descuido: el bot quiere que el acuse automático del sitio le llegue a esa
 * persona (list-bombing). El riesgo es que marquen el correo como spam y se
 * queme la reputación del remitente.
 *
 * Este archivo pone dos señales en cada envío, sin tocar la lógica de ningún
 * formulario y sin que el visitante note nada:
 *
 *   _hp  Honeypot. Un campo escondido fuera de la pantalla que ningún humano
 *        ve ni llena. Si llega con algo, quien lo llenó fue un programa.
 *   _ts  El milisegundo en que cargó la página. El servidor descarta lo que
 *        haya tardado menos de 3 segundos en enviarse.
 *
 * Funciona envolviendo window.fetch: cualquier POST hacia fishflow.mx/api/
 * sale con las dos señales agregadas al JSON, venga del formulario que venga.
 * Por eso basta cargarlo una vez en el <head> y no hay que editar nada más.
 *
 * El servidor responde 200 a un envío bloqueado, como si hubiera entrado: un
 * error le enseñaría al bot qué campo cambiar.
 */
(function () {
  var T0 = Date.now();
  var CAMPO = '_hp';

  /* Un honeypot por formulario. Se crea desde JS, no vive en el HTML: un bot
     que solo lee el código fuente no lo encuentra, y uno que automatiza un
     navegador real sí lo ve y lo llena, que es justo lo que queremos. */
  function sembrar() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('[name="' + CAMPO + '"]')) continue;
      var caja = document.createElement('div');
      caja.setAttribute('aria-hidden', 'true');
      caja.style.cssText =
        'position:absolute!important;left:-9999px!important;top:auto!important;' +
        'width:1px!important;height:1px!important;overflow:hidden!important';
      var input = document.createElement('input');
      input.type = 'text';
      input.name = CAMPO;
      input.id = CAMPO + '-' + i;
      input.tabIndex = -1;
      input.autocomplete = 'off';
      var label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.textContent = 'Deja este campo vacío';
      caja.appendChild(label);
      caja.appendChild(input);
      forms[i].appendChild(caja);
    }
  }

  function valorHoneypot() {
    var campos = document.querySelectorAll('[name="' + CAMPO + '"]');
    for (var i = 0; i < campos.length; i++) {
      if (campos[i].value) return campos[i].value;
    }
    return '';
  }

  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal !== 'function') return;

  window.fetch = function (entrada, opciones) {
    try {
      var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
      /* Dos formas de llamar al mismo sitio: la URL absoluta (sitios en otro
         dominio, como mariocitalan.net o la landing de Enlace) y la ruta
         relativa (paginas servidas desde fishflow.mx). */
      var nuestra = url.indexOf('fishflow.mx/api/') !== -1 || url.indexOf('/api/') === 0;
      if (nuestra && opciones && typeof opciones.body === 'string') {
        var datos = JSON.parse(opciones.body);
        if (datos && typeof datos === 'object' && !Array.isArray(datos)) {
          datos._ts = T0;
          datos._hp = valorHoneypot();
          var copia = {};
          for (var k in opciones) if (Object.prototype.hasOwnProperty.call(opciones, k)) copia[k] = opciones[k];
          copia.body = JSON.stringify(datos);
          opciones = copia;
        }
      }
    } catch (e) {
      /* Si algo falla aquí, el envío sigue su curso sin las señales: nunca
         romper un formulario real por culpa del filtro. */
    }
    return fetchOriginal.call(this, entrada, opciones);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sembrar);
  } else {
    sembrar();
  }
})();
