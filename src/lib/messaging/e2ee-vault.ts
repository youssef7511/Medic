import type { RecoveryBundle } from './e2ee-types';

const DB = 'medic-messaging-v1';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('vault'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function access<T>(key: string, value?: T): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction('vault', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('vault');
      const request = value === undefined ? store.get(key) : store.put(value, key);
      tx.oncomplete = () => resolve(value === undefined ? request.result as T | undefined : value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
// Only password-protected private certificates are persisted. Unlock secrets stay in memory.
export const loadVault = (userId: string) => access<RecoveryBundle>(`identity:${userId}`);
export const saveVault = (bundle: RecoveryBundle) => access(`identity:${bundle.userId}`, bundle);
export const loadRecoveryAck = (userId: string) => access<boolean>(`recovery-ack:${userId}`);
export const saveRecoveryAck = (userId: string, acknowledged: boolean) => access(`recovery-ack:${userId}`, acknowledged);
export const loadPin = (self: string, peer: string) => access<string>(`peer:${self}:${peer}`);
export const savePin = (self: string, peer: string, fingerprint: string) => access(`peer:${self}:${peer}`, fingerprint);

export function downloadRecovery(bundle: RecoveryBundle) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'medic-messaging-recovery.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
