'use strict';

const CLAVE_TEMA = 'armando_pc11_tema_v1';
const $ = (selector) => document.querySelector(selector);
// Obtener URL de imagen del producto guardada en la base de datos
function imagenProducto(p) {
  const url = p.imagen || "";
  return /^https?:\/\/[a-z0-9.-]+\//i.test(url) ? url : "";
}
// Fotos de los productos utilizadas en el catálogo y en el carrito.
function fotoProducto(p, clase = '') {
  const url = imagenProducto(p);
  const emoji = `<span class="foto-respaldo" aria-hidden="true">${esc(p.icono || '📦')}</span>`;
  if (!url) return `<div class="foto-producto sin-imagen ${clase}">${emoji}</div>`;
  return `<div class="foto-producto ${clase}"><img src="${esc(url)}" alt="Fotografía de ${esc(p.nombre)}" loading="lazy" referrerpolicy="no-referrer">${emoji}</div>`;
}
document.addEventListener('error', (evento) => {
  if (evento.target instanceof HTMLImageElement && evento.target.closest('.foto-producto')) {
    evento.target.closest('.foto-producto').classList.add('sin-imagen');
  }
}, true);
document.addEventListener('load', (evento) => {
  if (evento.target instanceof HTMLImageElement && evento.target.closest('.foto-producto')) {
    evento.target.closest('.foto-producto').classList.add('cargada');
  }
}, true);

const moneda = (n) => 'S/ ' + Number(n || 0).toFixed(2);
const hoy = () => { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const ahora = () => new Date().toLocaleString('es-PE');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const datosVacios = () => ({productos:[],proveedores:[],usuarios:[],ventas:[],movimientos:[],cierres:[],clientes:[],caja:{abierta:false,inicio:0,numero:0}});
let datos=datosVacios();
let sesion=null;
// [EXPOSICIÓN] Punto central de comunicación: JavaScript envía peticiones HTTP al backend Node.js.
async function api(metodo,ruta,cuerpo) {
  const opciones={method:metodo,credentials:'same-origin',headers:{'Content-Type':'application/json'}};
  if(cuerpo!==undefined)opciones.body=JSON.stringify(cuerpo);
  let respuesta;
  try{respuesta=await fetch(ruta,opciones);}catch{throw Error('No hay conexión con el servidor.');}
  let resultado;
  try{resultado=await respuesta.json();}catch{throw Error('El servidor devolvió una respuesta inesperada.');}
  if(!respuesta.ok)throw Error(resultado.error||'La operación no pudo completarse.');
  return resultado;
}
async function sincronizar() {datos=await api('GET','/api/estado');render();}
let area = 'cliente';
let vistaCliente = 'catalogo';
let vistaPersonal = 'panel';
let periodoDashboard = 'todo';
let carrito = {};
let carritoPos = {};
let filtros = {clienteTexto:'',clienteCategoria:'Todas',adminTexto:'',adminCategoria:'Todas',adminEstado:'Todos',reporteDesde:'',reporteHasta:''};
let reciboActivo = null;
let contextoDialogo = null;


function notificar(texto, tipo='exito') {
  const n = $('#mensaje');n.textContent = texto;n.className = 'mensaje visible ' + tipo;
  clearTimeout(notificar.temporizador);
  notificar.temporizador = setTimeout(() => n.className = 'mensaje', 4200);
}
function rol() { return sesion?.rol || ''; }
function esCliente() { return rol() === 'cliente'; }
const permisos = {
  admin:['panel','productos','inventario','proveedores','ventas','comprobantes','caja','usuarios','reportes'],
  almacen:['productos','inventario','proveedores'],
  cajero:['ventas','comprobantes','caja']
};
function puede(vista) { return Boolean(sesion && permisos[rol()]?.includes(vista)); }
function puedeEditar(vista) { return puede(vista); }
function opciones(v) { return [...new Set(v)].sort((a,b) => a.localeCompare(b,'es')); }
function idSiguiente(lista) { return 1 + Math.max(0, ...lista.map(x => x.id || 0)); }
function producto(id) { return datos.productos.find(p => p.id === Number(id)); }
function activos() { return datos.productos.filter(p => p.activo); }
function stockBajo() { return activos().filter(p => p.stock <= p.minimo); }
// La estructura de las pantallas está en index.html dentro de <template>.
// JavaScript solo coloca valores dinámicos y atiende las acciones del usuario.
// [EXPOSICIÓN] El HTML está en <template> dentro de index.html. Esta función coloca contenido dinámico.
function plantilla(nombre, valores = {}) {
  const elemento = document.getElementById('tpl-' + nombre);
  if (!elemento) throw Error('No se encontró la plantilla HTML: ' + nombre);
  return elemento.innerHTML
    .replace(/<!--\{\{([A-Z_]+)\}\}-->/g, (_, campo) =>
      Object.hasOwn(valores, campo) ? String(valores[campo]) : '')
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, campo) =>
      Object.hasOwn(valores, campo) ? String(valores[campo]) : '');
}
function encabezado(titulo, descripcion, accion = '') {
  return plantilla('encabezado', {
    AREA: area === 'personal' ? 'Gestión interna' : 'Tienda',
    TITULO: esc(titulo), DESCRIPCION: esc(descripcion), ACCIONES: accion
  });
}

function etiqueta(texto, tipo='') { return `<span class="etiqueta ${tipo}">${esc(texto)}</span>`; }
function categorias() { return opciones(activos().map(p => p.categoria)); }
function categoriaSelect(valor='Todas') {
  return ['Todas',...categorias()].map(v => `<option value="${esc(v)}" ${v===valor?'selected':''}>${esc(v)}</option>`).join('');
}
function tablaVacia(columnas, mensaje) { return `<tr><td colspan="${columnas}" class="vacio">${mensaje}</td></tr>`; }
function seccion(nombre) { if (area === 'cliente') vistaCliente=nombre; else if(puede(nombre)) vistaPersonal=nombre; else notificar('No tienes permiso para esta pantalla.','error'); render(); }
function cambiarArea(nombre) { area=nombre;render(); }

function render() {
  document.querySelectorAll('[data-area]').forEach(b => {
    const activo=b.dataset.area === area;
    b.classList.toggle('activo',activo);b.setAttribute('aria-pressed',String(activo));
  });
  $('#boton-tema').textContent=document.body.classList.contains('tema-oscuro')?'☀':'☾';
  $('#contenido').innerHTML = area === 'cliente' ? mostrarCliente() : mostrarPersonal();
  if(area === 'personal' && vistaPersonal === 'panel' && puede('panel')) dibujarDashboard();
  if(area === 'personal' && vistaPersonal === 'reportes' && puede('reportes')) dibujarReporte();
}

// 1. TIENDA: las barras, formularios y secciones viven en index.html.
function mostrarCliente() {
  const pantallas = {catalogo:catalogoCliente, carrito:verCarrito,
                     historial:historialCliente, cuenta:cuentaCliente};
  const cantidad = Object.values(carrito).reduce((s, n) => s + n, 0);
  return plantilla('cliente', {
    FOTOS:[datos.productos[0],datos.productos[2],datos.productos[3]]
      .filter(Boolean).map(p => fotoProducto(p, 'foto-hero')).join(''),
    ACT_CATALOGO:vistaCliente==='catalogo'?'activo':'',
    ACT_CARRITO:vistaCliente==='carrito'?'activo':'',
    ACT_HISTORIAL:vistaCliente==='historial'?'activo':'',
    ACT_CUENTA:vistaCliente==='cuenta'?'activo':'',
    CANTIDAD:cantidad,
    TEXTO_CUENTA:esCliente()?'Hola, '+esc(sesion.nombre.split(' ')[0]):'Ingresar / Registrarme',
    BOTON_SALIR:esCliente()?'<button class="btn btn-outline-secondary boton" data-accion="salir">Cerrar sesión</button>':'',
    CONTENIDO:pantallas[vistaCliente]()
  });
}
// [HU-01/HU-02] Muestra el catálogo y aplica los filtros del cliente.
function catalogoCliente() {
  const busqueda = filtros.clienteTexto.toLocaleLowerCase('es');
  const lista = activos().filter(p =>
    `${p.nombre} ${p.codigo}`.toLocaleLowerCase('es').includes(busqueda) &&
    (filtros.clienteCategoria === 'Todas' || p.categoria === filtros.clienteCategoria));
  const tarjetas = lista.map(p => `
    <div class="col"><article class="tarjeta card producto h-100">
      ${fotoProducto(p)}
      <div class="fila"><small>${esc(p.categoria)}</small>${etiqueta(p.stock?'Disponible':'Sin stock',p.stock?'':'error')}</div>
      <h3>${esc(p.nombre)}</h3>
      <p>${esc(p.codigo)} · ${p.stock} unidades disponibles</p>
      <div class="fila"><strong class="monto">${moneda(p.precio)}</strong>
        <button type="button" class="btn btn-primary boton primario pequeno" data-accion="agregar-carrito" data-id="${p.id}" ${p.stock<=0?'disabled':''}>+ Agregar</button>
      </div>
    </article></div>`).join('');
  return plantilla('catalogo', {
    ENCABEZADO:encabezado('Catálogo de productos','Consulta precios y disponibilidad. Verifica la disponibilidad antes de añadir al carrito.'),
    BUSQUEDA:esc(filtros.clienteTexto),
    CATEGORIAS:categoriaSelect(filtros.clienteCategoria),
    PRODUCTOS:tarjetas || '<div class="col-12"><p class="vacio">No se encontraron productos con estos filtros.</p></div>'
  });
}
// [HU-03/HU-15] Total de compra, método de pago externo y referencia.
function resumenCarrito(items, origen) {
  const subtotal=items.reduce((s,item)=>s+item.precio*item.cantidad,0);
  return plantilla('resumen-compra', {
    SUBTOTAL:moneda(subtotal),
    TIPO_FORMULARIO:origen==='cliente'?'comprar':'registrar-pos',
    ETIQUETA_PAGO:origen==='cliente'?'Medio de pago (verificación externa)':'Forma de pago',
    OPCIONES_PAGO:origen==='cliente'?'<option>Yape</option><option>Tarjeta</option>':'<option>Efectivo</option><option>Yape</option><option>Tarjeta</option>',
    CAMPO_REFERENCIA:origen==='cliente'?'<label class="campo"><span>Referencia del pago externo</span><input class="form-control" name="referencia" required minlength="5" maxlength="100" placeholder="Número de operación Yape / referencia del operador de tarjeta"></label><small>El pedido reserva unidades. El personal verificará el pago por un canal externo. No ingreses números ni CVV de tarjetas.</small>':'',
    CAMPO_RECIBIDO:origen==='pos'?'<label class="campo"><span>Efectivo recibido (solo si paga en efectivo)</span><input class="form-control" type="number" name="recibido" min="0" step="0.01" placeholder="Importe recibido"></label>':'',
    DESHABILITADO:items.length?'':'disabled',
    TEXTO_BOTON:origen==='cliente'?'Enviar pedido para verificar pago':'Registrar venta'
  });
}
function resumenItems(cantidades) {
  return Object.entries(cantidades).map(([id,cantidad]) => {
    const p=producto(id);
    return p ? {...p,cantidad:Number(cantidad)} : null;
  }).filter(Boolean);
}
// [HU-03] Se agregan, quitan o ajustan productos, sin exceder el stock.
function verCarrito() {
  const items=resumenItems(carrito);
  const filas=items.map(p=>`
    <div class="item-carrito">${fotoProducto(p,'foto-carrito')}
      <div class="datos-item"><strong>${esc(p.nombre)}</strong><small>${moneda(p.precio)} cada uno · Stock: ${p.stock}</small></div>
      <div class="cantidad"><button data-accion="menos" data-id="${p.id}" data-origen="cliente" aria-label="Restar una unidad de ${esc(p.nombre)}">−</button>
      <span>${p.cantidad}</span><button data-accion="mas" data-id="${p.id}" data-origen="cliente" aria-label="Añadir una unidad de ${esc(p.nombre)}">+</button></div>
      <strong class="monto">${moneda(p.precio*p.cantidad)}</strong>
      <button class="enlace" data-accion="quitar" data-id="${p.id}" data-origen="cliente">Quitar</button>
    </div>`).join('');
  return plantilla('carrito', {
    ENCABEZADO:encabezado('Mi carrito','Compra para recojo en tienda: indica una referencia de pago Yape o tarjeta externa. Se reservará el stock; el cajero verificará el cobro.'),
    ITEMS:filas || '<div class="vacio">Tu carrito está vacío. Visita el catálogo y agrega productos.</div>',
    VACIAR:items.length?'<button class="btn btn-outline-secondary boton" data-accion="vaciar-carrito">Vaciar carrito</button>':'',
    RESUMEN:resumenCarrito(items,'cliente')
  });
}
// [HU-04/HU-15] El cliente comprueba PENDIENTE, PAGADA y ENTREGADA.
function historialCliente() {
  if(!esCliente())return plantilla('historial-invitado', {
    ENCABEZADO:encabezado('Historial de compras','Inicia sesión para consultar tus pedidos.')
  });
  const ventas=datos.ventas.filter(v=>v.cliente===sesion.usuario).slice().reverse();
  const filas=ventas.map(v=>`<tr><td>${esc(v.numero)}</td><td>${esc(v.fecha)}</td>
    <td>${esc(v.pago)} · ${esc(v.estado)} · ${esc(v.entrega || 'PENDIENTE')}</td><td>${v.items.length}</td><td class="monto">${moneda(v.total)}</td>
    <td><button class="enlace" data-accion="ver-comprobante" data-id="${v.id}">Ver detalle</button></td></tr>`).join('');
  return plantilla('historial', {
    ENCABEZADO:encabezado('Mis compras','Pedidos asociados a tu cuenta.'),
    FILAS:filas || tablaVacia(6,'Todavía no hay compras registradas.')
  });
}
function cuentaCliente() {
  if(esCliente())return plantilla('cuenta-cliente', {
    ENCABEZADO:encabezado('Mi cuenta','Información de tu cuenta.'),
    NOMBRE:esc(sesion.nombre),USUARIO:esc(sesion.usuario)
  });
  return plantilla('cuenta-registro', {
    ENCABEZADO:encabezado('Acceso del cliente','Registro e inicio de sesión del módulo de Ventas.')
  });
}

// 2. PANEL INTERNO: la navegación está escrita en HTML y se filtra por permisos.
function mostrarPersonal() {
  if(!sesion || esCliente())return formularioPersonal();
  if(!puede(vistaPersonal))vistaPersonal=permisos[rol()][0];
  const vistas={panel:panelPrincipal,productos:gestionProductos,proveedores:gestionProveedores,
    inventario:controlInventario,ventas:registroVentas,comprobantes:listaComprobantes,
    caja:cierreCaja,usuarios:gestionUsuarios,reportes:reportes};
  const nombres={admin:'Administrador',almacen:'Almacenero',cajero:'Cajero'};
  const contenedor=document.createElement('div');
  contenedor.innerHTML=plantilla('personal',{
    ROL:esc(nombres[rol()]||rol()),NOMBRE:esc(sesion.nombre),CONTENIDO:vistas[vistaPersonal]()
  });
  contenedor.querySelectorAll('[data-vista-personal]').forEach(boton=>{
    if(!puede(boton.dataset.vistaPersonal))boton.remove();
    else boton.classList.toggle('activo',boton.dataset.vistaPersonal===vistaPersonal);
  });
  return contenedor.innerHTML;
}
function formularioPersonal() {
  return plantilla('acceso-personal');
}

function ventasDelDashboard() {
  const dias = {hoy:1,semana:7,mes:30};
  if (periodoDashboard === 'todo') return datos.ventas.filter(v=>v.estado==='PAGADA');
  const fechaActual = new Date();
  const inicio = new Date(fechaActual.getFullYear(), fechaActual.getMonth(), fechaActual.getDate());
  inicio.setDate(inicio.getDate() - dias[periodoDashboard] + 1);
  return datos.ventas.filter(v => v.estado==='PAGADA' && v.fechaISO && new Date(v.fechaISO + 'T00:00:00') >= inicio);
}
// [HU-08] Indicadores con datos entregados por Node.js/MySQL; solo ventas PAGADAS.
function panelPrincipal() {
  const ventas=ventasDelDashboard();
  const total=ventas.reduce((s,v)=>s+v.total,0);
  const unidades=ventas.reduce((s,v)=>s+v.items.reduce((a,item)=>a+item.cantidad,0),0);
  const ultimas=ventas.slice(-5).reverse();
  const alertas=stockBajo();
  return plantilla('dashboard', {
    ENCABEZADO:encabezado('Dashboard de la Bodega Armando',
      'Indicadores y gráficos actualizados con las operaciones del sistema.',
      '<button class="btn btn-outline-primary boton" data-accion="actualizar-dashboard">↻ Actualizar datos</button>'),
    SEL_TODO:periodoDashboard==='todo'?'selected':'',
    SEL_HOY:periodoDashboard==='hoy'?'selected':'',
    SEL_SEMANA:periodoDashboard==='semana'?'selected':'',
    SEL_MES:periodoDashboard==='mes'?'selected':'',
    TOTAL:moneda(total),N_VENTAS:ventas.length,UNIDADES:unidades,
    PRODUCTOS:activos().length,N_CATEGORIAS:categorias().length,BAJO:alertas.length,
    NUM_CAJA:datos.caja.numero,ESTADO_CAJA:datos.caja.abierta?'abierta':'cerrada',
    ALERTAS:alertas.length?alertas.slice(0,6).map(p=>`<div class="fila-dato"><span>${esc(p.nombre)}</span>${etiqueta(`${p.stock} un. / mín. ${p.minimo}`,'alerta')}</div>`).join('')
      :'<p>Todos los productos activos están por encima del stock mínimo.</p>',
    ULTIMAS:ultimas.map(v=>`<tr><td>${esc(v.numero)}</td><td>${esc(v.fecha)}</td><td>${esc(v.responsable)}</td><td>${esc(v.pago)}</td><td class="monto">${moneda(v.total)}</td></tr>`).join('')
      ||tablaVacia(5,'No existen ventas en el período seleccionado.')
  });
}

// Se dibujan las barras con elementos HTML, como en los ejercicios de la Semana 12.
function pintarBarrasDashboard(contenedor, valores, tipo) {
  const elemento = document.getElementById(contenedor);
  if (!elemento) return;
  elemento.replaceChildren();
  if (!valores.length || valores.every(([,valor]) => valor === 0)) {
    const mensaje = document.createElement('p');
    mensaje.className = 'sin-datos-grafico';
    mensaje.textContent = 'No hay información para graficar en este período.';
    elemento.appendChild(mensaje);
    return;
  }
  const maximo = Math.max(...valores.map(([,valor]) => valor), 1);
  valores.forEach(([nombre,valor]) => {
    const columna = document.createElement('div');columna.className = 'columna-dashboard';
    const monto = document.createElement('span');monto.className = 'monto-barra';
    monto.textContent = tipo==='moneda' ? moneda(valor) : String(valor);
    const contorno = document.createElement('div');contorno.className = 'contorno-barra';
    const barra = document.createElement('div');barra.className = 'barra-dashboard';
    barra.style.height = Math.max(5, valor / maximo * 100) + '%';
    barra.title = `${nombre}: ${monto.textContent}`;
    contorno.appendChild(barra);
    const titulo = document.createElement('span');titulo.className = 'nombre-barra';titulo.textContent = nombre;
    columna.append(monto,contorno,titulo);elemento.appendChild(columna);
  });
}
// El gráfico circular usa SVG y funciones de JavaScript, igual que el ejercicio de clase.
function pintarCircularDashboard(valores) {
  const svg = document.getElementById('grafico-pagos');
  const leyenda = document.getElementById('leyenda-pagos');
  if (!svg || !leyenda) return;
  svg.replaceChildren();leyenda.replaceChildren();
  const colores = ['#2864cd','#32a891','#f4b544'];
  const total = valores.reduce((s,[,valor]) => s+valor,0);
  const crearSvg = (etiqueta) => document.createElementNS('http://www.w3.org/2000/svg',etiqueta);
  let angulo = -Math.PI / 2;
  if (total <= 0) {
    const circulo = crearSvg('circle');
    circulo.setAttribute('cx','110');circulo.setAttribute('cy','110');circulo.setAttribute('r','85');
    circulo.setAttribute('fill','#dfe8f4');svg.appendChild(circulo);
  } else {
    valores.forEach(([nombre,valor],i) => {
      if(valor <= 0)return;
      const sector = valor / total;
      let forma;
      if(sector >= 0.999999){
        forma=crearSvg('circle');forma.setAttribute('cx','110');forma.setAttribute('cy','110');forma.setAttribute('r','85');
      } else {
        const final = angulo + sector * 2 * Math.PI;
        const x1 = 110 + 85*Math.cos(angulo), y1 = 110 + 85*Math.sin(angulo);
        const x2 = 110 + 85*Math.cos(final), y2 = 110 + 85*Math.sin(final);
        forma=crearSvg('path');
        forma.setAttribute('d',`M110 110 L${x1} ${y1} A85 85 0 ${sector>0.5?1:0} 1 ${x2} ${y2} Z`);
        angulo=final;
      }
      forma.setAttribute('fill',colores[i]);
      const titulo=crearSvg('title');titulo.textContent=`${nombre}: ${moneda(valor)} (${Math.round(sector*100)}%)`;
      forma.appendChild(titulo);svg.appendChild(forma);
    });
  }
  const centro=crearSvg('circle');centro.setAttribute('cx','110');centro.setAttribute('cy','110');centro.setAttribute('r','47');centro.setAttribute('fill','var(--superficie)');svg.appendChild(centro);
  const texto=crearSvg('text');texto.setAttribute('x','110');texto.setAttribute('y','112');texto.setAttribute('text-anchor','middle');texto.setAttribute('class','texto-centro-grafico');texto.textContent=total>0?`${Math.round(total)} S/`:'Sin ventas';svg.appendChild(texto);
  valores.forEach(([nombre,valor],i) => {
    const fila = document.createElement('div');fila.className='elemento-leyenda';
    const punto=document.createElement('span');punto.className='punto-leyenda';punto.style.backgroundColor=colores[i];
    const etiqueta=document.createElement('span');etiqueta.textContent=nombre;
    const cantidad=document.createElement('strong');cantidad.textContent=moneda(valor);
    fila.append(punto,etiqueta,cantidad);leyenda.appendChild(fila);
  });
}
function dibujarDashboard() {
  const ventas = ventasDelDashboard();
  const dias = new Map();
  ventas.forEach(v => dias.set(v.fechaISO, (dias.get(v.fechaISO)||0)+v.total));
  const porDia = [...dias.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([fecha,total]) => [fecha.slice(8,10)+'/'+fecha.slice(5,7),total]);
  pintarBarrasDashboard('grafico-ventas-dias',porDia,'moneda');
  const stock = new Map();
  activos().forEach(p => stock.set(p.categoria, (stock.get(p.categoria)||0)+p.stock));
  pintarBarrasDashboard('grafico-stock',[...stock.entries()].sort(([a],[b])=>a.localeCompare(b,'es')),'unidades');
  const pagos = ['Efectivo','Yape','Tarjeta'].map(nombre => [nombre, ventas.filter(v=>v.pago===nombre).reduce((s,v)=>s+v.total,0)]);
  pintarCircularDashboard(pagos);
}

// 3. PRODUCTOS, PROVEEDORES E INVENTARIO: las tablas están en index.html.
function gestionProductos() {
  const q=filtros.adminTexto.toLowerCase();
  const productos=datos.productos.filter(p=>
    `${p.nombre} ${p.codigo}`.toLowerCase().includes(q) &&
    (filtros.adminCategoria==='Todas'||p.categoria===filtros.adminCategoria) &&
    (filtros.adminEstado==='Todos'||(filtros.adminEstado==='Activos'?p.activo:!p.activo)));
  const filas=productos.map(p=>`<tr>
    <td>${esc(p.codigo)}</td><td><strong>${esc(p.nombre)}</strong></td><td>${esc(p.categoria)}</td>
    <td>${moneda(p.precio)}</td><td class="${p.stock<=p.minimo?'stock-low':'stock-ok'}">${p.stock}</td>
    <td>${etiqueta(p.activo?'Activo':'Inactivo',p.activo?'':'error')}</td>
    <td>${puedeEditar('productos')?`<div class="acciones"><button class="enlace" data-accion="editar-producto" data-id="${p.id}">Editar</button><button class="enlace" data-accion="activar-producto" data-id="${p.id}">${p.activo?'Desactivar':'Activar'}</button></div>`:'Solo lectura'}</td>
  </tr>`).join('');
  return plantilla('productos', {
    ENCABEZADO:encabezado('Gestión de productos','Administra el catálogo, sus precios y disponibilidad.',
      puedeEditar('productos')?'<button class="btn btn-primary boton primario" data-accion="nuevo-producto">+ Nuevo producto</button>':''),
    BUSQUEDA:esc(filtros.adminTexto),
    CATEGORIAS:categoriaSelect(filtros.adminCategoria),
    ESTADOS:['Todos','Activos','Inactivos'].map(v=>`<option ${v===filtros.adminEstado?'selected':''}>${v}</option>`).join(''),
    FILAS:filas||tablaVacia(7,'No hay productos para los filtros indicados.')
  });
}
function gestionProveedores() {
  const filas=datos.proveedores.map(p=>`<tr>
    <td>${esc(p.empresa)}</td><td>${esc(p.ruc)}</td><td>${esc(p.contacto)}</td><td>${esc(p.telefono)}</td>
    <td><button class="enlace" data-accion="editar-proveedor" data-id="${p.id}">Editar</button>
      <button class="enlace" data-accion="quitar-proveedor" data-id="${p.id}">Eliminar</button></td></tr>`).join('');
  return plantilla('proveedores', {
    ENCABEZADO:encabezado('Proveedores','Registra y consulta los proveedores de mercadería.',
      '<button class="btn btn-primary boton primario" data-accion="nuevo-proveedor">+ Nuevo proveedor</button>'),
    FILAS:filas||tablaVacia(5,'No hay proveedores registrados.')
  });
}
function controlInventario() {
  const alertas=stockBajo();
  const existencias=activos().map(p=>`<tr><td>${esc(p.nombre)}</td><td>${p.stock}</td><td>${p.minimo}</td>
    <td>${etiqueta(p.stock<=p.minimo?'Stock bajo':'Disponible',p.stock<=p.minimo?'alerta':'')}</td></tr>`).join('');
  const movimientos=datos.movimientos.slice().reverse().slice(0,18).map(m=>`<tr>
    <td>${esc(m.fecha)}</td><td>${esc(m.producto)}</td><td>${etiqueta(m.tipo,m.cantidad<0?'alerta':'azul')}</td>
    <td>${m.cantidad>0?'+':''}${m.cantidad}</td></tr>`).join('');
  return plantilla('inventario',{
    ENCABEZADO:encabezado('Control de inventario','Consulta existencias y registra entradas o salidas de mercadería.',
      puedeEditar('inventario')?'<div class="grupo-botones"><button class="btn btn-outline-primary boton" data-accion="movimiento-salida">− Registrar salida</button><button class="btn btn-primary boton primario" data-accion="movimiento-entrada">+ Registrar entrada</button></div>':''),
    ALERTA:alertas.length?`<div class="alerta-stock">⚠ ${alertas.length} producto(s) necesitan reposición: ${alertas.slice(0,3).map(p=>esc(p.nombre)).join(', ')}.</div>`:'',
    FILAS_STOCK:existencias||tablaVacia(4,'No hay productos activos.'),
    FILAS_MOVIMIENTOS:movimientos||tablaVacia(4,'No hay movimientos registrados todavía.')
  });
}

// 4. VENTAS Y COMPROBANTES: los botones y formularios están en index.html.
function registroVentas() {
  const items=resumenItems(carritoPos);
  const opciones=activos().filter(p=>p.stock>0).map(p=>
    `<option value="${p.id}">${esc(p.nombre)} · ${moneda(p.precio)} (${p.stock} un.)</option>`).join('');
  const filas=items.map(p=>`<div class="item-carrito">${fotoProducto(p,'foto-carrito')}
    <div class="datos-item"><strong>${esc(p.nombre)}</strong><small>${moneda(p.precio)} · Stock: ${p.stock}</small></div>
    <div class="cantidad"><button data-accion="menos" data-origen="pos" data-id="${p.id}" aria-label="Restar">−</button>
      <span>${p.cantidad}</span><button data-accion="mas" data-origen="pos" data-id="${p.id}" aria-label="Sumar">+</button></div>
    <strong>${moneda(p.precio*p.cantidad)}</strong>
    <button class="enlace" data-accion="quitar" data-origen="pos" data-id="${p.id}">Quitar</button></div>`).join('');
  return plantilla('ventas',{
    ENCABEZADO:encabezado('Registro de ventas','Punto de venta del Cajero. Registro de ventas y atención en caja.',
      datos.caja.abierta?etiqueta('Caja abierta'):etiqueta('Caja cerrada','error')),
    OPCIONES:opciones,ITEMS:filas||'<p class="vacio">Selecciona productos para comenzar una venta.</p>',
    RESUMEN:resumenCarrito(items,'pos'),
    AVISO_CAJA:datos.caja.abierta?'':'<div class="alerta-stock">La caja está cerrada. Abre una nueva caja para registrar ventas POS.</div>'
  });
}
// [HU-16] El cajero verifica pagos externos y registra el recojo contra la constancia.
function listaComprobantes() {
  const filas=datos.ventas.slice().reverse().map(v=>`<tr>
    <td>${esc(v.numero)}</td><td>${esc(v.fecha)}</td><td>${esc(v.origen)}</td>
    <td>${esc(v.responsable)}</td><td>${esc(v.pago)} · ${esc(v.estado)} · Recojo: ${esc(v.entrega||'PENDIENTE')}</td><td>${moneda(v.total)}</td>
    <td><button class="enlace" data-accion="ver-comprobante" data-id="${v.id}">Ver</button>
    ${v.origen==='Cliente'&&v.estado==='PENDIENTE'?`<button class="btn btn-success boton pequeno" data-accion="cobrar-pedido" data-id="${v.id}" ${!datos.caja.abierta?'disabled title="Abre caja"':''}>Verificar pago</button> <button class="btn btn-outline-danger boton pequeno" data-accion="anular-pedido" data-id="${v.id}">Anular</button>`:''}
    ${v.origen==='Cliente'&&v.estado==='PAGADA'&&v.entrega!=='ENTREGADA'?`<button class="btn btn-primary boton pequeno" data-accion="entregar-pedido" data-id="${v.id}">Marcar entregado</button>`:''}</td></tr>`).join('');
  return plantilla('comprobantes',{
    ENCABEZADO:encabezado('Comprobantes de venta','Historial de ventas y pedidos registrados.'),
    FILAS:filas||tablaVacia(7,'No hay ventas registradas.')
  });
}

// 5. CAJA: los importes provienen de las ventas que entregó MySQL.
function ventasCaja() { return datos.ventas.filter(v=>v.estado==='PAGADA'&&v.caja===datos.caja.id); }
function cierreCaja() {
  const ventas=ventasCaja();
  const total=ventas.reduce((s,v)=>s+v.total,0);
  const efectivo=ventas.filter(v=>v.pago==='Efectivo').reduce((s,v)=>s+v.total,0);
  const esperado=Number(datos.caja.inicio)+efectivo;
  const pagos=['Efectivo','Yape','Tarjeta'].map(nombre=>`<div class="fila-dato"><span>${nombre}</span><strong>${moneda(ventas.filter(v=>v.pago===nombre).reduce((s,v)=>s+v.total,0))}</strong></div>`).join('');
  const cierres=datos.cierres.slice().reverse().map(c=>`<tr><td>${c.numero}</td><td>${esc(c.fecha)}</td>
    <td>${moneda(c.esperado)}</td><td>${moneda(c.contado)}</td><td>${moneda(c.diferencia)}</td></tr>`).join('');
  return plantilla('caja',{
    ENCABEZADO:encabezado('Cierre de caja',`Caja ${datos.caja.numero} · Arqueo y conciliación de caja.`,
      etiqueta(datos.caja.abierta?'Caja abierta':'Caja cerrada',datos.caja.abierta?'':'error')),
    SALDO:moneda(datos.caja.inicio),VENTAS:moneda(total),ESPERADO:moneda(esperado),
    PAGOS:pagos,N_VENTAS:ventas.length,
    FORMULARIO_CIERRE:datos.caja.abierta?plantilla('form-cerrar-caja',{ESPERADO:esperado.toFixed(2)}):plantilla('caja-cerrada'),
    HISTORIAL:datos.cierres.length?plantilla('historial-cierres',{FILAS:cierres}):''
  });
}
function gestionUsuarios() {
  const filas=datos.usuarios.map(u=>`<tr>
    <td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td><td>${etiqueta(u.rol,'azul')}</td>
    <td>${etiqueta(u.activo?'Activo':'Inactivo',u.activo?'':'error')}</td>
    <td><button class="enlace" data-accion="editar-usuario" data-id="${u.id}">Editar</button>
      <button class="enlace" data-accion="activar-usuario" data-id="${u.id}">${u.activo?'Desactivar':'Activar'}</button></td></tr>`).join('');
  return plantilla('usuarios',{
    ENCABEZADO:encabezado('Gestión de usuarios','Perfiles y permisos del personal.',
      '<button class="btn btn-primary boton primario" data-accion="nuevo-usuario">+ Nuevo usuario</button>'),
    FILAS:filas||tablaVacia(5,'No hay usuarios registrados.')
  });
}

// 6. REPORTES: JavaScript calcula los resultados y HTML organiza la vista.
function ventasFiltradas() {
  return datos.ventas.filter(v=>v.estado==='PAGADA'&&
    (!filtros.reporteDesde||v.fechaISO>=filtros.reporteDesde)&&
    (!filtros.reporteHasta||v.fechaISO<=filtros.reporteHasta));
}
function reportes() {
  const ventas=ventasFiltradas();
  const total=ventas.reduce((s,v)=>s+v.total,0);
  const unidades=ventas.reduce((s,v)=>s+v.items.reduce((a,b)=>a+b.cantidad,0),0);
  const mapa=new Map();
  ventas.forEach(v=>v.items.forEach(i=>mapa.set(i.nombre,(mapa.get(i.nombre)||0)+i.cantidad)));
  const ranking=[...mapa.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  const filasRanking=ranking.map(([nombre,cantidad])=>
    `<div class="fila-dato"><span>${esc(nombre)}</span><strong>${cantidad} un.</strong></div>`).join('');
  const pagos=['Efectivo','Yape','Tarjeta'].map(nombre=>`<div class="fila-dato"><span>${nombre}</span>
    <strong>${moneda(ventas.filter(v=>v.pago===nombre).reduce((s,v)=>s+v.total,0))}</strong></div>`).join('');
  return plantilla('reportes',{
    ENCABEZADO:encabezado('Reportes de ventas','Consulta y exporta resultados a CSV.',
      '<button class="btn btn-primary boton primario" data-accion="exportar-csv">Exportar CSV</button>'),
    DESDE:esc(filtros.reporteDesde),HASTA:esc(filtros.reporteHasta),
    TOTAL:moneda(total),N_VENTAS:ventas.length,UNIDADES:unidades,
    RANKING:filasRanking||'<p class="vacio">No hay ventas en el período indicado.</p>',
    PAGOS:pagos
  });
}


function dibujarReporte() {
  const ranking = new Map();
  ventasFiltradas().forEach(v => v.items.forEach(item => ranking.set(item.nombre,(ranking.get(item.nombre)||0)+item.cantidad)));
  const valores = [...ranking.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  pintarBarrasDashboard('grafico-ranking',valores,'unidades');
}
function modificarCantidad(origen,id,accion) {
  const p=producto(id),destino=origen==='pos'?carritoPos:carrito;
  if(!p || !p.activo)return notificar('Este producto no está disponible.','error');
  const actual=Number(destino[id]||0);
  const nueva=accion==='quitar'?0:accion==='mas'?actual+1:Math.max(0,actual-1);
  if(nueva>p.stock)return notificar(`Solo hay ${p.stock} unidades disponibles de ${p.nombre}.`,'error');
  if(nueva===0)delete destino[id];else destino[id]=nueva;
  render();
}

// [VENTAS] Comparte el formulario de carrito cliente y caja POS: operaciones distintas.
async function registrarVenta(origen,pago,recibido,referencia='') {
  const destino=origen==='POS'?carritoPos:carrito;
  const items=resumenItems(destino).map(p=>({id:p.id,cantidad:p.cantidad}));
  if(!items.length)throw Error('Agrega al menos un producto.');
  const v=await api('POST','/api/ventas',{origen,pago,recibido:recibido===''?null:recibido,referencia,items});
  if(origen==='POS')carritoPos={};else carrito={};
  await sincronizar();
  reciboActivo=v.id;
  return v;
}
// [HU-15] Constancia interna numerada, NO boleta tributaria electrónica SUNAT.
function verComprobante(id) {
  const v=datos.ventas.find(x=>x.id===Number(id));
  if(!v) return notificar('No se encontró el comprobante.','error');
  if(area==='cliente' && (!esCliente()||v.cliente!==sesion.usuario))return notificar('No tienes acceso a esa compra.','error');
  if(area==='personal' && !puede('comprobantes'))return notificar('No tienes permiso para consultar comprobantes.','error');
  abrirDialogo('Comprobante de venta',`<div class="comprobante"><div class="titulo"><strong>Bodega Armando Tornero</strong><p>COMPROBANTE DE OPERACIÓN</p><h2>${esc(v.numero)}</h2></div><div class="fila-dato"><span>Fecha</span><span>${esc(v.fecha)}</span></div><div class="fila-dato"><span>Atendido por</span><span>${esc(v.responsable)}</span></div><table><thead><tr><th>Producto</th><th>Cant.</th><th>Importe</th></tr></thead><tbody>${v.items.map(i=>`<tr><td>${esc(i.nombre)}</td><td>${i.cantidad}</td><td>${moneda(i.precio*i.cantidad)}</td></tr>`).join('')}</tbody></table><div class="fila-dato"><strong>Total del pedido</strong><strong>${moneda(v.total)}</strong></div><div class="fila-dato"><span>Forma de pago</span><span>${esc(v.pago)}</span></div>${v.pago==='Efectivo'&&v.origen==='POS'?`<div class="fila-dato"><span>Vuelto</span><span>${moneda(v.vuelto)}</span></div>`:''}<p class="datos-muestra">Pago: ${esc(v.estado||'PENDIENTE')}. Recojo: ${esc(v.entrega||'PENDIENTE')}. Referencia: ${esc(v.referencia||'—')}.</p><p class="datos-muestra">CONSTANCIA INTERNA DE PEDIDO Y RECOJO. No es una boleta electrónica SUNAT. No se procesan tarjetas ni transferencias dentro de este sitio.</p><button type="button" class="btn btn-outline-primary" onclick="window.print()">Imprimir constancia</button></div>`,null,'Cerrar');
}
function abrirDialogo(titulo,contenido,contexto,textoBoton='Guardar') {
  contextoDialogo=contexto;
  $('#titulo-dialogo').textContent=titulo;
  $('#contenido-dialogo').innerHTML=contenido;
  $('#confirmar-dialogo').textContent=textoBoton;
  $('#confirmar-dialogo').classList.toggle('oculto',!contexto);
  $('#dialogo').showModal();
}
function cerrarDialogo() { $('#dialogo').close();contextoDialogo=null; }
function campoTexto(etiqueta,nombre,valor='',extra='') {
  return `<label class="campo"><span>${etiqueta}</span><input name="${nombre}" value="${esc(valor)}" ${extra} required></label>`;
}
function formProducto(id) {
  const p=id?producto(id):null;
  if(id&&!p)return;
  abrirDialogo(p?'Editar producto':'Nuevo producto',`
    <div class="cuadricula-mini">${campoTexto('Código','codigo',p?.codigo||'','maxlength="20"')}${campoTexto('Categoría','categoria',p?.categoria||'','maxlength="35"')}</div>
    ${campoTexto('Nombre','nombre',p?.nombre||'','maxlength="80"')}
    <div class="cuadricula-mini">${campoTexto('Precio (S/)','precio',p?.precio||'','type="number" min="0.01" step="0.01"')}${campoTexto('Stock mínimo','minimo',p?.minimo??6,'type="number" min="0" step="1"')}</div>
    ${p?'':campoTexto('Stock inicial','stock',0,'type="number" min="0" step="1"')}
    <label class="campo"><span>URL de foto del producto (opcional)</span><input type="url" name="imagen" placeholder="https://sitio.com/foto.jpg" value="${esc(p?.imagen || '')}"></label>`,{tipo:'producto',id});
}
function formProveedor(id) {
  const p=datos.proveedores.find(x=>x.id===Number(id));
  abrirDialogo(p?'Editar proveedor':'Nuevo proveedor',`${campoTexto('Empresa','empresa',p?.empresa||'','maxlength="90"')}${campoTexto('RUC (11 dígitos)','ruc',p?.ruc||'','pattern="[0-9]{11}" inputmode="numeric"')}${campoTexto('Contacto','contacto',p?.contacto||'','maxlength="60"')}${campoTexto('Teléfono','telefono',p?.telefono||'','maxlength="20"')}`,{tipo:'proveedor',id});
}
function formUsuario(id) {
  const u=datos.usuarios.find(x=>x.id===Number(id));
  abrirDialogo(u?'Editar usuario':'Nuevo usuario',`${campoTexto('Nombre completo','nombre',u?.nombre||'','maxlength="80"')}${campoTexto('Usuario','usuario',u?.usuario||'','minlength="4" maxlength="30" pattern="[a-zA-Z0-9._-]+"')}<label class="campo"><span>Rol</span><select name="rol" required>${[['admin','Administrador'],['almacen','Almacenero'],['cajero','Cajero']].map(([v,t])=>`<option value="${v}" ${u?.rol===v?'selected':''}>${t}</option>`).join('')}</select></label><label class="campo"><span>Contraseña ${u?'(opcional al editar)':'(mínimo 8 caracteres)'}</span><input type="password" name="clave" minlength="8" ${u?'':'required'} autocomplete="new-password"></label>`,{tipo:'usuario',id});
}
function formMovimiento(tipo) {
  abrirDialogo(`Registrar ${tipo.toLowerCase()} de inventario`,`<label class="campo"><span>Producto</span><select name="producto" required>${activos().map(p=>`<option value="${p.id}">${esc(p.nombre)} (stock: ${p.stock})</option>`).join('')}</select></label>${campoTexto('Cantidad','cantidad',1,'type="number" min="1" step="1"')}${tipo==='Entrada'?`<label class="campo"><span>Proveedor</span><select name="proveedor" required>${datos.proveedores.map(p=>`<option value="${p.id}">${esc(p.empresa)}</option>`).join('')}</select></label>`:''}${campoTexto('Referencia','referencia',tipo==='Entrada'?'Ingreso de mercadería':'Ajuste de salida','maxlength="70"')}`,{tipo:'movimiento',movimiento:tipo});
}
async function procesarDialogo(form) {
  const fd=new FormData(form),c=contextoDialogo;
  if(!c)return;
  let ruta,metodo=c.id?'PUT':'POST',cuerpo={};
  if(c.tipo==='producto'){
    ruta='/api/productos'+(c.id?'/'+c.id:'');
    cuerpo={codigo:fd.get('codigo'),nombre:fd.get('nombre'),categoria:fd.get('categoria'),precio:fd.get('precio'),minimo:fd.get('minimo'),imagen:fd.get('imagen')||'',stock:fd.get('stock')||0};
  }else if(c.tipo==='proveedor'){
    ruta='/api/proveedores'+(c.id?'/'+c.id:'');
    cuerpo={ruc:fd.get('ruc'),empresa:fd.get('empresa'),contacto:fd.get('contacto'),telefono:fd.get('telefono')};
  }else if(c.tipo==='usuario'){
    ruta='/api/usuarios'+(c.id?'/'+c.id:'');
    cuerpo={usuario:fd.get('usuario'),nombre:fd.get('nombre'),rol:fd.get('rol'),clave:fd.get('clave')};
  }else if(c.tipo==='movimiento'){
    ruta='/api/movimientos';metodo='POST';
    cuerpo={producto:fd.get('producto'),cantidad:fd.get('cantidad'),tipo:c.movimiento,proveedor:fd.get('proveedor'),referencia:fd.get('referencia')};
  }else throw Error('Acción no reconocida.');
  await api(metodo,ruta,cuerpo);
  cerrarDialogo();await sincronizar();notificar('Cambios guardados.');
}
function archivoCsv() {
  if(!puede('reportes'))return notificar('No autorizado.','error');
  const filas=[['Comprobante','Fecha','Origen','Responsable','Pago','Total (S/)'],...ventasFiltradas().map(v=>[v.numero,v.fechaISO,v.origen,v.responsable,v.pago,v.total.toFixed(2)])];
  const contenido='\uFEFF'+filas.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([contenido],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='reporte_ventas_bodega_armando.csv';a.click();URL.revokeObjectURL(url);
  notificar('Reporte CSV descargado.');
}

$('#contenido').addEventListener('click',async (e)=>{
  const boton=e.target.closest('button[data-vista-cliente],button[data-vista-personal],button[data-accion]');
  if(!boton)return;
  if(boton.dataset.vistaCliente){vistaCliente=boton.dataset.vistaCliente;render();return;}
  if(boton.dataset.vistaPersonal){seccion(boton.dataset.vistaPersonal);return;}
  const a=boton.dataset.accion,id=Number(boton.dataset.id),origen=boton.dataset.origen;
  try{
    if(a==='actualizar-dashboard' && puede('panel')){await sincronizar();notificar('Indicadores actualizados.');return;}
    if(a==='salir'){
      await api('DELETE','/api/sesion');sesion=null;carrito={};carritoPos={};
      vistaPersonal='panel';await sincronizar();return;
    }
    if(a==='vaciar-carrito'){carrito={};render();notificar('Carrito vaciado.');return;}
    if(a==='cobrar-pedido'&&puede('comprobantes')){
      const pedido=datos.ventas.find(v=>v.id===id&&v.origen==='Cliente'&&v.estado==='PENDIENTE');
      if(!pedido)throw Error('El pedido ya no está pendiente.');
      if(!confirm(`¿Verificaste en Yape / operador externo la referencia ${pedido.referencia||'sin referencia'} del pedido ${pedido.numero}? La reserva de stock ya fue registrada.`))return;
      await api('POST',`/api/pedidos/${id}/confirmar`,{});
      await sincronizar();notificar('Pago verificado; compra disponible para recojo.');return;
    }
    if(a==='entregar-pedido'&&puede('comprobantes')){
      const pedido=datos.ventas.find(v=>v.id===id);if(!pedido)throw Error('Pedido no encontrado.');
      if(!confirm(`¿Verificaste el comprobante ${pedido.numero} y entregaste sus productos al cliente?`))return;
      await api('POST',`/api/pedidos/${id}/entregar`,{});await sincronizar();notificar('Pedido marcado como ENTREGADA.');return;
    }
    if(a==='anular-pedido'&&puede('comprobantes')){
      if(!confirm('¿Anular el pedido sin pago y devolver sus unidades reservadas al stock?'))return;
      await api('POST',`/api/pedidos/${id}/cancelar`,{});await sincronizar();notificar('Pedido anulado; stock devuelto.');return;
    }
    if(a==='agregar-carrito'){modificarCantidad('cliente',id,'mas');notificar('Producto agregado al carrito.');return;}
    if(['mas','menos','quitar'].includes(a)){modificarCantidad(origen,id,a);return;}
    if(a==='agregar-pos'){
      const select=$('#seleccionar-pos');if(!select?.value)throw Error('Selecciona un producto.');
      modificarCantidad('pos',Number(select.value),'mas');return;
    }
    if(a==='nuevo-producto'&&puedeEditar('productos'))return formProducto();
    if(a==='editar-producto'&&puedeEditar('productos'))return formProducto(id);
    if(a==='activar-producto'&&puedeEditar('productos')){
      await api('PATCH',`/api/productos/${id}/estado`);await sincronizar();notificar('Estado actualizado.');return;
    }
    if(a==='nuevo-proveedor'&&puedeEditar('proveedores'))return formProveedor();
    if(a==='editar-proveedor'&&puedeEditar('proveedores'))return formProveedor(id);
    if(a==='quitar-proveedor'&&puedeEditar('proveedores')){
      if(!confirm('¿Desactivar este proveedor?'))return;
      await api('PATCH',`/api/proveedores/${id}/estado`);await sincronizar();notificar('Proveedor desactivado.');return;
    }
    if(a==='movimiento-entrada'&&puedeEditar('inventario'))return formMovimiento('Entrada');
    if(a==='movimiento-salida'&&puedeEditar('inventario'))return formMovimiento('Salida');
    if(a==='ver-comprobante')return verComprobante(id);
    if(a==='nuevo-usuario'&&puede('usuarios'))return formUsuario();
    if(a==='editar-usuario'&&puede('usuarios'))return formUsuario(id);
    if(a==='activar-usuario'&&puede('usuarios')){
      await api('PATCH',`/api/usuarios/${id}/estado`);await sincronizar();notificar('Acceso actualizado.');return;
    }
    if(a==='abrir-caja'&&puede('caja')&&!datos.caja.abierta){
      const inicio=prompt('Saldo inicial de caja (S/):','0.00');if(inicio===null)return;
      await api('POST','/api/caja/abrir',{inicio});await sincronizar();notificar('Caja abierta.');return;
    }
    if(a==='exportar-csv')return archivoCsv();
  }catch(err){notificar(err.message,'error');}
});

$('#contenido').addEventListener('submit',async (e)=>{
  const form=e.target.closest('form[data-form]');if(!form)return;
  e.preventDefault();const f=new FormData(form),tipo=form.dataset.form;
  try{
    if(tipo==='buscar-cliente'){filtros.clienteTexto=String(f.get('q')).trim();filtros.clienteCategoria=String(f.get('categoria'));render();}
    if(tipo==='buscar-admin'){filtros.adminTexto=String(f.get('q')).trim();filtros.adminCategoria=String(f.get('categoria'));filtros.adminEstado=String(f.get('estado'));render();}
    if(tipo==='filtrar-reporte'){
      const desde=String(f.get('desde')),hasta=String(f.get('hasta'));
      if(desde&&hasta&&desde>hasta)throw Error('La fecha inicial no puede ser posterior a la final.');
      filtros.reporteDesde=desde;filtros.reporteHasta=hasta;render();
    }
    if(tipo==='login-cliente'){
      const r=await api('POST','/api/sesion',{usuario:f.get('usuario'),clave:f.get('clave'),area:'cliente'});
      sesion=r.usuario;vistaCliente='catalogo';await sincronizar();notificar('Bienvenido a la tienda.');
    }
    if(tipo==='registro-cliente'){
      const r=await api('POST','/api/registro',{usuario:f.get('usuario'),nombre:f.get('nombre'),clave:f.get('clave')});
      sesion=r.usuario;vistaCliente='catalogo';await sincronizar();notificar('Cuenta creada.');
    }
    if(tipo==='login-personal'){
      const r=await api('POST','/api/sesion',{usuario:f.get('usuario'),clave:f.get('clave'),area:'personal'});
      sesion=r.usuario;vistaPersonal=permisos[sesion.rol][0];await sincronizar();notificar('Sesión iniciada.');
    }
    if(tipo==='comprar'){
      const v=await registrarVenta('Cliente',String(f.get('pago')),null,String(f.get('referencia')||''));
      vistaCliente='historial';render();notificar(`Pedido ${v.numero} con stock reservado. Pago pendiente de verificación externa.`);verComprobante(v.id);
    }
    if(tipo==='registrar-pos'){
      if(!puede('ventas'))throw Error('No tienes permiso para vender.');
      const v=await registrarVenta('POS',String(f.get('pago')),f.get('recibido'));
      vistaPersonal='comprobantes';render();notificar(`Venta ${v.numero} registrada (${v.estado}).`);verComprobante(v.id);
    }
    if(tipo==='cerrar-caja'){
      await api('POST','/api/caja/cerrar',{contado:f.get('contado'),nota:f.get('nota')});
      await sincronizar();notificar('Caja cerrada y arqueo registrado.');
    }
  }catch(err){notificar(err.message,'error');}
});
$('#contenido').addEventListener('change',e=>{
  if(e.target.id==='dashboard-periodo'){periodoDashboard=e.target.value;render();}
});
$('#formulario-dialogo').addEventListener('submit',async (e)=>{
  e.preventDefault();if(!contextoDialogo){cerrarDialogo();return;}
  try{await procesarDialogo(e.target);}catch(err){notificar(err.message,'error');}
});
$('#dialogo').addEventListener('click',e=>{if(e.target.closest('[data-accion="cerrar-dialogo"]'))cerrarDialogo();});
$('#dialogo').addEventListener('close',()=>{contextoDialogo=null;});
document.querySelectorAll('[data-area]').forEach(b=>b.addEventListener('click',()=>cambiarArea(b.dataset.area)));
$('#boton-tema').addEventListener('click',()=>{
  const oscuro=document.body.classList.toggle('tema-oscuro');
  localStorage.setItem(CLAVE_TEMA,oscuro?'oscuro':'claro');
  document.documentElement.setAttribute('data-bs-theme',oscuro?'dark':'light');render();
});
if(localStorage.getItem(CLAVE_TEMA)==='oscuro')document.body.classList.add('tema-oscuro');
document.documentElement.setAttribute('data-bs-theme',document.body.classList.contains('tema-oscuro')?'dark':'light');
(async ()=>{
  try{
    const r=await api('GET','/api/sesion');sesion=r.usuario;
    if(sesion&&sesion.rol!=='cliente')area='personal';
    await sincronizar();
  }catch(err){
    $('#contenido').innerHTML=`<section class="contenedor tarjeta"><h1>Conexión no disponible</h1><p>${esc(err.message)}</p><p>Comprueba que el servidor y MySQL estén iniciados.</p><button class="boton primario" id="reintentar-conexion">Reintentar</button></section>`;
    $('#reintentar-conexion').addEventListener('click',()=>location.reload());
  }
})();
