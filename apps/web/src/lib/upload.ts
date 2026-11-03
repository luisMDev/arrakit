export interface PresignedPut {
  url: string
  headers: Record<string, string>
}

/**
 * PUTs `file` straight to storage with the signed headers, reporting progress from 0 to 1.
 * XMLHttpRequest, because fetch() cannot report upload progress.
 */
export function putFile(
  target: PresignedPut,
  file: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', target.url)
    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value)
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1)
        resolve()
      } else {
        reject(new Error(`storage answered ${request.status}`))
      }
    }
    request.onerror = () => reject(new Error('storage unreachable'))
    request.send(file)
  })
}
