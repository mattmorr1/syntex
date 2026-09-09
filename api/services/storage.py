"""
Firebase Cloud Storage helpers for binary project files (images, PDFs).

Images are stored at:  projects/{project_id}/images/{filename}
Content field in Firestore:  "gcs://projects/{project_id}/images/{filename}"

This avoids hitting Firestore's 1 MB document limit with base64-encoded binary.
"""
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

GCS_PREFIX = "gcs://"


def _get_bucket():
    """Lazy-import firebase_admin.storage to avoid circular deps."""
    from firebase_admin import storage
    return storage.bucket()


# Dev fallback: with no Firebase credentials there is no bucket, and without this the
# app cannot compile locally at all. Process-local, so it is only ever right for one instance.
_dev_blobs: dict[str, bytes] = {}


def _bucket_available() -> bool:
    try:
        import firebase_admin
        return bool(firebase_admin._apps)
    except Exception:
        return False


def is_gcs_ref(content: str) -> bool:
    return content.startswith(GCS_PREFIX)


def put_blob(blob_path: str, data: bytes, mime: str) -> str:
    """Write bytes to a bucket path. Returns the 'gcs://' reference. Blocking."""
    if not _bucket_available():
        _dev_blobs[blob_path] = data
        return GCS_PREFIX + blob_path
    try:
        blob = _get_bucket().blob(blob_path)
        blob.upload_from_string(data, content_type=mime)
        return GCS_PREFIX + blob_path
    except Exception as e:
        logger.error(f"GCS upload failed for {blob_path}: {e}")
        raise


def get_blob(blob_path: str) -> Optional[bytes]:
    """Read bytes from a bucket path. Returns None if absent. Blocking."""
    if not _bucket_available():
        return _dev_blobs.get(blob_path)
    try:
        blob = _get_bucket().blob(blob_path)
        if not blob.exists():
            return None
        buf = io.BytesIO()
        blob.download_to_file(buf)
        buf.seek(0)
        return buf.read()
    except Exception as e:
        logger.error(f"GCS download failed for {blob_path}: {e}")
        raise


def upload_image(data: bytes, project_id: str, filename: str, mime: str = "image/png") -> str:
    """
    Upload binary image data to Firebase Storage.
    Returns a 'gcs://' reference string to store in Firestore instead of raw base64.
    """
    ref = put_blob(f"projects/{project_id}/images/{filename}", data, mime)
    logger.info(f"Uploaded image to GCS: {ref}")
    return ref


def download_image(gcs_ref: str) -> bytes:
    """
    Download a binary file from Firebase Storage given a 'gcs://' reference.
    Returns raw bytes.
    """
    data = get_blob(gcs_ref[len(GCS_PREFIX):])
    if data is None:
        raise FileNotFoundError(f"No such blob: {gcs_ref}")
    return data


def delete_image(gcs_ref: str) -> None:
    """Delete a blob from Firebase Storage (best-effort)."""
    try:
        blob_path = gcs_ref[len(GCS_PREFIX):]
        bucket = _get_bucket()
        blob = bucket.blob(blob_path)
        blob.delete()
    except Exception as e:
        logger.warning(f"GCS delete failed for {gcs_ref}: {e}")
