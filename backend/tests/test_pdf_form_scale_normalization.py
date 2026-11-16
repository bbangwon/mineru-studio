from pathlib import Path
from unittest.mock import patch

import pypdf
import pypdfium2 as pdfium
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
)

from backend.app.services.mineru_svc import MineruService, _normalize_tiny_form_xobject_scales


def _build_synthetic_pdf(path: Path, *, tiny_form: bool) -> None:
    writer = pypdf.PdfWriter()
    page = writer.add_blank_page(width=595.28, height=841.86)

    font_dict = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    font_ref = writer._add_object(font_dict)

    sample_text = "2025.12.18.(1,000)"
    # Emit one BT/ET text object per character (matching rhwp output)
    def _escape_pdf_char(ch: str) -> str:
        return f"\\{ch}" if ch in ("(", ")", "\\") else ch

    stream_cmds = b"\n".join(
        f"BT /F1 12 Tf {100 + idx * 10} 700 Td ({_escape_pdf_char(ch)}) Tj ET".encode("latin1")
        for idx, ch in enumerate(sample_text)
    )

    if tiny_form:
        form_stream = DecodedStreamObject()
        form_stream.set_data(stream_cmds)
        form_stream[NameObject("/Type")] = NameObject("/XObject")
        form_stream[NameObject("/Subtype")] = NameObject("/Form")
        form_stream[NameObject("/BBox")] = ArrayObject([
            NumberObject(0), NumberObject(0), FloatObject(793.7), FloatObject(1122.48)
        ])
        form_stream[NameObject("/Matrix")] = ArrayObject([
            FloatObject(0.0012599), FloatObject(0),
            FloatObject(0), FloatObject(0.0008908),
            FloatObject(0), FloatObject(0),
        ])
        form_stream[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref})
        })
        form_ref = writer._add_object(form_stream)

        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/XObject"): DictionaryObject({NameObject("/S1"): form_ref})
        })
        page_stream = DecodedStreamObject()
        page_stream.set_data(b"595.28 0 0 841.86 0 0 cm\n/S1 Do")
        page[NameObject("/Contents")] = writer._add_object(page_stream)
    else:
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref})
        })
        page_stream = DecodedStreamObject()
        page_stream.set_data(stream_cmds)
        page[NameObject("/Contents")] = writer._add_object(page_stream)

    with open(path, "wb") as f:
        writer.write(f)


def test_normal_pdf_skips_normalization(tmp_path: Path):
    src = tmp_path / "normal.pdf"
    dest = tmp_path / "norm.pdf"
    _build_synthetic_pdf(src, tiny_form=False)

    result = _normalize_tiny_form_xobject_scales(src, dest)
    assert result is None
    assert not dest.exists()


def test_tiny_form_xobject_scale_restores_narrow_chars(tmp_path: Path):
    src = tmp_path / "tiny_form.pdf"
    dest = tmp_path / "norm.pdf"
    _build_synthetic_pdf(src, tiny_form=True)

    # Verify PDFium drops narrow digits/punctuation before normalization
    doc_before = pdfium.PdfDocument(str(src))
    text_before = doc_before[0].get_textpage().get_text_range()
    doc_before.close()
    assert "2025.12.18.(1,000)" not in text_before

    result = _normalize_tiny_form_xobject_scales(src, dest)
    assert result == dest
    assert dest.exists()

    doc_after = pdfium.PdfDocument(str(dest))
    text_after = doc_after[0].get_textpage().get_text_range()
    doc_after.close()
    assert "2025.12.18.(1,000)" in text_after.replace(" ", "")


def test_mineru_service_parse_pdf_uses_normalized_temp_file_and_cleans_up(tmp_path: Path):
    src = tmp_path / "한글문서.pdf"
    out_dir = tmp_path / "output"
    _build_synthetic_pdf(src, tiny_form=True)

    captured_cmds = []

    def fake_run(cmd, **kwargs):
        captured_cmds.append(cmd)
        # Input path passed to mineru-kit should be the temporary normalized PDF
        norm_input = Path(cmd[2])
        assert norm_input != src
        assert norm_input.exists()
        assert norm_input.name.startswith(".tmp_norm_")

        class Proc:
            returncode = 1
            stdout = "mocked stop"

        return Proc()

    svc = MineruService()
    with patch("backend.app.services.mineru_svc.subprocess.run", side_effect=fake_run):
        res = svc.parse_pdf(src, out_dir, backend="basic", method="auto")

    assert res["success"] is False
    assert len(captured_cmds) == 1
    # Temp normalized PDF must be cleaned up after parse_pdf finishes
    assert not list(out_dir.glob(".tmp_norm_*.pdf"))


def test_real_rhwp_pdf_normalization_if_present(tmp_path: Path):
    real_pdf = Path(
        "/home/bbangwon/workspace/mineru-studio/pdfs/"
        "[보도자료]국립박물관 최초의 도자 전문 전시관‘도자문화관’12월 18일 공개_m.pdf"
    )
    if not real_pdf.exists():
        return

    dest = tmp_path / "real_norm.pdf"
    result = _normalize_tiny_form_xobject_scales(real_pdf, dest)
    assert result == dest

    doc = pdfium.PdfDocument(str(dest))
    page0_text = doc[0].get_textpage().get_text_range()
    doc.close()
    assert "2025. 12. 17.(수) 10시" in page0_text
    assert "7,000여 점" in page0_text
    assert "1,000년" in page0_text
    assert "14세기" in page0_text
