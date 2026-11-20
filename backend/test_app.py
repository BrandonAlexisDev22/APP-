import base64
import io
import subprocess
import zipfile

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import app

client = TestClient(app)


def make_pdf(rotate=0, pages=2) -> bytes:
    doc = fitz.open()
    for i in range(pages):
        p = doc.new_page(width=595, height=842)
        p.insert_text((72, 72), f"Pagina {i + 1}")
        p.set_rotation(rotate)
    return doc.tobytes()


def signature_png() -> str:
    # 200x50: red left half, blue right half, so orientation is checkable.
    img = Image.new("RGBA", (200, 50), (0, 0, 0, 0))
    img.paste((255, 0, 0, 255), (0, 0, 100, 50))
    img.paste((0, 0, 255, 255), (100, 0, 200, 50))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def upload(name, data):
    return client.post("/api/documents", files={"file": (name, data)})


def color_bbox(pix, pred):
    xs, ys = [], []
    for y in range(pix.height):
        for x in range(pix.width):
            if pred(pix.pixel(x, y)):
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def check_placement(doc_id, box):
    rect = fitz.open(stream=client.get(f"/api/documents/{doc_id}/pdf").content)[box["page"]].rect
    box = {**box, "h": box["w"] * rect.width / rect.height / 4}  # same 4:1 aspect as the image
    r = client.post(f"/api/documents/{doc_id}/sign", json={**box, "signature": signature_png()})
    assert r.status_code == 200, r.text
    signed = client.get(f"/api/documents/{doc_id}/signed")
    assert signed.status_code == 200
    page = fitz.open(stream=signed.content)[box["page"]]
    pix = page.get_pixmap()  # rendered as the user sees it (rotation applied)
    red = color_bbox(pix, lambda c: c[0] > 200 and c[2] < 60)
    blue = color_bbox(pix, lambda c: c[2] > 200 and c[0] < 60)
    W, H = pix.width, pix.height
    # Box is 4:1 like the image -> fills it exactly; red must be left of blue (upright).
    assert abs(red[0] - box["x"] * W) <= 2 and abs(red[1] - box["y"] * H) <= 2, (red, W, H)
    assert abs(blue[2] - (box["x"] + box["w"]) * W) <= 2
    assert red[2] < blue[0]


def test_pdf_portrait_and_rotated_and_zip():
    box = {"page": 1, "x": 0.5, "y": 0.8, "w": 0.4, "h": 0}
    a = upload("contrato.pdf", make_pdf()).json()
    assert a["pages"] == 2 and a["format"] == "pdf"
    check_placement(a["id"], box)

    b = upload("contrato.pdf", make_pdf(rotate=90)).json()  # landscape as displayed
    check_placement(b["id"], {"page": 0, "x": 0.1, "y": 0.1, "w": 0.3, "h": 0})
    for rot in (180, 270):
        c = upload("girado.pdf", make_pdf(rotate=rot)).json()
        check_placement(c["id"], {"page": 1, "x": 0.6, "y": 0.7, "w": 0.3, "h": 0})

    # Original stays intact
    orig = fitz.open(stream=client.get(f"/api/documents/{a['id']}/pdf").content)
    assert not orig[1].get_images()

    z = client.get("/api/zip", params={"ids": f"{a['id']},{b['id']}"})
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert names == ["contrato_firmado.pdf", "contrato_firmado (2).pdf"]


@pytest.mark.parametrize("fmt", ["docx", "doc"])
def test_word_converted(tmp_path, fmt):
    (tmp_path / "carta.txt").write_text("Hola\nDocumento de prueba")
    target = "doc:MS Word 97" if fmt == "doc" else fmt
    subprocess.run(["soffice", "--headless", "--convert-to", target, "--outdir", str(tmp_path),
                    str(tmp_path / "carta.txt")], check=True, capture_output=True, timeout=180)
    d = upload(f"carta.{fmt}", (tmp_path / f"carta.{fmt}").read_bytes()).json()
    assert d["format"] == fmt and d["pages"] == 1
    check_placement(d["id"], {"page": 0, "x": 0.2, "y": 0.5, "w": 0.4, "h": 0})


def test_validation_and_isolation():
    assert upload("x.txt", b"hola").status_code == 400
    assert upload("x.pdf", b"PK fake").status_code == 400
    assert upload("x.doc", b"PK fake").status_code == 400
    assert upload("x.pdf", b"%PDF-1.4 garbage").status_code == 422
    assert client.post("/api/documents/" + "0" * 32 + "/sign",
                       json={"page": 0, "x": 0, "y": 0, "w": 0.1, "h": 0.1, "signature": signature_png()}).status_code == 404
    d = upload("a.pdf", make_pdf(pages=1)).json()
    bad_page = {"page": 5, "x": 0, "y": 0, "w": 0.1, "h": 0.1, "signature": signature_png()}
    assert client.post(f"/api/documents/{d['id']}/sign", json=bad_page).status_code == 400
    assert client.post("/api/signature", files={"file": ("s.png", b"nope")}).status_code == 400
    assert client.delete(f"/api/documents/{d['id']}").status_code == 200
    assert client.get(f"/api/documents/{d['id']}/pdf").status_code == 404


def test_opaque_signature_background_removed():
    img = Image.new("RGB", (100, 40), "white")
    img.paste((0, 0, 0), (20, 10, 80, 30))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    out = Image.open(io.BytesIO(client.post("/api/signature", files={"file": ("s.png", buf.getvalue())}).content))
    assert out.size == (60, 20) and out.getpixel((0, 0))[3] == 255
