import { sha256 } from "@noble/hashes/sha2.js";

// Bound file buffers, including on phones. This runs in a dedicated browser worker.
const HASH_CHUNK_BYTES = 256 * 1024;

export async function hashVideoBlob(blob: Blob): Promise<string> {
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < blob.size; offset += HASH_CHUNK_BYTES) {
      hash.update(new Uint8Array(await blob.slice(offset, offset + HASH_CHUNK_BYTES).arrayBuffer()));
    }
    return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    hash.destroy();
  }
}
