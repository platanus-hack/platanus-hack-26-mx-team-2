"""Boundary for user-uploaded documents: bytes in → extracted text out.

The extracted text is the UNTRUSTED source for the demo. We validate at the
boundary (size, format) and never trust the file content. PDF text is pulled with
PyMuPDF; .txt is decoded. Anything malformed raises UploadError (a clean,
user-facing message), never an unhandled exception.
"""

MAX_UPLOAD_BYTES = 5_000_000  # 5 MB cap — a demo document, not a data dump


class UploadError(ValueError):
    """The upload is empty, too large, an unsupported format, or unreadable."""


def _extract_pdf(data: bytes) -> str:
    import fitz  # PyMuPDF; imported lazily so the core install stays light

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # corrupt/encrypted/non-PDF bytes
        raise UploadError(f"PDF inválido o ilegible: {exc}") from exc
    try:
        text = "\n".join(page.get_text() for page in doc).strip()
    finally:
        doc.close()
    if not text:
        raise UploadError("el PDF no contiene texto extraíble (¿es escaneado?)")
    return text


def extract_upload_text(data: bytes, filename: str) -> str:
    """Extract plain text from an uploaded .pdf or .txt. Raises UploadError."""
    if not data:
        raise UploadError("archivo vacío")
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadError("archivo demasiado grande (máx 5 MB)")
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return _extract_pdf(data)
    if name.endswith(".txt"):
        text = data.decode("utf-8", "replace").strip()
        if not text:
            raise UploadError("el archivo de texto está vacío")
        return text
    raise UploadError("formato no soportado: sube un .pdf o .txt")
