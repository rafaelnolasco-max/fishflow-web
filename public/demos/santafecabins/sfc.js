/* Santa Fe Cabins — demo FishFlow · utilidades compartidas */
(function () {
  window.toggleMenu = function () {
    var m = document.getElementById('mobileMenu');
    var b = document.getElementById('burger');
    if (!m) return;
    var open = m.classList.toggle('open');
    if (b) {
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
      b.innerHTML = open ? '&#10005;' : '&#9776;';
    }
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest('#mobileMenu a');
    if (a) {
      var m = document.getElementById('mobileMenu');
      var b = document.getElementById('burger');
      if (m) m.classList.remove('open');
      if (b) { b.setAttribute('aria-expanded', 'false'); b.innerHTML = '&#9776;'; }
    }
  });
})();

/* Formato de moneda MXN */
function mxn(n) {
  return '$' + Math.round(n).toLocaleString('es-MX');
}
