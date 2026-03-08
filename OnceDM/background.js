(() => {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[i] = value >>> 0;
  }

  function crc32(uint8Array) {
    let crc = 0xffffffff;
    for (const byte of uint8Array) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function getDosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime =
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2);
    const dosDate =
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();

    return { dosDate, dosTime };
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, value, true);
    return bytes;
  }

  function joinUint8Arrays(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  }

  function buildStoredZip(entries) {
    const localParts = [];
    const centralParts = [];
    const encoder = new TextEncoder();
    const { dosDate, dosTime } = getDosDateTime();
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(sanitizeFilename(entry.filename));
      const data = entry.bytes;
      const checksum = crc32(data);

      const localHeader = joinUint8Arrays([
        uint32(0x04034b50),
        uint16(20),
        uint16(0),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(checksum),
        uint32(data.length),
        uint32(data.length),
        uint16(nameBytes.length),
        uint16(0),
        nameBytes,
      ]);

      localParts.push(localHeader, data);

      const centralHeader = joinUint8Arrays([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(checksum),
        uint32(data.length),
        uint32(data.length),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes,
      ]);

      centralParts.push(centralHeader);
      offset += localHeader.length + data.length;
    }

    const centralDirectory = joinUint8Arrays(centralParts);
    const localDirectory = joinUint8Arrays(localParts);
    const endRecord = joinUint8Arrays([
      uint32(0x06054b50),
      uint16(0),
      uint16(0),
      uint16(entries.length),
      uint16(entries.length),
      uint32(centralDirectory.length),
      uint32(localDirectory.length),
      uint16(0),
    ]);

    return new Blob([localDirectory, centralDirectory, endRecord], {
      type: "application/zip",
    });
  }

  async function createZipFromFiles(files) {
    const entries = [];

    for (const file of files) {
      try {
        const response = await fetch(file.url);
        const buffer = await response.arrayBuffer();
        entries.push({
          filename: file.filename,
          bytes: new Uint8Array(buffer),
        });
      } catch (error) {
        void error;
      }
    }

    if (!entries.length) {
      throw new Error("No files available for ZIP export");
    }

    const blob = buildStoredZip(entries);
    const objectUrl = URL.createObjectURL(blob);

    try {
      await chrome.downloads.download({
        url: objectUrl,
        filename: `OnceDM_${Date.now()}.zip`,
        saveAs: true,
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {});

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "OPEN_DESKTOP_VIEW") {
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(([tab]) => {
          const sourceTabId = tab?.id;
          const url = chrome.runtime.getURL(`popup.html?desktop=1${sourceTabId ? `&tabId=${sourceTabId}` : ""}`);
          return chrome.tabs.create({ url });
        })
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.action === "DOWNLOAD_ZIP") {
      createZipFromFiles(message.files)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.action === "DOWNLOAD_SINGLE") {
      chrome.downloads.download({
        url: message.url,
        filename: sanitizeFilename(message.filename),
        saveAs: false,
      })
        .then((downloadId) => sendResponse({ success: true, id: downloadId }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });
})();
