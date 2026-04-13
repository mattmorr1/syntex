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


def is_gcs_ref(content: str) -> bool:
    return content.startswith(GCS_PREFIX)


def upload_image(data: bytes, project_id: str, filename: str, mime: str = "image/png") -> str:
    """
    Upload binary image data to Firebase Storage.
    Returns a 'gcs://' reference string to store in Firestore instead of raw base64.
    """
    try:
        bucket = _get_bucket()
        blob_path = f"projects/{project_id}/images/{filename}"
        blob = bucket.blob(blob_path)
        blob.upload_from_string(data, content_type=mime)
        logger.info(f"Uploaded image to GCS: {blob_path}")
        return GCS_PREFIX + blob_path
    except Exception as e:
        logger.error(f"GCS upload failed for {filename}: {e}")
        raise


def download_image(gcs_ref: str) -> bytes:
    """
    Download a binary file from Firebase Storage given a 'gcs://' reference.
    Returns raw bytes.
    """
    try:
        blob_path = gcs_ref[len(GCS_PREFIX):]
        bucket = _get_bucket()
        blob = bucket.blob(blob_path)
        buf = io.BytesIO()
        blob.download_to_file(buf)
        buf.seek(0)
        return buf.read()
    except Exception as e:
        logger.error(f"GCS download failed for {gcs_ref}: {e}")
        raise


def delete_image(gcs_ref: str) -> None:
    """Delete a blob from Firebase Storage (best-effort)."""
    try:
        blob_path = gcs_ref[len(GCS_PREFIX):]
        bucket = _get_bucket()
        blob = bucket.blob(blob_path)
        blob.delete()
    except Exception as e:
        logger.warning(f"GCS delete failed for {gcs_ref}: {e}")
