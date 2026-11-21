'use strict';

// ========================================================
// SERVIDOR WEB Y API REST - BODEGA ARMANDO
// ========================================================

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Conexión a MySQL y funciones SQL auxiliares
const { pool, uno, todos } = require('./db');
const { hashClave, verificarClave } = require('../utilidades/claves');

// Configuración general
const PORT = Number(process.env.PORT || 3000);
const WEB = __dirname;
const SESIONES = new Map();
const INTENTOS = new Map();

const ROLES = {
  CLIENTE: 'cliente',
  ADMINISTRADOR: 'admin',
  ALMACENERO: 'almacen',
  CAJERO: 'cajero'
};

// --------------------------------------------------------
// 1. FUNCIONES AUXILIARES Y VALIDACIONES
// --------------------------------------------------------

function error(mensaje, estado = 400) {
  const e = new Error(mensaje);
  e.estado = estado;
  throw e;
}

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    error('Número no válido.');
  }
  return n;
}

function entero(v, min = 0, max = 10000000) {
  const n = num(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    error(`Se necesita un entero entre ${min} y ${max}.`);
  }
  return n;
}

function cadena(v, max = 150) {
  const s = String(v ?? '').trim();
  if (s.length > max) {
    error('El texto excede la longitud permitida.');
  }
  return s;
}

function importe(v) {
  const n = num(v);
  if (n < 0 || n > 99999999 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) {
    error('Importe monetario inválido.');
  }
  return Math.round(n * 100);
}

function id(v) {
  return entero(v, 1);
}

function permitido(u, roles) {
  if (!u || !roles.includes(u.rol)) {
    error('No tienes permisos para realizar esta operación.', 403);
  }
}

function opcion(v, opciones) {
  if (!opciones.includes(v)) {
    error('Opción no válida.');
  }
  return v;
}

function precio(n) {
  return Math.round(Number(n) * 100);
}

function sol(cent) {
  return (cent / 100).toFixed(2);
}

function corregirMysql(err) {
  if (err.code === 'ER_DUP_ENTRY') {
    return error('Ya existe un registro con ese código, usuario o identificador.');
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return error('Uno de los registros asociados no existe.');
  }
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    return error('El registro está asociado a operaciones y no puede eliminarse.');
  }
  throw err;
}

// --------------------------------------------------------
// 2. SESIONES Y AUTENTICACIÓN
// --------------------------------------------------------

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map(x => x.trim().split('='))
      .filter(x => x.length === 2)
  );
}

function cookie(req, token, maxAge) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `sesion=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function usuarioActual(req) {
  const token = cookies(req).sesion;
  const data = token ? SESIONES.get(token) : null;
  if (!data || data.vence < Date.now()) {
    if (token) SESIONES.delete(token);
    return null;
  }

  const u = await uno(
    `SELECT u.IdUsuario AS id, u.NombreUsuario AS usuario, u.NombreCompleto AS nombre, r.Nombre AS rol
     FROM Usuario u
     JOIN Rol r ON r.IdRol = u.IdRol
     WHERE u.IdUsuario = ? AND u.Activo = 1`,
    [data.id]
  );

  if (!u) {
    SESIONES.delete(token);
    return null;
  }
  return { ...u, rol: ROLES[u.rol] };
}

function bloquearAutenticacion(req, key) {
  const dato = INTENTOS.get(key) || { cuenta: 0, hasta: 0 };
  if (dato.hasta > Date.now()) {
    error('Demasiados intentos. Intenta nuevamente más tarde.', 429);
  }
  return dato;
}

function falloAutenticacion(key) {
  const a = INTENTOS.get(key) || { cuenta: 0, hasta: 0 };
  a.cuenta++;
  if (a.cuenta >= 6) {
    a.hasta = Date.now() + 10 * 60 * 1000;
    a.cuenta = 0;
  }
  INTENTOS.set(key, a);
}

async function inicioSesion(req, res, data) {
  const usuario = cadena(data.usuario, 50).toLowerCase();
  const clave = String(data.clave || '');
  const key = `${req.socket.remoteAddress}:${usuario}`;

  bloquearAutenticacion(req, key);

  const u = await uno(
    `SELECT u.IdUsuario AS id, u.NombreCompleto AS nombre, u.NombreUsuario AS usuario, 
            u.ClaveHash AS hash, u.Activo AS activo, r.Nombre AS rol
     FROM Usuario u
     JOIN Rol r ON r.IdRol = u.IdRol
     WHERE u.NombreUsuario = ?`,
    [usuario]
  );

  const errorCredenciales = !u || !u.activo || !verificarClave(clave, u.hash) ||
    (data.area === 'cliente' && u.rol !== 'CLIENTE') ||
    (data.area === 'personal' && u.rol === 'CLIENTE');

  if (errorCredenciales) {
    falloAutenticacion(key);
    error('Usuario o contraseña incorrectos.', 401);
  }

  INTENTOS.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  const duracionMs = 8 * 60 * 60 * 1000;
  SESIONES.set(token, { id: u.id, vence: Date.now() + duracionMs });

  json(
    res,
    200,
    { usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: ROLES[u.rol] } },
    { 'set-cookie': cookie(req, token, 8 * 60 * 60) }
  );
}

async function registro(req, res, data) {
  const usuario = cadena(data.usuario, 50).toLowerCase();
  const nombre = cadena(data.nombre, 120);
  const clave = String(data.clave || '');

  if (nombre.length < 3) {
    error('El nombre completo debe tener al menos 3 caracteres.');
  }
  if (!/^[a-z0-9._\-ñáéíóú]{4,30}$/i.test(usuario)) {
    error('El usuario debe tener entre 4 y 30 caracteres (sin espacios ni caracteres especiales raros).');
  }
  if (clave.length < 8) {
    error('La contraseña debe tener al menos 8 caracteres.');
  }

  const r = await uno("SELECT IdRol AS id FROM Rol WHERE Nombre = 'CLIENTE'");
  const [ins] = await pool.execute(
    'INSERT INTO Usuario (IdRol, NombreCompleto, NombreUsuario, ClaveHash) VALUES (?, ?, ?, ?)',
    [r.id, nombre, usuario, hashClave(clave)]
  );

  const token = crypto.randomBytes(32).toString('hex');
  SESIONES.set(token, { id: ins.insertId, vence: Date.now() + 8 * 60 * 60 * 1000 });

  json(
    res,
    201,
    { usuario: { id: ins.insertId, usuario, nombre, rol: 'cliente' } },
    { 'set-cookie': cookie(req, token, 8 * 60 * 60) }
  );
}

// --------------------------------------------------------
// 3. CONSULTA DE ESTADO GENERAL (SINCRONIZACIÓN)
// --------------------------------------------------------

// [EXPOSICIÓN] Consulta MySQL y prepara los datos que el navegador necesita por rol.
async function estado(u) {
  const productos = await todos(
    `SELECT p.IdProducto AS id, p.Codigo AS codigo, p.Nombre AS nombre, c.Nombre AS categoria,
            p.PrecioVenta AS precio, p.StockActual AS stock, p.StockMinimo AS minimo, 
            COALESCE(p.Imagen, '') AS imagen, p.Activo AS activo
     FROM Producto p
     JOIN Categoria c ON c.IdCategoria = p.IdCategoria
     ${!u || u.rol === 'cliente' ? 'WHERE p.Activo = 1' : ''}
     ORDER BY p.IdProducto`
  );

  if (!u) {
    return {
      productos,
      proveedores: [],
      usuarios: [],
      ventas: [],
      movimientos: [],
      cierres: [],
      clientes: [],
      caja: { abierta: false, numero: 0, inicio: 0 }
    };
  }

  const personal = u.rol !== 'cliente';
  const personalVentas = ['admin', 'cajero'].includes(u.rol);

  const proveedores = personal
    ? await todos('SELECT IdProveedor AS id, Nombre AS empresa, RUC AS ruc, Contacto AS contacto, Telefono AS telefono FROM Proveedor WHERE Activo = 1 ORDER BY IdProveedor')
    : [];

  const usuarios = (u.rol === 'admin')
    ? await todos(
        `SELECT u.IdUsuario AS id, u.NombreUsuario AS usuario, u.NombreCompleto AS nombre,
                CASE r.Nombre 
                  WHEN 'ADMINISTRADOR' THEN 'admin' 
                  WHEN 'ALMACENERO' THEN 'almacen' 
                  WHEN 'CAJERO' THEN 'cajero' 
                  ELSE 'cliente' 
                END AS rol,
                u.Activo AS activo
         FROM Usuario u
         JOIN Rol r ON r.IdRol = u.IdRol
         WHERE r.Nombre <> 'CLIENTE'
         ORDER BY u.IdUsuario`
      )
    : [];

  let ventas = [];
  if (personalVentas || u.rol === 'cliente') {
    const filtro = personalVentas ? '' : 'WHERE v.IdCliente = ?';
    const params = personalVentas ? [] : [u.id];

    ventas = await todos(
      `SELECT v.IdVenta AS id, v.Numero AS numero,
              DATE_FORMAT(v.FechaVenta, '%d/%m/%Y, %H:%i') AS fecha,
              DATE_FORMAT(v.FechaVenta, '%Y-%m-%d') AS fechaISO,
              v.Origen AS origen, v.Estado AS estado, v.EstadoEntrega AS entrega,
              DATE_FORMAT(v.FechaEntrega, '%d/%m/%Y, %H:%i') AS fechaEntrega, v.Total AS total, 
              v.Recibido AS recibido, v.Vuelto AS vuelto,
              p.MetodoPago AS pago, p.Referencia AS referencia, COALESCE(v.IdCaja, 0) AS caja,
              COALESCE(c.NombreUsuario, '') AS cliente,
              COALESCE(CASE WHEN v.Origen = 'POS' THEN a.NombreCompleto ELSE c.NombreCompleto END, '') AS responsable
       FROM Venta v
       JOIN Pago p ON p.IdVenta = v.IdVenta
       LEFT JOIN Usuario c ON c.IdUsuario = v.IdCliente
       LEFT JOIN Usuario a ON a.IdUsuario = v.IdVendedor
       ${filtro}
       ORDER BY v.IdVenta`,
      params
    );

    if (ventas.length > 0) {
      const placeholders = ventas.map(() => '?').join(',');
      const detalles = await todos(
        `SELECT d.IdVenta AS idVenta, d.IdProducto AS id, pr.Nombre AS nombre, 
                d.PrecioUnitario AS precio, d.Cantidad AS cantidad
         FROM DetalleVenta d
         JOIN Producto pr ON pr.IdProducto = d.IdProducto
         WHERE d.IdVenta IN (${placeholders})
         ORDER BY d.IdDetalleVenta`,
        ventas.map(v => v.id)
      );

      const mapa = new Map();
      for (const x of detalles) {
        if (!mapa.has(x.idVenta)) mapa.set(x.idVenta, []);
        mapa.get(x.idVenta).push(x);
      }
      ventas = ventas.map(v => ({
        ...v,
        origen: v.origen === 'CLIENTE' ? 'Cliente' : v.origen,
        items: mapa.get(v.id) || []
      }));
    }
  }

  const movimientos = personal
    ? await todos(
        `SELECT m.IdMovimiento AS id, p.Nombre AS producto, m.IdProducto AS productoId,
                CASE m.TipoMovimiento WHEN 'INGRESO' THEN 'Entrada' WHEN 'SALIDA' THEN 'Salida' WHEN 'RESERVA' THEN 'Reserva' WHEN 'ANULACION' THEN 'Anulación' ELSE 'Venta' END AS tipo,
                CASE WHEN m.TipoMovimiento IN ('INGRESO','ANULACION') THEN m.Cantidad ELSE -m.Cantidad END AS cantidad,
                DATE_FORMAT(m.FechaMovimiento, '%d/%m/%Y, %H:%i') AS fecha,
                u.NombreCompleto AS responsable
         FROM MovimientoInventario m
         JOIN Producto p ON p.IdProducto = m.IdProducto
         JOIN Usuario u ON u.IdUsuario = m.IdUsuario
         ORDER BY m.IdMovimiento`
      )
    : [];

  const cierres = personal
    ? await todos(
        `SELECT c.IdCierre AS id, ca.Numero AS numero, c.EfectivoEsperado AS esperado, 
                c.EfectivoContado AS contado, c.Diferencia AS diferencia,
                DATE_FORMAT(c.FechaCierre, '%d/%m/%Y, %H:%i') AS fecha
         FROM CierreCaja c
         JOIN Caja ca ON ca.IdCaja = c.IdCaja
         ORDER BY c.IdCierre`
      )
    : [];

  const caja = personal
    ? await uno(
        `SELECT IdCaja AS id, Numero AS numero, SaldoInicial AS inicio, Abierta AS abierta 
         FROM Caja 
         ORDER BY IdCaja DESC LIMIT 1`
      )
    : null;

  return {
    productos,
    proveedores,
    usuarios,
    ventas,
    movimientos,
    cierres,
    clientes: [],
    caja: caja || { abierta: false, numero: 0, inicio: 0 }
  };
}

// --------------------------------------------------------
// 4. CONTROLADORES DE GESTIÓN (MANTENIMIENTO)
// --------------------------------------------------------

async function guardarProducto(u, data, productId) {
  permitido(u, ['admin', 'almacen']);
  const codigo = cadena(data.codigo, 30);
  const nombre = cadena(data.nombre, 120);
  const categoria = cadena(data.categoria, 80);
  const cents = importe(data.precio);
  const minimo = entero(data.minimo, 0, 10000000);
  const imagen = cadena(data.imagen || '', 800);

  if (!codigo || !nombre || !categoria || cents <= 0) {
    error('Completa los datos del producto.');
  }
  if (imagen && !/^https:\/\/[a-z0-9.-]+\//i.test(imagen)) {
    error('La imagen debe ser una URL HTTPS.');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT IGNORE INTO Categoria (Nombre) VALUES (?)', [categoria]);
    const [[cat]] = await connection.execute('SELECT IdCategoria AS id FROM Categoria WHERE Nombre = ?', [categoria]);

    if (productId) {
      const [r] = await connection.execute(
        `UPDATE Producto 
         SET IdCategoria = ?, Codigo = ?, Nombre = ?, PrecioVenta = ?, StockMinimo = ?, Imagen = ? 
         WHERE IdProducto = ?`,
        [cat.id, codigo, nombre, sol(cents), minimo, imagen, productId]
      );
      if (!r.affectedRows) error('Producto no encontrado.', 404);
    } else {
      const stock = entero(data.stock, 0, 10000000);
      const [ins] = await connection.execute(
        `INSERT INTO Producto (IdCategoria, Codigo, Nombre, PrecioVenta, StockActual, StockMinimo, Imagen) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cat.id, codigo, nombre, sol(cents), stock, minimo, imagen]
      );
      if (stock > 0) {
        await connection.execute(
          `INSERT INTO MovimientoInventario (IdProducto, IdUsuario, TipoMovimiento, Cantidad, StockAnterior, StockNuevo, Observacion) 
           VALUES (?, ?, 'INGRESO', ?, 0, ?, 'Inventario inicial')`,
          [ins.insertId, u.id, stock, stock]
        );
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    corregirMysql(err);
  } finally {
    connection.release();
  }
}

async function guardarProveedor(u, data, providerId) {
  permitido(u, ['admin', 'almacen']);
  const empresa = cadena(data.empresa, 150);
  const ruc = cadena(data.ruc, 11);
  const contacto = cadena(data.contacto, 120);
  const telefono = cadena(data.telefono, 20);

  if (!empresa || (ruc && !/^\d{11}$/.test(ruc))) {
    error('Completa el nombre del proveedor y comprueba el RUC.');
  }

  try {
    if (providerId) {
      const [r] = await pool.execute(
        'UPDATE Proveedor SET Nombre = ?, RUC = ?, Contacto = ?, Telefono = ? WHERE IdProveedor = ?',
        [empresa, ruc || null, contacto, telefono, providerId]
      );
      if (!r.affectedRows) error('Proveedor no encontrado.', 404);
    } else {
      await pool.execute(
        'INSERT INTO Proveedor (Nombre, RUC, Contacto, Telefono) VALUES (?, ?, ?, ?)',
        [empresa, ruc || null, contacto, telefono]
      );
    }
  } catch (err) {
    corregirMysql(err);
  }
}

async function guardarUsuario(u, data, userId) {
  permitido(u, ['admin']);
  const nombre = cadena(data.nombre, 120);
  const usuario = cadena(data.usuario, 50).toLowerCase();
  const rol = opcion(data.rol, ['admin', 'almacen', 'cajero']);
  const rolDB = { admin: 'ADMINISTRADOR', almacen: 'ALMACENERO', cajero: 'CAJERO' }[rol];

  if (nombre.length < 3) {
    error('El nombre debe tener al menos 3 caracteres.');
  }
  if (!/^[a-z0-9._\-ñáéíóú]{4,30}$/i.test(usuario)) {
    error('El usuario debe tener entre 4 y 30 caracteres (sin espacios ni símbolos raros).');
  }

  const r = await uno('SELECT IdRol AS id FROM Rol WHERE Nombre = ?', [rolDB]);

  try {
    if (userId) {
      const ps = String(data.clave || '');
      if (ps && ps.length < 8) error('La contraseña debe tener al menos 8 caracteres.');
      const params = [r.id, nombre, usuario];
      let sql = 'UPDATE Usuario SET IdRol = ?, NombreCompleto = ?, NombreUsuario = ?';
      if (ps) {
        sql += ', ClaveHash = ?';
        params.push(hashClave(ps));
      }
      sql += ' WHERE IdUsuario = ?';
      params.push(userId);

      const [up] = await pool.execute(sql, params);
      if (!up.affectedRows) error('Usuario no encontrado.', 404);
    } else {
      if (String(data.clave || '').length < 8) {
        error('El nuevo usuario requiere contraseña de al menos 8 caracteres.');
      }
      await pool.execute(
        'INSERT INTO Usuario (IdRol, NombreCompleto, NombreUsuario, ClaveHash) VALUES (?, ?, ?, ?)',
        [r.id, nombre, usuario, hashClave(data.clave)]
      );
    }
  } catch (err) {
    corregirMysql(err);
  }
}

// --------------------------------------------------------
// 5. MOVIMIENTOS DE INVENTARIO Y OPERACIONES DE CAJA
// --------------------------------------------------------

async function movimiento(u, data) {
  permitido(u, ['admin', 'almacen']);
  const productId = id(data.producto);
  const cantidad = entero(data.cantidad, 1, 1000000);
  const tipo = opcion(data.tipo, ['Entrada', 'Salida']);
  const obs = cadena(data.referencia, 250);
  const proveedor = (tipo === 'Entrada') ? id(data.proveedor) : null;

  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[p]] = await c.execute(
      'SELECT StockActual AS stock, Activo AS activo FROM Producto WHERE IdProducto = ? FOR UPDATE',
      [productId]
    );

    if (!p || !p.activo) error('Producto no disponible.');
    if (tipo === 'Salida' && p.stock < cantidad) {
      error(`Stock insuficiente. Disponible: ${p.stock}.`);
    }

    if (proveedor) {
      const [[q]] = await c.execute('SELECT IdProveedor FROM Proveedor WHERE IdProveedor = ? AND Activo = 1', [proveedor]);
      if (!q) error('Proveedor no disponible.');
    }

    const nuevo = p.stock + (tipo === 'Entrada' ? cantidad : -cantidad);
    await c.execute('UPDATE Producto SET StockActual = ? WHERE IdProducto = ?', [nuevo, productId]);
    await c.execute(
      `INSERT INTO MovimientoInventario 
       (IdProducto, IdUsuario, IdProveedor, TipoMovimiento, Cantidad, StockAnterior, StockNuevo, Observacion) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [productId, u.id, proveedor, tipo === 'Entrada' ? 'INGRESO' : 'SALIDA', cantidad, p.stock, nuevo, obs]
    );

    await c.commit();
  } catch (err) {
    await c.rollback();
    throw err;
  } finally {
    c.release();
  }
}

// [HU-04/HU-15] Transacción SQL: venta POS pagada o pedido web con reserva y referencia externa.
async function venta(u, data) {
  if (!u) error('Inicia sesión para continuar.', 401);
  const origen = opcion(data.origen, ['Cliente', 'POS']);
  const pago = opcion(data.pago, ['Efectivo', 'Yape', 'Tarjeta']);
  const referencia = cadena(data.referencia, 100);

  if (origen === 'POS') {
    permitido(u, ['admin', 'cajero']);
  } else {
    permitido(u, ['cliente']);
    if (!['Yape','Tarjeta'].includes(pago)) error('Para pedidos web selecciona Yape o Tarjeta.');
    if (referencia.length < 5) error('Registra la referencia de operación para su verificación externa.');
  }

  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 60) {
    error('Selecciona productos para continuar.');
  }

  const unique = new Map();
  for (const x of data.items) {
    const productId = id(x.id);
    const cantidad = entero(x.cantidad, 1, 1000);
    if (unique.has(productId)) error('Un producto se repite en el pedido.');
    unique.set(productId, cantidad);
  }

  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    let caja = null;

    if (origen === 'POS') {
      const [[q]] = await c.execute(
        'SELECT IdCaja AS id, Numero AS numero, Abierta AS abierta FROM Caja ORDER BY IdCaja DESC LIMIT 1 FOR UPDATE'
      );
      if (!q || !q.abierta) error('La caja está cerrada.');
      caja = q;
    }

    const ids = [...unique.keys()].sort((a, b) => a - b);
    const [productos] = await c.query(
      `SELECT IdProducto AS id, Nombre AS nombre, PrecioVenta AS precio, StockActual AS stock, Activo AS activo 
       FROM Producto 
       WHERE IdProducto IN (${ids.map(() => '?').join(',')}) 
       ORDER BY IdProducto FOR UPDATE`,
      ids
    );

    if (productos.length !== ids.length) error('Producto no encontrado.');

    const items = [];
    let totalCents = 0;
    for (const p of productos) {
      const cantidad = unique.get(p.id);
      if (!p.activo || p.stock < cantidad) {
        error(`Stock insuficiente para ${p.nombre}.`);
      }
      const precioCents = precio(p.precio);
      totalCents += cantidad * precioCents;
      items.push({ ...p, cantidad, precioCents });
    }

    if (totalCents <= 0) error('El importe debe ser mayor que cero.');

    const recibidoCents = (origen === 'POS' && pago === 'Efectivo') ? importe(data.recibido) : null;
    if (recibidoCents !== null && recibidoCents < totalCents) {
      error(`Efectivo insuficiente. Total: S/ ${sol(totalCents)}.`);
    }

    const subtotalCents = Math.round(totalCents / 1.18);
    const impuestoCents = totalCents - subtotalCents;
    const pagada = (origen === 'POS');

    const [ins] = await c.execute(
      `INSERT INTO Venta (IdCliente, IdVendedor, IdCaja, Origen, Estado, Subtotal, Impuesto, Total, Recibido, Vuelto) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        origen === 'Cliente' ? u.id : null,
        origen === 'POS' ? u.id : null,
        caja?.id || null,
        origen === 'Cliente' ? 'CLIENTE' : 'POS',
        pagada ? 'PAGADA' : 'PENDIENTE',
        sol(subtotalCents),
        sol(impuestoCents),
        sol(totalCents),
        recibidoCents === null ? null : sol(recibidoCents),
        recibidoCents === null ? null : sol(recibidoCents - totalCents)
      ]
    );

    const numero = `B001-${String(ins.insertId).padStart(6, '0')}`;
    await c.execute('UPDATE Venta SET Numero = ? WHERE IdVenta = ?', [numero, ins.insertId]);

    await c.execute(
      `INSERT INTO Pago (IdVenta, MetodoPago, Estado, Monto, FechaPago, Referencia) 
       VALUES (?, ?, ?, ?, ${pagada ? 'NOW()' : 'NULL'}, ?)`,
      [ins.insertId, pago, pagada ? 'APROBADO' : 'PENDIENTE', sol(totalCents), referencia || null]
    );

    for (const x of items) {
      const lineTotal = x.precioCents * x.cantidad;
      const lineSub = Math.round(lineTotal / 1.18);

      await c.execute(
        `INSERT INTO DetalleVenta (IdVenta, IdProducto, Cantidad, PrecioUnitario, Subtotal, Impuesto, Total) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ins.insertId, x.id, x.cantidad, sol(x.precioCents), sol(lineSub), sol(lineTotal - lineSub), sol(lineTotal)]
      );

      // La venta POS descuenta stock; el pedido web RESERVA stock para evitar sobreventa.
      // Una confirmación posterior NO volverá a descontar estas unidades.
      {
        await c.execute('UPDATE Producto SET StockActual = StockActual - ? WHERE IdProducto = ?', [x.cantidad, x.id]);
        await c.execute(
          `INSERT INTO MovimientoInventario
           (IdProducto, IdUsuario, IdVenta, TipoMovimiento, Cantidad, StockAnterior, StockNuevo, Observacion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [x.id, u.id, ins.insertId, pagada ? 'VENTA' : 'RESERVA', x.cantidad, x.stock, x.stock - x.cantidad, numero]
        );
      }
    }

    await c.commit();
    return { id: ins.insertId, numero, estado: pagada ? 'PAGADA' : 'PENDIENTE' };
  } catch (err) {
    await c.rollback();
    throw err;
  } finally {
    c.release();
  }
}

async function cerrarCaja(u, data) {
  permitido(u, ['admin', 'cajero']);
  const contado = importe(data.contado);
  const nota = cadena(data.nota, 250);

  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[caja]] = await c.execute(
      'SELECT IdCaja AS id, SaldoInicial AS inicio, Abierta AS abierta FROM Caja ORDER BY IdCaja DESC LIMIT 1 FOR UPDATE'
    );
    if (!caja || !caja.abierta) error('La caja ya está cerrada.');

    const [[result]] = await c.execute(
      `SELECT COALESCE(SUM(v.Total), 0) AS efectivo 
       FROM Venta v 
       JOIN Pago p ON p.IdVenta = v.IdVenta 
       WHERE v.IdCaja = ? AND v.Estado = 'PAGADA' AND p.MetodoPago = 'Efectivo' AND p.Estado = 'APROBADO'`,
      [caja.id]
    );

    const esperado = precio(caja.inicio) + precio(result.efectivo);

    await c.execute(
      `INSERT INTO CierreCaja (IdCaja, IdUsuario, EfectivoEsperado, EfectivoContado, Diferencia, Observacion) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [caja.id, u.id, sol(esperado), sol(contado), sol(contado - esperado), nota]
    );

    await c.execute('UPDATE Caja SET Abierta = FALSE WHERE IdCaja = ?', [caja.id]);
    await c.commit();
  } catch (err) {
    await c.rollback();
    throw err;
  } finally {
    c.release();
  }
}

async function abrirCaja(u, data) {
  permitido(u, ['admin', 'cajero']);
  const saldo = importe(data.inicio ?? 0);

  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[ultima]] = await c.execute(
      'SELECT Numero AS numero, Abierta AS abierta FROM Caja ORDER BY IdCaja DESC LIMIT 1 FOR UPDATE'
    );
    if (ultima?.abierta) error('Ya existe una caja abierta.');

    await c.execute(
      'INSERT INTO Caja (Numero, SaldoInicial, Abierta, AbiertaPor) VALUES (?, ?, 1, ?)',
      [(ultima?.numero || 0) + 1, sol(saldo), u.id]
    );
    await c.commit();
  } catch (err) {
    await c.rollback();
    throw err;
  } finally {
    c.release();
  }
}


// [HU-15] El pago se confirma solo tras comprobarlo FUERA del sistema (Yape / operador externo).
// Las existencias ya se reservaron al registrar el pedido; este paso NO las descuenta de nuevo.
// [RF-29] Solo tras verificar el dinero fuera de la web se marca PAGADA; NO doble descuento.
async function confirmarPedido(u, pedidoId) {
  permitido(u, ['admin', 'cajero']);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[p]] = await c.execute(
      `SELECT v.IdVenta AS id, v.Numero AS numero, v.Estado AS estado,
              v.Origen AS origen, pago.Estado AS estadoPago, pago.Referencia AS referencia
       FROM Venta v JOIN Pago pago ON pago.IdVenta = v.IdVenta
       WHERE v.IdVenta = ? FOR UPDATE`, [pedidoId]
    );
    if (!p || p.origen !== 'CLIENTE' || p.estado !== 'PENDIENTE' || p.estadoPago !== 'PENDIENTE') {
      error('El pedido no está pendiente o ya fue procesado.');
    }
    if (!p.referencia) error('El pedido no tiene referencia de pago.');
    const [[caja]] = await c.execute('SELECT IdCaja AS id, Abierta AS abierta FROM Caja ORDER BY IdCaja DESC LIMIT 1 FOR UPDATE');
    if (!caja || !caja.abierta) error('Abre caja para confirmar el pago.');
    await c.execute("UPDATE Venta SET Estado = 'PAGADA', IdVendedor = ?, IdCaja = ? WHERE IdVenta = ?", [u.id, caja.id, pedidoId]);
    await c.execute("UPDATE Pago SET Estado = 'APROBADO', FechaPago = NOW() WHERE IdVenta = ?", [pedidoId]);
    await c.commit();
    return { id: pedidoId, numero: p.numero, estado: 'PAGADA' };
  } catch (err) { await c.rollback(); throw err; }
  finally { c.release(); }
}

// [HU-16 / RF-30] El cajero verifica el número del comprobante y registra la entrega.
// El pedido ya está cobrado y reservado: no crea una venta ni descuenta stock otra vez.
// [RF-30] Control de recojo: entrega con fecha y responsable, sin otra venta ni movimiento.
async function entregarPedido(u, pedidoId) {
  permitido(u, ['admin', 'cajero']);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[p]] = await c.execute('SELECT IdVenta AS id, Numero AS numero, Estado AS estado, EstadoEntrega AS entrega, Origen AS origen FROM Venta WHERE IdVenta = ? FOR UPDATE', [pedidoId]);
    if (!p || p.origen !== 'CLIENTE' || p.estado !== 'PAGADA' || p.entrega !== 'PENDIENTE') error('El pedido debe estar pagado y pendiente de recojo.');
    await c.execute("UPDATE Venta SET EstadoEntrega = 'ENTREGADA', FechaEntrega = NOW(), IdEntregadoPor = ? WHERE IdVenta = ?", [u.id, pedidoId]);
    await c.commit();
    return {id: pedidoId, numero: p.numero, entrega: 'ENTREGADA'};
  } catch(err) { await c.rollback(); throw err; }
  finally { c.release(); }
}

// [INVENTARIO] Si no se recibió el pago, una anulación devuelve el stock reservado.
// [INVENTARIO] Anular pedido pendiente reintegra las unidades reservadas.
async function cancelarPedido(u, pedidoId) {
  permitido(u, ['admin', 'cajero']);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[p]] = await c.execute('SELECT IdVenta AS id, Numero AS numero, Estado AS estado, Origen AS origen FROM Venta WHERE IdVenta = ? FOR UPDATE', [pedidoId]);
    if (!p || p.origen !== 'CLIENTE' || p.estado !== 'PENDIENTE') error('Solo se anulan pedidos web pendientes.');
    const [detalles] = await c.execute('SELECT IdProducto AS producto, Cantidad AS cantidad FROM DetalleVenta WHERE IdVenta = ? ORDER BY IdProducto', [pedidoId]);
    const ids = detalles.map(d => d.producto);
    if (!ids.length) error('El pedido no contiene productos.');
    const [productos] = await c.query(`SELECT IdProducto AS id, StockActual AS stock FROM Producto WHERE IdProducto IN (${ids.map(()=>'?').join(',')}) ORDER BY IdProducto FOR UPDATE`, ids);
    const mapa = new Map(productos.map(p=>[p.id,p]));
    for(const detalle of detalles) {
      const p = mapa.get(detalle.producto);
      if (!p) error('Producto no encontrado.');
      await c.execute('UPDATE Producto SET StockActual = StockActual + ? WHERE IdProducto = ?', [detalle.cantidad, p.id]);
      await c.execute(`INSERT INTO MovimientoInventario (IdProducto, IdUsuario, IdVenta, TipoMovimiento, Cantidad, StockAnterior, StockNuevo, Observacion) VALUES (?, ?, ?, 'ANULACION', ?, ?, ?, ?)`, [p.id,u.id,pedidoId,detalle.cantidad,p.stock,p.stock+detalle.cantidad,p.numero]);
    }
    await c.execute("UPDATE Venta SET Estado = 'CANCELADA' WHERE IdVenta = ?",[pedidoId]);
    await c.execute("UPDATE Pago SET Estado = 'RECHAZADO' WHERE IdVenta = ?",[pedidoId]);
    await c.commit(); return {id:pedidoId,numero:p.numero,estado:'CANCELADA'};
  }catch(err){await c.rollback();throw err;}finally{c.release();}
}

// --------------------------------------------------------
// 6. ENRUTADOR API REST
// --------------------------------------------------------

function json(res, status, obj, header = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...header
  });
  res.end(JSON.stringify(obj));
}

async function cuerpo(req) {
  let x = '';
  for await (const b of req) {
    x += b;
    if (x.length > 64000) error('Solicitud demasiado grande.', 413);
  }
  try {
    return x ? JSON.parse(x) : {};
  } catch {
    error('El formato JSON no es válido.');
  }
}

// [API REST] Rutas protegidas por sesión y permisos. Conecta formularios con funciones y MySQL.
async function api(req, res, ruta) {
  const u = await usuarioActual(req);

  // Rutas públicas o de sesión
  if (req.method === 'GET' && ruta === '/api/sesion') {
    return json(res, 200, { usuario: u });
  }
  if (req.method === 'GET' && ruta === '/api/estado') {
    return json(res, 200, await estado(u));
  }
  if (req.method === 'POST' && ruta === '/api/sesion') {
    return inicioSesion(req, res, await cuerpo(req));
  }
  if (req.method === 'POST' && ruta === '/api/registro') {
    return registro(req, res, await cuerpo(req));
  }
  if (req.method === 'DELETE' && ruta === '/api/sesion') {
    const token = cookies(req).sesion;
    if (token) SESIONES.delete(token);
    return json(res, 200, { ok: true }, { 'set-cookie': cookie(req, '', 0) });
  }

  // Rutas protegidas (requieren sesión activa)
  if (!u) error('Inicia sesión para continuar.', 401);

  const data = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await cuerpo(req) : {};
  const parts = ruta.split('/').filter(Boolean);
  const itemId = parts.length > 2 ? Number(parts[2]) : null;

  if (req.method === 'POST' && /^\/api\/pedidos\/\d+\/confirmar$/.test(ruta)) {
    const pedidoId = id(ruta.split('/')[3]);
    return json(res, 200, await confirmarPedido(u, pedidoId));
  }
  if (req.method === 'POST' && /^\/api\/pedidos\/\d+\/entregar$/.test(ruta)) {
    return json(res, 200, await entregarPedido(u, id(ruta.split('/')[3])));
  }
  if (req.method === 'POST' && /^\/api\/pedidos\/\d+\/cancelar$/.test(ruta)) {
    return json(res, 200, await cancelarPedido(u, id(ruta.split('/')[3])));
  }
  if (req.method === 'POST' && ruta === '/api/ventas') {
    const v = await venta(u, data);
    return json(res, 201, v);
  }
  if (req.method === 'POST' && ruta === '/api/movimientos') {
    await movimiento(u, data);
    return json(res, 201, { ok: true });
  }
  if (req.method === 'POST' && ruta === '/api/caja/cerrar') {
    await cerrarCaja(u, data);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && ruta === '/api/caja/abrir') {
    await abrirCaja(u, data);
    return json(res, 201, { ok: true });
  }

  // CRUD genérico: productos, proveedores, usuarios
  if (['productos', 'proveedores', 'usuarios'].includes(parts[1])) {
    const tipo = parts[1];

    if (req.method === 'POST' && parts.length === 2) {
      if (tipo === 'productos') await guardarProducto(u, data);
      if (tipo === 'proveedores') await guardarProveedor(u, data);
      if (tipo === 'usuarios') await guardarUsuario(u, data);
      return json(res, 201, { ok: true });
    }

    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      error('Identificador inválido.');
    }

    if (req.method === 'PUT' && parts.length === 3) {
      if (tipo === 'productos') await guardarProducto(u, data, itemId);
      if (tipo === 'proveedores') await guardarProveedor(u, data, itemId);
      if (tipo === 'usuarios') await guardarUsuario(u, data, itemId);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'PATCH' && parts[3] === 'estado') {
      if (tipo === 'productos') {
        permitido(u, ['admin', 'almacen']);
        await pool.execute('UPDATE Producto SET Activo = NOT Activo WHERE IdProducto = ?', [itemId]);
      } else if (tipo === 'usuarios') {
        permitido(u, ['admin']);
        if (u.id === itemId) error('No puedes desactivar tu cuenta.');
        await pool.execute('UPDATE Usuario SET Activo = NOT Activo WHERE IdUsuario = ?', [itemId]);
      } else {
        permitido(u, ['admin', 'almacen']);
        await pool.execute('UPDATE Proveedor SET Activo = NOT Activo WHERE IdProveedor = ?', [itemId]);
      }
      return json(res, 200, { ok: true });
    }
  }

  error('Ruta de API no encontrada.', 404);
}

// --------------------------------------------------------
// 7. SERVIDOR DE ARCHIVOS ESTÁTICOS
// --------------------------------------------------------

async function estatico(req, res, ruta) {
  const archivos = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/script.js': 'script.js',
    '/estilos.css': 'estilos.css',
    '/bootstrap/css/bootstrap.min.css': 'bootstrap/css/bootstrap.min.css',
    '/bootstrap/js/bootstrap.bundle.min.js': 'bootstrap/js/bootstrap.bundle.min.js'
  };

  const archivo = archivos[ruta];
  if (!archivo) error('No encontrado.', 404);

  const tipos = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
  };

  const data = await fs.readFile(path.join(WEB, archivo));
  res.writeHead(200, {
    'content-type': tipos[path.extname(archivo)],
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
    'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(data);
}

// --------------------------------------------------------
// 8. CREACIÓN Y ARRANQUE DEL SERVIDOR
// --------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const ruta = new URL(req.url, 'http://localhost').pathname;

    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      error('Método no permitido.', 405);
    }

    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
      const o = new URL(req.headers.origin);
      if (o.host !== req.headers.host) {
        error('Origen no autorizado.', 403);
      }
    }

    if (ruta.startsWith('/api/')) {
      await api(req, res, ruta);
    } else if (req.method === 'GET') {
      await estatico(req, res, ruta);
    } else {
      error('Método no permitido.', 405);
    }
  } catch (e) {
    const status = e.estado || 500;
    if (status >= 500) {
      console.error('Error del servidor:', e);
    }
    if (!res.headersSent) {
      json(res, status, {
        error: status >= 500 ? 'No se pudo completar la operación. Comprueba el servidor y la base de datos.' : e.message
      });
    }
  }
});

if (require.main === module) {
  pool.query('SELECT 1')
    .then(() => {
      server.listen(PORT, '127.0.0.1', () => {
        console.log(`Bodega Armando: http://localhost:${PORT}`);
      });
    })
    .catch(e => {
      console.error('Error de conexión con MySQL:', e.message);
      process.exit(1);
    });
}

module.exports = { server, pool };
