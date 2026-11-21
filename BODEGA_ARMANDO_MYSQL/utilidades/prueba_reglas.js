'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','sistema','servidor.js'),'utf8');
function slice(a,b){let i=source.indexOf(a),j=source.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,`No se encontró ${a}`);return source.slice(i,j)}
const funcs=slice('function error(', '// 2. SESIONES Y AUTENTICACIÓN')+slice('async function venta(', 'async function cerrarCaja(')+slice('async function confirmarPedido(', '// 6. ENRUTADOR API REST');
function setup(){
 const db={productos:[{id:1,nombre:'Arroz',precio:5,stock:10,activo:true}],ventas:[],detalles:[],movimientos:[],pagos:[],caja:{id:1,numero:1,abierta:true}};
 let backup;
 const conn={
  async beginTransaction(){backup=JSON.stringify(db)},async commit(){backup=null},async rollback(){if(backup)Object.assign(db,JSON.parse(backup));backup=null},release(){},
  async query(q,ps){if(/FROM Producto\s+WHERE IdProducto IN/i.test(q))return [db.productos.filter(p=>ps.includes(p.id)).map(x=>({...x}))];throw Error('unexpected SQL query '+q)},
  async execute(q,ps=[]){const s=q.replace(/\s+/g,' ').trim();
   if(/SELECT IdCaja AS id.* FROM Caja/.test(s))return [[db.caja]];
   if(s.startsWith('INSERT INTO Venta')){let v={id:db.ventas.length+1,cliente:ps[0],vendedor:ps[1],caja:ps[2],origen:ps[3],estado:ps[4],entrega:'PENDIENTE',total:Number(ps[7]),numero:''};db.ventas.push(v);return [{insertId:v.id}]}
   if(s.startsWith('UPDATE Venta SET Numero')){db.ventas.find(v=>v.id===ps[1]).numero=ps[0];return [{}]}
   if(s.startsWith('INSERT INTO Pago')){db.pagos.push({ventaId:ps[0],pago:ps[1],estado:ps[2],referencia:ps[4]});return [{}]}
   if(s.startsWith('INSERT INTO DetalleVenta')){db.detalles.push({ventaId:ps[0],producto:ps[1],cantidad:ps[2]});return [{}]}
   if(s.startsWith('UPDATE Producto SET StockActual = StockActual -')){db.productos.find(p=>p.id===ps[1]).stock-=ps[0];return [{}]}
   if(s.startsWith('UPDATE Producto SET StockActual = StockActual +')){db.productos.find(p=>p.id===ps[1]).stock+=ps[0];return [{}]}
   if(s.startsWith('INSERT INTO MovimientoInventario')){db.movimientos.push({sql:s,ps});return [{}]}
   if(s.includes('FROM Venta v JOIN Pago pago')){const v=db.ventas.find(v=>v.id===ps[0]),p=db.pagos.find(p=>p.ventaId===ps[0]);return [[v&&p?{...v,estadoPago:p.estado,referencia:p.referencia}:undefined]]}
   if(s.includes('FROM Venta WHERE IdVenta')){const v=db.ventas.find(v=>v.id===ps[0]);return [[v?{...v}:undefined]]}
   if(s.includes('FROM DetalleVenta WHERE IdVenta'))return [db.detalles.filter(x=>x.ventaId===ps[0])];
   if(s.startsWith("UPDATE Venta SET Estado = 'PAGADA'")){const v=db.ventas.find(v=>v.id===ps[2]);v.estado='PAGADA';v.vendedor=ps[0];v.caja=ps[1];return [{}]}
   if(s.startsWith("UPDATE Venta SET EstadoEntrega = 'ENTREGADA'")){const v=db.ventas.find(v=>v.id===ps[1]);v.entrega='ENTREGADA';return [{}]}
   if(s.startsWith("UPDATE Venta SET Estado = 'CANCELADA'")){db.ventas.find(v=>v.id===ps[0]).estado='CANCELADA';return [{}]}
   if(s.startsWith("UPDATE Pago SET Estado =")){db.pagos.find(p=>p.ventaId===ps[0]).estado=s.includes('APROBADO')?'APROBADO':'RECHAZADO';return [{}]}
   throw Error('unexpected SQL '+s)
  }
 };
 const ctx={pool:{getConnection:async()=>conn},Number,Math,String,Map,Error,console};vm.createContext(ctx);vm.runInContext(funcs+'\nthis.apiTest={venta,confirmarPedido,entregarPedido,cancelarPedido}',ctx);return {db,f:ctx.apiTest};
}
const cli={id:8,rol:'cliente'},caj={id:9,rol:'cajero'},alm={id:10,rol:'almacen'};
const pedido={origen:'Cliente',pago:'Yape',referencia:'YAPE-12345',items:[{id:1,cantidad:2}]};
test('pedido web reserva inventario y permanece pendiente de verificación',async()=>{const {db,f}=setup();const r=await f.venta(cli,pedido);assert.equal(r.estado,'PENDIENTE');assert.equal(db.productos[0].stock,8);assert.equal(db.movimientos.length,1);assert.equal(db.pagos[0].estado,'PENDIENTE')});
test('POS pagada descuenta inventario inmediatamente',async()=>{const {db,f}=setup();const r=await f.venta(caj,{origen:'POS',pago:'Efectivo',recibido:20,items:[{id:1,cantidad:2}]});assert.equal(r.estado,'PAGADA');assert.equal(db.productos[0].stock,8)});
test('confirmar cobro y entregar no descuentan dos veces',async()=>{const {db,f}=setup();const p=await f.venta(cli,pedido);await f.confirmarPedido(caj,p.id);assert.equal(db.productos[0].stock,8);const e=await f.entregarPedido(caj,p.id);assert.equal(e.entrega,'ENTREGADA');assert.equal(db.productos[0].stock,8);await assert.rejects(f.entregarPedido(caj,p.id),/debe estar pagado/i)});
test('anular pedido pendiente devuelve stock reservado',async()=>{const {db,f}=setup();const p=await f.venta(cli,pedido);await f.cancelarPedido(caj,p.id);assert.equal(db.productos[0].stock,10);assert.equal(db.ventas[0].estado,'CANCELADA');assert.equal(db.movimientos.length,2)});
test('no permite pago sin referencia ni manipular pedido desde almacén',async()=>{const {db,f}=setup();await assert.rejects(f.venta(cli,{...pedido,referencia:''}),/referencia/);const p=await f.venta(cli,pedido);await assert.rejects(f.entregarPedido(alm,p.id),/permisos/)});
