/* Marca dinámica de la documentación.
 *
 * El sitio de docs es estático (MkDocs); el nombre y el logo de la instalación
 * viven en la plataforma. Como nginx sirve /docs y /api en el MISMO origen,
 * aquí se consulta la API pública en runtime y se pinta la marca real en la
 * cabecera. Si la API no responde (p. ej. docs abiertos fuera del stack), el
 * sitio queda con el nombre estático de mkdocs.yml — nunca es un error visible.
 */
(function () {
  var NOMBRE_ESTATICO = "Documentación";

  function aplicarNombre(nombre) {
    document
      .querySelectorAll(".md-header__topic:first-child .md-ellipsis")
      .forEach(function (el) {
        el.textContent = nombre;
      });
    // Título del drawer móvil: es un nodo de texto junto al botón-logo.
    document.querySelectorAll(".md-nav--primary > .md-nav__title").forEach(function (el) {
      el.childNodes.forEach(function (nodo) {
        if (nodo.nodeType === Node.TEXT_NODE && nodo.textContent.trim()) {
          nodo.textContent = " " + nombre + " ";
        }
      });
    });
    if (document.title.indexOf(NOMBRE_ESTATICO) !== -1) {
      document.title = document.title.replace(NOMBRE_ESTATICO, nombre + " · " + NOMBRE_ESTATICO);
    }
  }

  function aplicarLogo(url, alt) {
    document.querySelectorAll(".md-logo").forEach(function (ancla) {
      var img = document.createElement("img");
      img.src = url;
      img.alt = alt || "Logo";
      ancla.replaceChildren(img);
    });
  }

  fetch("/api/v1/public/branding", { credentials: "omit" })
    .then(function (respuesta) {
      return respuesta.ok ? respuesta.json() : null;
    })
    .then(function (marca) {
      if (!marca) return;
      if (marca.name) aplicarNombre(marca.name);
      if (marca.has_logo) {
        var version = marca.logo_version ? "?v=" + encodeURIComponent(marca.logo_version) : "";
        aplicarLogo("/api/v1/public/branding/logo" + version, marca.name);
      }
    })
    .catch(function () {
      /* sin red: queda la marca estática */
    });
})();
