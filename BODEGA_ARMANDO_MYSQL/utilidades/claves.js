'use strict';
const {randomBytes,scryptSync,timingSafeEqual}=require('node:crypto');
function hashClave(clave){
  if(typeof clave!=='string'||clave.length<8)throw Error('La contraseña debe tener al menos 8 caracteres.');
  const salt=randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(clave,salt,64).toString('hex')}`;
}
function verificarClave(clave,codigo){
  if(typeof clave!=='string'||typeof codigo!=='string')return false;
  const [alg,salt,hash]=codigo.split('$');
  if(alg!=='scrypt'||!salt||!hash||hash.length!==128)return false;
  try{return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(clave,salt,64));}
  catch{return false;}
}
module.exports={hashClave,verificarClave};
