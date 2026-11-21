'use strict';
const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const {hashClave} = require('./claves');
const cuentas = [
 ['angel.alvarado','Alvarado Saravia, Angel Sebasthiam','ADMINISTRADOR'],
 ['hamilton.cornejo','Cornejo Cepiran, Hamilton Yuliano','ALMACENERO'],
 ['keyth.garcia','Garcia Alvarado, Keyth Basiliet','CAJERO'],
 ['alexander.tornero','Tornero Cruz, Alexander Leonardo','ADMINISTRADOR'],
 ['piero.vera','Vera Amaya, Piero Matias','ALMACENERO']
];
(async()=>{
 if (!process.env.DB_USER || process.env.DB_PASSWORD === undefined) throw Error('Configura las credenciales de MySQL en .env.');
 const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'BodegaArmando'});
 try {
  const [roles]=await db.execute('SELECT IdRol AS id,Nombre AS nombre FROM Rol');
  const mapa=new Map(roles.map(x=>[x.nombre,x.id]));
  for(const [usuario,nombre,rol] of cuentas){
   const r=mapa.get(rol);if(!r)throw Error('Falta rol '+rol+'. Ejecuta el SQL 02 primero.');
   const [existentes]=await db.execute('SELECT IdUsuario FROM Usuario WHERE NombreUsuario=?',[usuario]);
   if(existentes.length){console.log('Se conserva cuenta existente: '+usuario);continue;}
   const clave = '12345678';
   await db.execute('INSERT INTO Usuario(IdRol,NombreCompleto,NombreUsuario,ClaveHash) VALUES (?,?,?,?)',[r,nombre,usuario,hashClave(clave)]);
   console.log(`Usuario: ${usuario} | Rol: ${rol} | Contraseña: ${clave} (almacenada como Hash)`);
  }
 } finally {await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
