"""Generates a reference PDF describing every bulk-upload type and its columns.
Run: python docs/generate_bulk_reference_pdf.py
Output: docs/Signage_Bulk_Upload_Reference.pdf
"""
import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)

BRAND = colors.HexColor("#0b5cad")
LIGHT = colors.HexColor("#eef4fb")
GREY = colors.HexColor("#6b7280")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], textColor=BRAND, fontSize=22, spaceAfter=4)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], textColor=GREY, fontSize=10, spaceAfter=2)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], textColor=BRAND, fontSize=14, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontSize=9.5, leading=13)
CELL = ParagraphStyle("CELL", parent=styles["Normal"], fontSize=8.8, leading=11)
CELLB = ParagraphStyle("CELLB", parent=CELL, fontName="Helvetica-Bold")
NOTE = ParagraphStyle("NOTE", parent=BODY, textColor=GREY, fontSize=9)

# (column, requirement, description)
VENDORS = [
    ("name", "Required", "Vendor / company name."),
    ("contact_person", "Optional", "Primary contact person's name."),
    ("contact_phone", "Optional", "Contact phone number."),
    ("contact_email", "Optional", "Vendor email address."),
]
VENDORS_NOTE = "UID is auto-generated as <b>VND-001, VND-002, …</b> — do not include a uid column."

STORES = [
    ("name", "Required", "Store name."),
    ("address", "Required", "Full store address."),
    ("pincode", "Required", "PIN code."),
    ("lat", "Required", "Latitude (decimal number)."),
    ("long", "Required", "Longitude (decimal number)."),
    ("uid", "Optional", "Store UID. Used as the de-dupe key — re-uploading a row with an existing uid is skipped."),
    ("contact_no", "Optional", "Store contact phone."),
    ("contact_email", "Optional", "Store contact email."),
    ("contact_person", "Optional", "Store contact person."),
    ("vendor_uid", "Optional", "Vendor the store belongs to (e.g. VND-001). Must already exist."),
]
STORES_NOTE = "Mapping a store to a vendor lets RJ-admin create tasks by clicking the store (vendor auto-derived)."

USERS = [
    ("first_name", "Required", "Given name."),
    ("last_name", "Required", "Family name."),
    ("email", "Required", "Login email. Must be unique — rows whose email already exists are skipped."),
    ("role", "Required", "One of: employee, vendor_admin, vendor_user, rjcorp_admin, rjcorp_user."),
    ("mobile", "Optional", "Mobile number."),
    ("password", "Optional", "Initial password. Defaults to “password123” if left blank."),
    ("vendor_uid", "Conditional", "Required for vendor-scoped roles (employee / vendor_admin / vendor_user). Must exist."),
]
USERS_NOTE = ("Employee/vendor UIDs are auto-generated per vendor & role as <b>V{vendor}-E001</b> (employee), "
              "<b>-A001</b> (admin), <b>-U001</b> (user).")

TASKS = [
    ("task_type", "Required", "recee or installation."),
    ("installation_type", "Conditional", "Required when task_type = installation. direct = Direct Installation (pamphlet); direct_boarding = Installation w/o Recee."),
    ("vendor_uid", "Required", "Vendor the task is created against (e.g. VND-001). Must exist."),
    ("store_name", "Conditional", "Required for recee and boarding tasks. Must match an existing store name."),
    ("pincode", "Optional", "Area PIN code (mainly for direct installation)."),
    ("target_pamphlet_count", "Optional", "Target count — Direct Installation (direct) only."),
    ("brand_name", "Optional", "Boarding only. Must match an existing brand."),
    ("artwork_name", "Optional", "Boarding only. Must be an artwork that belongs to brand_name."),
    ("boarding_size_label", "Optional", "Boarding only. Must match a standard boarding-size label."),
]
TASKS_NOTE = ("post_recee installation tasks are NOT bulk-created — they are generated automatically when a "
              "recee is approved.")

REQ_COLOR = {
    "Required": colors.HexColor("#b02a37"),
    "Conditional": colors.HexColor("#b26a00"),
    "Optional": GREY,
}


def col_table(rows):
    data = [[Paragraph("Column", CELLB), Paragraph("Requirement", CELLB), Paragraph("Description", CELLB)]]
    for name, req, desc in rows:
        req_p = Paragraph(f'<font color="{REQ_COLOR[req].hexval()}">{req}</font>', CELL)
        data.append([Paragraph(f"<b>{name}</b>", CELL), req_p, Paragraph(desc, CELL)])
    t = Table(data, colWidths=[38*mm, 26*mm, 106*mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def section(flow, title, subtitle, rows, note):
    flow.append(Paragraph(title, H2))
    flow.append(Paragraph(subtitle, NOTE))
    flow.append(Spacer(1, 4))
    flow.append(col_table(rows))
    if note:
        flow.append(Spacer(1, 3))
        flow.append(Paragraph("Note: " + note, NOTE))
    flow.append(Spacer(1, 8))


def build(path):
    doc = SimpleDocTemplate(path, pagesize=A4,
                            leftMargin=16*mm, rightMargin=16*mm, topMargin=16*mm, bottomMargin=14*mm,
                            title="Signage Bulk Upload Reference")
    flow = []
    flow.append(Paragraph("Bulk Upload Reference", H1))
    flow.append(Paragraph("VBL Signage Platform — spreadsheet columns for each bulk import type", SUB))
    flow.append(HRFlowable(width="100%", color=BRAND, thickness=1.2, spaceBefore=6, spaceAfter=8))

    flow.append(Paragraph(
        "All bulk uploads are <b>.xlsx</b> files with a header row (data starts on row 2). Uploads are validated "
        "row-by-row (bad rows are reported with a reason; good rows still import) and are <b>idempotent</b> — "
        "re-uploading skips rows that already exist. Load in this order so references resolve:",
        BODY))
    flow.append(Spacer(1, 3))
    flow.append(Paragraph("<b>1. Vendors → 2. Stores → 3. Users → 4. Tasks</b>", BODY))
    flow.append(Spacer(1, 6))

    section(flow, "1. Vendors", "Tab: Vendors — privilege: vendor.manage", VENDORS, VENDORS_NOTE)
    section(flow, "2. Stores", "Tab: Stores — privilege: store.manage", STORES, STORES_NOTE)
    section(flow, "3. Users", "Tab: Users — privilege: user.manage", USERS, USERS_NOTE)
    section(flow, "4. Tasks", "Tab: Tasks — privilege: task.create", TASKS, TASKS_NOTE)

    doc.build(flow)
    print("Wrote", path)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    build(os.path.join(here, "Signage_Bulk_Upload_Reference.pdf"))
