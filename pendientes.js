/* Cola de cambios pendientes en IndexedDB.
   La cargan la página (<script>) y el service worker (importScripts), así ambos comparten la misma base. */
const PEND_BD = 'convertidor-pendientes';
const PEND_TIENDA = 'pendientes';

function pendAbrir() {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(PEND_BD, 1);
    peticion.onupgradeneeded = () => {
      peticion.result.createObjectStore(PEND_TIENDA, { keyPath: 'id', autoIncrement: true });
    };
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

// Ejecuta una operación en una transacción y resuelve cuando ésta termina.
function pendEjecutar(modo, operacion) {
  return pendAbrir().then(bd => new Promise((resolve, reject) => {
    const tx = bd.transaction(PEND_TIENDA, modo);
    const peticion = operacion(tx.objectStore(PEND_TIENDA));
    tx.oncomplete = () => { bd.close(); resolve(peticion ? peticion.result : undefined); };
    tx.onerror = tx.onabort = () => { bd.close(); reject(tx.error || new Error('Transacción cancelada')); };
  }));
}

// Guarda un cambio pendiente (entrada, resultado, fecha…). Devuelve su id.
function pendAgregar(item) {
  return pendEjecutar('readwrite', tienda => tienda.add(item));
}

function pendContar() {
  return pendEjecutar('readonly', tienda => tienda.count());
}

// Id más alto de la cola (0 si está vacía). Sirve para vaciar solo lo que se sincronizó.
function pendUltimoId() {
  return pendEjecutar('readonly', tienda => tienda.getAllKeys())
    .then(ids => ids.reduce((max, id) => Math.max(max, id), 0));
}

// Sin argumentos vacía toda la cola; con hastaId borra solo los pendientes con id <= hastaId.
function pendVaciar(hastaId) {
  return pendEjecutar('readwrite', tienda =>
    hastaId == null ? tienda.clear() : tienda.delete(IDBKeyRange.upperBound(hastaId)));
}
