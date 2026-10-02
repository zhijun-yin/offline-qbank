let connection;
function openDB() {
  if (!connection) connection = new Promise((resolve,reject) => {
    const request = indexedDB.open('offline-qbank', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}
export async function readDocument(key = 'state') {
  const db = await openDB();
  return new Promise((resolve,reject) => {
    const request = db.transaction('documents').objectStore('documents').get(key);
    request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error);
  });
}
export async function writeDocuments(entries) {
  const db = await openDB();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('documents', 'readwrite');
    for (const [key,value] of entries) tx.objectStore('documents').put(value,key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存被中断'));
  });
}
