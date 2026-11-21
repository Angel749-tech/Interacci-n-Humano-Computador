-- ========================================================
-- SISTEMA BODEGA ARMANDO - BASE DE DATOS MYSQL
-- ========================================================

CREATE DATABASE IF NOT EXISTS BodegaArmando 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE BodegaArmando;

-- --------------------------------------------------------
-- 1. MÓDULO DE USUARIOS Y ROLES
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS Rol (
  IdRol INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  Nombre VARCHAR(30) NOT NULL UNIQUE,
  Descripcion VARCHAR(150)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Usuario (
  IdUsuario INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  IdRol INT UNSIGNED NOT NULL,
  NombreCompleto VARCHAR(120) NOT NULL,
  NombreUsuario VARCHAR(50) NOT NULL UNIQUE,
  Correo VARCHAR(150) UNIQUE,
  ClaveHash VARCHAR(255) NOT NULL,
  Telefono VARCHAR(20),
  DireccionEnvio VARCHAR(250),
  FechaRegistro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Activo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT FK_Usuario_Rol FOREIGN KEY (IdRol) REFERENCES Rol(IdRol)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- 2. MÓDULO DE CATÁLOGO Y PRODUCTOS
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS Categoria (
  IdCategoria INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  Nombre VARCHAR(80) NOT NULL UNIQUE,
  Descripcion VARCHAR(250),
  Activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Producto (
  IdProducto INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  IdCategoria INT UNSIGNED NOT NULL,
  Codigo VARCHAR(30) NOT NULL UNIQUE,
  Nombre VARCHAR(120) NOT NULL,
  Descripcion VARCHAR(500),
  PrecioVenta DECIMAL(12,2) NOT NULL,
  StockActual INT NOT NULL DEFAULT 0,
  StockMinimo INT NOT NULL DEFAULT 5,
  Imagen VARCHAR(800),
  Activo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT FK_Producto_Categoria FOREIGN KEY (IdCategoria) REFERENCES Categoria(IdCategoria)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- 3. MÓDULO DE PROVEEDORES E INVENTARIO
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS Proveedor (
  IdProveedor INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  RUC CHAR(11) UNIQUE,
  Nombre VARCHAR(150) NOT NULL,
  Contacto VARCHAR(120),
  Telefono VARCHAR(20),
  Correo VARCHAR(150),
  Direccion VARCHAR(250),
  Activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS MovimientoInventario (
  IdMovimiento INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  IdProducto INT UNSIGNED NOT NULL,
  IdUsuario INT UNSIGNED NOT NULL,
  IdProveedor INT UNSIGNED,
  IdVenta INT UNSIGNED,
  TipoMovimiento ENUM('INGRESO','SALIDA','AJUSTE','VENTA','RESERVA','ANULACION') NOT NULL,
  Cantidad INT NOT NULL,
  StockAnterior INT NOT NULL,
  StockNuevo INT NOT NULL,
  FechaMovimiento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Observacion VARCHAR(250),
  CONSTRAINT FK_MovInv_Producto FOREIGN KEY (IdProducto) REFERENCES Producto(IdProducto),
  CONSTRAINT FK_MovInv_Usuario FOREIGN KEY (IdUsuario) REFERENCES Usuario(IdUsuario)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- 4. MÓDULO DE CAJA Y VENTAS
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS Caja (
  IdCaja INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  Numero INT UNSIGNED NOT NULL UNIQUE,
  SaldoInicial DECIMAL(12,2) NOT NULL DEFAULT 0,
  Abierta BOOLEAN NOT NULL DEFAULT TRUE,
  AbiertaPor INT UNSIGNED,
  FechaApertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT FK_Caja_Usuario FOREIGN KEY (AbiertaPor) REFERENCES Usuario(IdUsuario)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS CierreCaja (
  IdCierre INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  IdCaja INT UNSIGNED NOT NULL UNIQUE,
  IdUsuario INT UNSIGNED NOT NULL,
  EfectivoEsperado DECIMAL(12,2) NOT NULL,
  EfectivoContado DECIMAL(12,2) NOT NULL,
  Diferencia DECIMAL(12,2) NOT NULL,
  Observacion VARCHAR(250),
  FechaCierre DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT FK_Cierre_Caja FOREIGN KEY (IdCaja) REFERENCES Caja(IdCaja),
  CONSTRAINT FK_Cierre_Usuario FOREIGN KEY (IdUsuario) REFERENCES Usuario(IdUsuario)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Venta (
  IdVenta INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  Numero VARCHAR(25) UNIQUE,
  IdCliente INT UNSIGNED,
  IdVendedor INT UNSIGNED,
  IdCaja INT UNSIGNED,
  Origen ENUM('CLIENTE','POS') NOT NULL,
  FechaVenta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Estado ENUM('PENDIENTE','PAGADA','CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
  EstadoEntrega ENUM('PENDIENTE','ENTREGADA') NOT NULL DEFAULT 'PENDIENTE',
  FechaEntrega DATETIME NULL,
  IdEntregadoPor INT UNSIGNED NULL,
  Subtotal DECIMAL(12,2) NOT NULL,
  Impuesto DECIMAL(12,2) NOT NULL,
  Total DECIMAL(12,2) NOT NULL,
  Recibido DECIMAL(12,2),
  Vuelto DECIMAL(12,2),
  CONSTRAINT FK_Venta_Cliente FOREIGN KEY (IdCliente) REFERENCES Usuario(IdUsuario),
  CONSTRAINT FK_Venta_Vendedor FOREIGN KEY (IdVendedor) REFERENCES Usuario(IdUsuario),
  CONSTRAINT FK_Venta_Caja FOREIGN KEY (IdCaja) REFERENCES Caja(IdCaja),
  CONSTRAINT FK_Venta_EntregadoPor FOREIGN KEY (IdEntregadoPor) REFERENCES Usuario(IdUsuario)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS DetalleVenta (
  IdDetalleVenta INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  IdVenta INT UNSIGNED NOT NULL,
  IdProducto INT UNSIGNED NOT NULL,
  Cantidad INT NOT NULL,
  PrecioUnitario DECIMAL(12,2) NOT NULL,
  Subtotal DECIMAL(12,2) NOT NULL,
  Impuesto DECIMAL(12,2) NOT NULL,
  Total DECIMAL(12,2) NOT NULL,
  CONSTRAINT FK_DetalleVenta_Venta FOREIGN KEY (IdVenta) REFERENCES Venta(IdVenta),
  CONSTRAINT FK_DetalleVenta_Producto FOREIGN KEY (IdProducto) REFERENCES Producto(IdProducto)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Pago (
  IdPago INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  IdVenta INT UNSIGNED NOT NULL UNIQUE,
  MetodoPago ENUM('Efectivo','Yape','Tarjeta') NOT NULL,
  Estado ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  Monto DECIMAL(12,2) NOT NULL,
  FechaPago DATETIME,
  Referencia VARCHAR(100),
  CONSTRAINT FK_Pago_Venta FOREIGN KEY (IdVenta) REFERENCES Venta(IdVenta)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- 5. VISTAS PARA DASHBOARDS Y REPORTES
-- --------------------------------------------------------

CREATE OR REPLACE VIEW vw_ProductosStockBajo AS
SELECT IdProducto, Codigo, Nombre, StockActual, StockMinimo
FROM Producto 
WHERE Activo = TRUE AND StockActual <= StockMinimo;

CREATE OR REPLACE VIEW vw_ResumenVentas AS
SELECT DATE(FechaVenta) AS Fecha, 
       COUNT(*) AS CantidadVentas,
       SUM(Subtotal) AS Subtotal, 
       SUM(Impuesto) AS Impuestos, 
       SUM(Total) AS Total
FROM Venta 
WHERE Estado = 'PAGADA'
GROUP BY DATE(FechaVenta);
