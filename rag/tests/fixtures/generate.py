#!/usr/bin/env python3
"""
Generate minimal fixture PDFs for pdf.rs unit tests.

Run from the repo root:
    python3 tests/fixtures/generate.py

Requires fpdf2 (pip install fpdf2):
    pip install fpdf2
"""

import os
from fpdf import FPDF

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def make_simple():
    """Single-page PDF with one line of text."""
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=14)
    pdf.cell(0, 10, "Hello, World!")
    pdf.output(os.path.join(OUT_DIR, "simple.pdf"))
    print("Generated simple.pdf")


def make_multi_page():
    """Two-page PDF; each page has distinct text."""
    pdf = FPDF()
    pdf.set_font("Helvetica", size=14)

    pdf.add_page()
    pdf.cell(0, 10, "Page one content")

    pdf.add_page()
    pdf.cell(0, 10, "Page two content")

    pdf.output(os.path.join(OUT_DIR, "multi_page.pdf"))
    print("Generated multi_page.pdf")


def make_encrypted():
    """Password-protected PDF.  user_password='secret'."""
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=14)
    pdf.cell(0, 10, "This PDF is encrypted")
    pdf.set_encryption(
        owner_password="owner",
        user_password="secret",
    )
    pdf.output(os.path.join(OUT_DIR, "encrypted.pdf"))
    print("Generated encrypted.pdf (user password: 'secret')")


def make_image_only():
    """PDF with no text — just a filled rectangle.
    PDFium finds no text layer, so PdfExtractor returns
    'No text could be extracted from PDF'."""
    pdf = FPDF()
    pdf.add_page()
    pdf.set_fill_color(r=200, g=200, b=200)
    # Draw a grey rectangle that fills most of the page (simulates an image)
    pdf.rect(10, 10, 190, 270, style="F")
    pdf.output(os.path.join(OUT_DIR, "image_only.pdf"))
    print("Generated image_only.pdf (no text layer)")


if __name__ == "__main__":
    make_simple()
    make_multi_page()
    make_encrypted()
    make_image_only()
    print("Done — fixture PDFs are in", OUT_DIR)
