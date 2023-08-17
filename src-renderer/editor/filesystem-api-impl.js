/**
 * Partial reimplementation of the FileSystem API
 * https://web.dev/file-system-access/
 */

/**
 * @param {unknown} contents
 * @returns {Uint8Array}
 */
const toUnit8Array = (contents) => {
  if (contents instanceof Uint8Array) {
    return contents;
  }
  if (contents instanceof Blob) {
    throw new Error('Should never receive a Blob here.');
  }
  return new Uint8Array(contents);
};

class WrappedFileWritable {
  constructor () {
    this._channel = new MessageChannel();

    /** @type {Map<number, {resolve: () => void, reject: (error: unknown) => void}>} */
    this._callbacks = new Map();
    this._lastMessageId = 1;

    /**
     * Error from the main process, if any.
     * @type {unknown}
     */
    this._error = null;

    this._channel.port1.onmessage = (event) => {
      const data = event.data;

      const error = data.error;
      if (error) {
        this._error = error;
        for (const handlers of this._callbacks.values()) {
          handlers.reject(error);
        }
        this._callbacks.clear();
      }

      const response = data.response;
      if (response) {
        const id = response.id;
        const handlers = this._callbacks.get(id);
        if (handlers) {
          handlers.resolve(response.result);
          this._callbacks.delete(id);
        }
      }
    };

    // Note that we don't need to wait for the other end before we can start sending data. The messages
    // will just be queued up.
    // We use this weird postMessage because Electron's context bridge doesn't handle the channel objects.
    window.postMessage('start-write-stream', window.origin, [this._channel.port2])
  }

  _sendToMainAndWait (message) {
    if (this._error) {
      throw this._error;
    }

    const messageId = this._lastMessageId++;
    message.id = messageId;
    return new Promise((resolve, reject) => {
      this._callbacks.set(messageId, {
        resolve,
        reject
      });
      this._channel.port1.postMessage(message);
    });
  }

  async write (contents) {
    await this._sendToMainAndWait({
      write: toUnit8Array(contents)
    });
  }

  async close () {
    await this._sendToMainAndWait({
      finish: true
    });
  }

  async abort () {
    await this._sendToMainAndWait({
      abort: true
    });
  }
}

export class WrappedFileHandle {
  /**
   * @param {string} name File name with extension.
   * @param {boolean} unfinished
   */
  constructor (name) {
    this.name = name;
  }

  async getFile () {
    const data = await EditorPreload.getFile();
    return new File([data.data], this.name);
  }

  async createWritable () {
    return new WrappedFileWritable();
  }
}

class AbortError extends Error {
  constructor (message) {
    super(message);
    this.name = 'AbortError';
  }
}

window.showSaveFilePicker = async (options) => {
  const name = await EditorPreload.showSaveFilePicker({
    suggestedName: options.suggestedName
  });
  if (name === null) {
    throw new AbortError('Save aborted');
  }
  return new WrappedFileHandle(name);
};

window.showOpenFilePicker = async () => {
  const name = await EditorPreload.showOpenFilePicker();
  if (name === null) {
    throw new AbortError('Open aborted');
  }
  return [new WrappedFileHandle(name)];
};
