const databaseName = 'hongrenguan-ui-drafts';
const storeName = 'restyle-references';

const openDatabase = () =>
  new Promise((resolve) => {
    if (!globalThis.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName, { keyPath: 'projectId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

const transactionDone = (transaction) =>
  new Promise((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });

export async function loadRestyleReferences(projectId) {
  const database = await openDatabase();
  if (!database) return [];
  const transaction = database.transaction(storeName, 'readonly');
  const request = transaction.objectStore(storeName).get(projectId);
  const record = await new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  database.close();
  return (record?.items || []).map((item) => ({
    id: item.id,
    label: item.label,
    file: new File([item.blob], item.name, {
      type: item.type,
      lastModified: item.lastModified,
    }),
  }));
}

export async function saveRestyleReferences(projectId, references) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put({
    projectId,
    items: references.map((reference) => ({
      id: reference.id,
      label: reference.label,
      blob: reference.file,
      name: reference.file.name,
      type: reference.file.type,
      lastModified: reference.file.lastModified,
    })),
  });
  await transactionDone(transaction);
  database.close();
}
