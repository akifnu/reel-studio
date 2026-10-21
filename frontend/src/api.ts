export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (import.meta.env.VITE_STUDIO_MODE === 'browser') {
    return (await import('./browser/api')).api<T>(path, method, body);
  }
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value;
  try {
    value = await response.json();
  } catch {
    value = {};
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('studio:login'));
    const detail =
      value.error ||
      (typeof value.detail === 'string'
        ? value.detail
        : JSON.stringify(value.detail || 'Request failed'));
    throw new ApiError(detail, response.status);
  }
  return value as T;
}

export async function waitTask(id: string): Promise<unknown> {
  for (let i = 0; i < 300; i++) {
    const task = await api<{ status: string; error?: string; result?: unknown }>('/tasks/' + id);
    if (task.status === 'failed') throw new Error(task.error || 'This action failed.');
    if (task.status === 'succeeded') return task.result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    'This action is taking longer than expected. Check the project status before retrying.',
  );
}

export function upload(
  file: File,
  role: string,
  onProgress: (n: number) => void,
  signal?: AbortSignal,
): Promise<import('./types').Upload> {
  if (import.meta.env.VITE_STUDIO_MODE === 'browser') {
    return import('./browser/api').then((m) => m.upload(file, role, onProgress, signal));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((100 * e.loaded) / e.total));
    };
    xhr.onerror = () => reject(new Error('Upload interrupted. Please try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.onload = () => {
      let value;
      try {
        value = JSON.parse(xhr.responseText);
      } catch {
        value = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(value);
      else reject(new Error(value.error || value.detail || 'Upload failed.'));
    };
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', abort);
    const data = new FormData();
    data.append('file', file);
    data.append('role', role);
    xhr.send(data);
  });
}
