-- ========================================================
-- SISTEMA BODEGA ARMANDO - DATOS INICIALES
-- ========================================================

USE BodegaArmando;

-- 1. Roles del Sistema
INSERT IGNORE INTO Rol (Nombre, Descripcion) VALUES
('CLIENTE', 'Consulta productos y registra pedidos'),
('ADMINISTRADOR', 'Gestiona productos, usuarios, inventario y reportes'),
('ALMACENERO', 'Gestiona entradas, salidas y proveedores'),
('CAJERO', 'Registra ventas en caja y arqueos');

-- 2. Categorías de Productos
INSERT IGNORE INTO Categoria (Nombre, Descripcion) VALUES
('Abarrotes', 'Arroz, azúcar, aceite y pastas'),
('Lácteos', 'Leche y productos derivados'),
('Bebidas', 'Agua y gaseosas'),
('Limpieza', 'Productos de limpieza doméstica'),
('Snacks', 'Galletas y bocadillos');

-- 3. Catálogo de Productos Iniciales
INSERT IGNORE INTO Producto (IdCategoria, Codigo, Nombre, Descripcion, PrecioVenta, StockActual, StockMinimo, Imagen) VALUES
((SELECT IdCategoria FROM Categoria WHERE Nombre='Abarrotes'), 'AB-001', 'Arroz Superior Costeño 750 g', 'Arroz superior en bolsa de 750 g', 4.00, 38, 6, 'https://media.falabella.com/tottusPE/20092463_1/public'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Abarrotes'), 'AB-002', 'Azúcar Rubia Manuelita 1 kg', 'Azúcar rubia Manuelita en bolsa de 1 kg', 5.10, 24, 6, 'https://media.falabella.com/tottusPE/43418810_1/public'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Abarrotes'), 'AB-003', 'Aceite Primor Clásico 900 mL', 'Aceite vegetal Primor en botella de 900 mL', 8.80, 8, 10, 'https://veramendi.pe/114-superlarge_default/primor-clasico.jpg'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Abarrotes'), 'AB-004', 'Fideos Tottus Linguini 500 g', 'Pasta tipo linguini en bolsa de 500 g', 3.00, 36, 6, 'https://media.falabella.com/tottusPE/43503732_1/public'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Lácteos'), 'LA-001', 'Leche Gloria Reconstituida Entera 390 g', 'Leche reconstituida entera en lata de 390 g', 4.20, 15, 6, 'https://metroio.vtexassets.com/arquivos/ids/627582-800-auto?aspect=true&height=auto&v=639040953775600000&width=800'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Lácteos'), 'LA-002', 'Yogurt Bebible Gloria Vainilla 946 g', 'Yogurt bebible Gloria vainilla, botella de 946 g', 5.40, 12, 6, 'https://media.falabella.com/tottusPE/43058883_1/public'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Bebidas'), 'BE-001', 'Agua San Luis con Gas 625 mL', 'Agua mineral San Luis con gas, botella de 625 mL', 1.90, 5, 10, 'https://www.dunkin.pe/media/catalog/product/s/o/sol_6915.png?bg-color=255%2C255%2C255&canvas=700%3A700&fit=bounds&format=jpeg&height=700&optimize=medium&width=700'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Bebidas'), 'BE-002', 'Gaseosa Inca Kola 1.5 L', 'Gaseosa Inca Kola en botella de 1.5 L', 7.50, 18, 6, 'https://media.falabella.com/tottusPE/10174372_2/public'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Limpieza'), 'LI-001', 'Jabón Bolívar Perlas Blancas 210 g', 'Jabón Bolívar para lavar ropa, empaque de 210 g', 3.80, 16, 6, 'https://4msurtidos.com/cdn/shop/products/Jabonbolivarblanco.png?v=1630350151'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Limpieza'), 'LI-002', 'Detergente Opal Antibacterial 730 g', 'Detergente en polvo Opal Antibacterial, bolsa de 730 g', 8.40, 9, 6, 'https://4msurtidos.com/cdn/shop/products/Detergente-Opal-Antibacterial-780gr_400x.png?v=1634853907'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Snacks'), 'SN-001', 'Galletas Soda Field Sixpack 6 und.', 'Galletas soda Field, seis paquetes de 32 g', 4.00, 25, 6, 'https://cdn.shopify.com/s/files/1/0006/4510/3652/products/galleta-de-soda-field_fb3709fa-02ec-45a4-ad46-900ce071ffe9_2100x2100.jpg?v=1557080908'),
((SELECT IdCategoria FROM Categoria WHERE Nombre='Snacks'), 'SN-002', 'Papas fritas 45 g', 'Snack de papas fritas de 45 g', 2.80, 14, 6, 'https://tofuu.getjusto.com/orioneat-local/resized2/88v25mNGn8TZsGLec-1000-x.webp');

-- 4. Apertura de Caja Inicial (si no existe)
INSERT INTO Caja (Numero, SaldoInicial, Abierta)
SELECT 1, 0.00, TRUE WHERE NOT EXISTS (SELECT 1 FROM Caja);
