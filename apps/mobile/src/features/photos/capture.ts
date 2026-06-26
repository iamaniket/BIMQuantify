import * as Crypto from 'expo-crypto';
// SDK 56: the durable file APIs (documentDirectory, copyAsync, uploadAsync) live
// under the /legacy subpath; the new File/Directory API isn't needed here.
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import type { ExifData, GeolocationData } from '@/lib/api/schemas/attachments';

/** A photo captured on-device, copied into app storage and ready to upload. */
export type CapturedPhoto = {
  // A client-minted id used as the upload's Idempotency-Key and the outbox
  // temp id later (Phase 5). Stable for the life of this photo.
  localId: string;
  /** App-owned copy of the full image (survives picker-cache GC). */
  uri: string;
  /** Small JPEG preview for the strip. */
  thumbnailUri: string;
  width: number;
  height: number;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  /** Hex SHA-256 of the file bytes (the server's content_sha256). */
  sha256: string;
  capturedAt: string;
  /** Maps to the server's capture_method (camera | file_picker). */
  captureMethod: 'camera' | 'file_picker';
  geolocation?: GeolocationData;
  exif?: ExifData;
};

export type CaptureSource = 'camera' | 'library';

const PHOTO_DIR = `${FileSystem.documentDirectory ?? ''}snag-photos/`;
const THUMB_DIR = `${FileSystem.documentDirectory ?? ''}snag-thumbs/`;

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode base64 → bytes without relying on a global atob (Hermes-safe). The
 * cleaned (padding-stripped) length makes `out` exactly the decoded size, so we
 * return the backing array directly — a subarray view would be typed
 * `Uint8Array<ArrayBufferLike>` and not satisfy `Crypto.digest`'s `BufferSource`. */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  // Explicit ArrayBuffer backing so the result is `Uint8Array<ArrayBuffer>` —
  // TS 6.0's `BufferSource` (Crypto.digest's param) excludes SharedArrayBuffer.
  const out = new Uint8Array(new ArrayBuffer(Math.floor((clean.length * 3) / 4)));
  let acc = 0;
  let bits = 0;
  let oi = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const c = B64_ALPHABET.indexOf(clean[i]!);
    if (c === -1) continue;
    acc = (acc << 6) | c;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[oi] = (acc >> bits) & 0xff;
      oi += 1;
    }
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

async function sha256OfFile(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToBytes(b64);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return bytesToHex(new Uint8Array(digest));
}

function mapExif(raw: Record<string, unknown> | undefined): ExifData | undefined {
  if (raw === undefined) return undefined;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    make: str(raw['Make']),
    model: str(raw['Model']),
    date_time_original: str(raw['DateTimeOriginal']),
    gps_latitude: num(raw['GPSLatitude']),
    gps_longitude: num(raw['GPSLongitude']),
    orientation: num(raw['Orientation']),
    image_width: num(raw['ImageWidth'] ?? raw['PixelXDimension']),
    image_height: num(raw['ImageHeight'] ?? raw['PixelYDimension']),
  };
}

async function bestEffortLocation(): Promise<GeolocationData | undefined> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return undefined;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
      altitude: pos.coords.altitude ?? null,
    };
  } catch {
    return undefined;
  }
}

/**
 * Capture or pick one photo, copy it into app storage, build a thumbnail, hash
 * it, and gather EXIF/geo. Returns null when the user cancels or denies
 * permission (the caller shows no error in that case).
 */
export async function capturePhoto(source: CaptureSource): Promise<CapturedPhoto | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, exif: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, exif: true });

  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0]!;

  const localId = Crypto.randomUUID();
  const contentType =
    asset.mimeType !== undefined && asset.mimeType in EXT_BY_CONTENT_TYPE
      ? asset.mimeType
      : 'image/jpeg';
  const ext = EXT_BY_CONTENT_TYPE[contentType] ?? 'jpg';
  const fileName = asset.fileName ?? `snag-${localId}.${ext}`;

  await ensureDir(PHOTO_DIR);
  await ensureDir(THUMB_DIR);

  const photoUri = `${PHOTO_DIR}${localId}.${ext}`;
  await FileSystem.copyAsync({ from: asset.uri, to: photoUri });

  const thumb = await manipulateAsync(photoUri, [{ resize: { width: 200 } }], {
    compress: 0.6,
    format: SaveFormat.JPEG,
  });
  const thumbUri = `${THUMB_DIR}${localId}.jpg`;
  await FileSystem.copyAsync({ from: thumb.uri, to: thumbUri });

  const sha256 = await sha256OfFile(photoUri);
  const info = await FileSystem.getInfoAsync(photoUri);
  const sizeBytes = info.exists && info.size !== undefined ? info.size : (asset.fileSize ?? 0);

  return {
    localId,
    uri: photoUri,
    thumbnailUri: thumbUri,
    width: asset.width,
    height: asset.height,
    contentType,
    fileName,
    sizeBytes,
    sha256,
    capturedAt: new Date().toISOString(),
    captureMethod: source === 'camera' ? 'camera' : 'file_picker',
    geolocation: await bestEffortLocation(),
    exif: mapExif(asset.exif as Record<string, unknown> | undefined),
  };
}
